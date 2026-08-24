import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Procurement } from '../models/Procurement.js';
import { Supplier } from '../models/Supplier.js';
import { sendWhatsAppTemplate } from '../../util/whatsapp.js';
import { buildTenDayReportData, inclusiveDayCount } from '../util/tenDayReportData.js';
import { generateTenDayReportPdf } from '../util/tenDayReportPdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../../uploads/milk-reports');

const ensureReportsDir = () => {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
};

/** Public base URL for PDF links (no trailing slash). */
export const getPublicAppUrl = (req) => {
  const fromEnv = (process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (req) {
    const host = req.get('x-forwarded-host') || req.get('host');
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    if (host) return `${proto}://${host}`;
  }
  return 'http://localhost:5020';
};

/** MSG91 / WhatsApp button base — always ends with /public/milk-reports/ */
export const getMilkReportPublicBaseUrl = (req) =>
  `${getPublicAppUrl(req)}/public/milk-reports/`;

const parseRange = (fromDate, toDate) => {
  if (!fromDate || !toDate) {
    return { error: 'fromDate and toDate are required (YYYY-MM-DD)' };
  }
  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: 'Invalid fromDate or toDate' };
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  if (end < start) {
    return { error: 'toDate must be on or after fromDate' };
  }
  const days = inclusiveDayCount(start, end);
  if (days > 10) {
    return { error: 'Date range cannot exceed 10 days' };
  }
  return { start, end, days };
};

/**
 * POST /milk/reports/send-10day
 * Body: { supplierId, fromDate, toDate }
 * Generates PDF, stores under public token, sends milk_10day_report WhatsApp.
 */
export const sendTenDayReport = async (req, res) => {
  try {
    const { tenantId } = req;
    const { supplierId, fromDate, toDate } = req.body || {};

    if (!supplierId) {
      return res.status(400).json({ success: false, message: 'supplierId is required' });
    }

    const range = parseRange(fromDate, toDate);
    if (range.error) {
      return res.status(400).json({ success: false, message: range.error });
    }

    const supplier = await Supplier.findOne({ _id: supplierId, tenantId });
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }
    if (!supplier.phone) {
      return res.status(400).json({ success: false, message: 'Supplier has no phone number' });
    }

    const procurements = await Procurement.find({
      tenantId,
      supplierId,
      date: { $gte: range.start, $lte: range.end }
    })
      .sort({ date: 1, shift: 1 })
      .lean();

    const report = buildTenDayReportData(supplier, procurements, range.start, range.end);
    const pdfBuffer = await generateTenDayReportPdf(report);

    ensureReportsDir();
    const token = crypto.randomBytes(16).toString('hex');
    const filename = `${token}.pdf`;
    const filePath = path.join(REPORTS_DIR, filename);
    fs.writeFileSync(filePath, pdfBuffer);

    const publicBase = getMilkReportPublicBaseUrl(req);
    const reportUrl = `${publicBase}${token}`;

    const waResult = await sendWhatsAppTemplate(
      supplier.phone,
      'milk_10day_report',
      {
        supplier_name: report.supplierName,
        from_date: report.fromDateLabel,
        to_date: report.toDateLabel,
        total_qty: String(report.totalQty),
        total_amount: String(Math.round(report.totalAmount)),
      },
      'en',
      // Visit website button: base URL + this token
      { urlButtonSuffix: token }
    );

    res.json({
      success: true,
      message: '10-day report generated and WhatsApp notification queued',
      data: {
        supplierId: supplier._id.toString(),
        supplierName: report.supplierName,
        fromDate: report.fromDateLabel,
        toDate: report.toDateLabel,
        buffaloQty: report.buffalo.totalQty,
        buffaloAmount: report.buffalo.totalAmount,
        cowQty: report.cow.totalQty,
        cowAmount: report.cow.totalAmount,
        totalQty: report.totalQty,
        totalAmount: report.totalAmount,
        reportUrl,
        reportToken: token,
        whatsapp: waResult || { sent: true }
      }
    });
  } catch (err) {
    console.error('Send 10-day report error:', err);
    res.status(500).json({ success: false, message: 'Failed to send 10-day report' });
  }
};

/**
 * GET /public/milk-reports/:token
 * No auth — WhatsApp download link.
 */
export const downloadPublicMilkReport = async (req, res) => {
  try {
    const raw = String(req.params.token || '').replace(/\.pdf$/i, '');
    if (!/^[a-f0-9]{32}$/i.test(raw)) {
      return res.status(400).json({ success: false, message: 'Invalid report token' });
    }

    const filePath = path.join(REPORTS_DIR, `${raw}.pdf`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Report not found or expired' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="milk-report-${raw}.pdf"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Public milk report download error:', err);
    res.status(500).json({ success: false, message: 'Failed to download report' });
  }
};
