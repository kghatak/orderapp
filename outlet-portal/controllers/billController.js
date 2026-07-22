import { getSaleModel } from '../models/Sale.js';
import { saleToInvoiceData } from '../util/saleToInvoiceData.js';
import { buildThermalBillHtml, buildPublicBillPage } from '../util/thermalBillHtml.js';
import { htmlToPdfBuffer } from '../util/billPdf.js';
import { buildPublicBillPdfUrl } from '../util/saleBillWhatsApp.js';

async function findSaleByBillToken(token) {
  if (!token || typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (!trimmed || trimmed.length < 16) return null;
  const Sale = getSaleModel();
  return Sale.findOne({ billToken: trimmed }).lean();
}

/**
 * GET /bill/:token — public mobile bill view.
 */
export const viewBill = async (req, res) => {
  try {
    const sale = await findSaleByBillToken(req.params.token);
    if (!sale) {
      return res.status(404).type('html').send('<h1>Bill not found</h1><p>This link may have expired or is invalid.</p>');
    }

    const data = saleToInvoiceData(sale);
    const pdfUrl = buildPublicBillPdfUrl(sale.billToken) || '#';
    const html = buildPublicBillPage(data, { pdfUrl });
    res.type('html').send(html);
  } catch (err) {
    console.error('viewBill error:', err);
    res.status(500).type('html').send('<h1>Error</h1><p>Could not load bill. Please try again later.</p>');
  }
};

/**
 * GET /bill/:token/pdf — download bill as PDF.
 */
export const downloadBillPdf = async (req, res) => {
  try {
    const sale = await findSaleByBillToken(req.params.token);
    if (!sale) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    const data = saleToInvoiceData(sale);
    const thermalHtml = buildThermalBillHtml(data);
    const billNo = String(sale.saleId || 'bill').replace(/[^\w-]/g, '');

    try {
      const buffer = await htmlToPdfBuffer(thermalHtml);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="bill-${billNo}.pdf"`
      });
      return res.send(buffer);
    } catch (pdfErr) {
      console.warn('PDF generation failed, serving HTML for print:', pdfErr?.message || pdfErr);
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="bill-${billNo}.html"`
      });
      return res.send(thermalHtml);
    }
  } catch (err) {
    console.error('downloadBillPdf error:', err);
    res.status(500).json({ success: false, message: 'Could not generate bill PDF' });
  }
};
