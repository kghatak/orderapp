import ExcelJS from 'exceljs';
import { Procurement } from '../models/Procurement.js';
import { withMongoTenant } from '../../util/tenantMiddleware.js';

const MAX_XLSX_RANGE_DAYS = 10;
const YMD_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const PRODUCT_VOUCHER_EXPORT_HEADERS = [
  'Voucher Date',
  'Voucher Number',
  'Buyer/Supplier',
  'Address',
  'State',
  'Pin Code',
  'Registration Type',
  'Registration Number',
  'TDS Nature',
  'Item Name',
  'Billed Quantity',
  'Item Rate',
  'Unit',
  'Discount %',
  'Item Rate After Discount Including Tax',
  'Taxable Value After Discount',
  'Total',
  'IGST Rate',
  'IGST Amount',
  'CGST Rate',
  'CGST Amount',
  'SGST Rate',
  'SGST Amount',
  'Rounding',
  'Bill Total',
  'Narration',
];

const firstQueryString = (value) => {
  if (value == null) return '';
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw).trim();
};

const roundMoney2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const enumerateDateRangeInclusive = (fromYmd, toYmd) => {
  const keys = [];
  const cur = new Date(`${fromYmd}T00:00:00`);
  const end = new Date(`${toYmd}T00:00:00`);
  while (cur <= end) {
    keys.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
};

const formatVoucherDate = (dateValue) => {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};

const itemLabel = (milkType) =>
  milkType === 'buffalo' ? 'Buffalo Milk' : 'Cow Milk';

const formatMetricForNarration = (value) => {
  if (value == null || value === '') return '';
  return String(value).trim();
};

const buildLineNarration = (supplierName, lineMetrics = null) => {
  let text = `Milk purchase from ${supplierName || 'supplier'}`;

  const fat = lineMetrics?.fat;
  const snf = lineMetrics?.snf;
  const fatMeterReading = lineMetrics?.fatMeterReading;

  const fatLabel = formatMetricForNarration(fat);
  if (fatLabel !== '') {
    text += ` Fat =${fatLabel}`;
  }

  const snfLabel = formatMetricForNarration(snf);
  if (snfLabel !== '' && snfLabel !== '0') {
    text += ` SNF ${snfLabel}`;
  }

  const meterLabel = formatMetricForNarration(fatMeterReading);
  if (meterLabel !== '') {
    text += ` Metar ${meterLabel}`;
  }

  return text;
};

const getExportLines = (procurement) => {
  if (
    procurement.milkType === 'mixed'
    && Array.isArray(procurement.lines)
    && procurement.lines.length > 0
  ) {
    return procurement.lines
      .filter((line) => line?.milkType === 'cow' || line?.milkType === 'buffalo')
      .map((line) => {
        const quantity = Number(line.quantity) || 0;
        const amount = roundMoney2(line.amount ?? 0);
        return {
          itemName: itemLabel(line.milkType),
          quantity,
          amount,
          rate: quantity > 0 ? roundMoney2(amount / quantity) : 0,
          fat: line.fat,
          snf: line.snf,
          fatMeterReading: line.fatMeterReading,
        };
      });
  }

  const quantity = Number(procurement.quantity) || 0;
  const amount = roundMoney2(procurement.amount ?? 0);
  return [{
    itemName: itemLabel(procurement.milkType),
    quantity,
    amount,
    rate: quantity > 0 ? roundMoney2(amount / quantity) : 0,
    fat: procurement.fat,
    snf: procurement.snf,
    fatMeterReading: procurement.fatMeterReading,
  }];
};

const localDateKey = (dateValue) => {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyMilkBucket = () => ({
  quantity: 0,
  amount: 0,
  fatWeighted: 0,
  snfWeighted: 0,
  meterWeighted: 0,
  weightQty: 0,
});

const addExportLineToBucket = (bucket, line) => {
  const quantity = Number(line.quantity) || 0;
  bucket.quantity += quantity;
  bucket.amount += Number(line.amount) || 0;
  if (quantity <= 0) return;
  bucket.fatWeighted += (Number(line.fat) || 0) * quantity;
  bucket.snfWeighted += (Number(line.snf) || 0) * quantity;
  bucket.meterWeighted += (Number(line.fatMeterReading) || 0) * quantity;
  bucket.weightQty += quantity;
};

const averageMetric = (weighted, quantity) => {
  if (!(quantity > 0)) return '';
  return Math.round(((weighted / quantity) + Number.EPSILON) * 100) / 100;
};

const supplierRecord = (procurement) => (
  procurement.supplierId && typeof procurement.supplierId === 'object'
    ? procurement.supplierId
    : {}
);

/**
 * One voucher per supplier per calendar day.
 * Cow and buffalo quantities are summed. Fat, SNF, and meter are quantity-weighted averages.
 */
const groupProcurementsForTally = (procurements) => {
  const groups = new Map();

  for (const procurement of procurements) {
    const supplier = supplierRecord(procurement);
    const supplierId = supplier._id
      ? String(supplier._id)
      : String(procurement.supplierId || 'unknown');
    const day = localDateKey(procurement.date);
    const key = `${day}|${supplierId}`;

    if (!groups.has(key)) {
      groups.set(key, {
        date: procurement.date,
        supplier,
        cow: emptyMilkBucket(),
        buffalo: emptyMilkBucket(),
      });
    }

    const group = groups.get(key);
    for (const line of getExportLines(procurement)) {
      const bucket = line.itemName === 'Buffalo Milk' ? group.buffalo : group.cow;
      addExportLineToBucket(bucket, line);
    }
  }

  return [...groups.values()];
};

const bucketToExportLine = (itemName, bucket) => {
  const quantity = bucket.quantity;
  if (!(quantity > 0)) return null;
  const amount = roundMoney2(bucket.amount);
  return {
    itemName,
    quantity,
    amount,
    rate: roundMoney2(amount / quantity),
    fat: averageMetric(bucket.fatWeighted, bucket.weightQty),
    snf: averageMetric(bucket.snfWeighted, bucket.weightQty),
    fatMeterReading: averageMetric(bucket.meterWeighted, bucket.weightQty),
  };
};

/** Same GST / rounding logic as daily product delivery export. */
const computeVoucherTaxLine = (itemRate, discountPct, qty, gstPct, interState) => {
  const rate = Number(itemRate) || 0;
  const disc = Number(discountPct) || 0;
  const q = Number(qty) || 0;
  const gst = Number(gstPct) || 0;

  const rateAfterDiscountInclTax = roundMoney2(rate * (1 - disc / 100));
  const billTotalBeforeRounding = roundMoney2(rateAfterDiscountInclTax * q);
  const billTotal = Math.round(billTotalBeforeRounding);
  const gDec = gst / 100;
  const taxableValue = gDec > 0
    ? roundMoney2(billTotalBeforeRounding / (1 + gDec))
    : billTotalBeforeRounding;

  let igstRate = 0;
  let igstAmt = 0;
  let cgstRate = 0;
  let cgstAmt = 0;
  let sgstRate = 0;
  let sgstAmt = 0;

  if (gst > 0) {
    if (interState) {
      igstRate = gst;
      igstAmt = roundMoney2(taxableValue * gDec);
    } else {
      cgstRate = roundMoney2(gst / 2);
      sgstRate = roundMoney2(gst / 2);
      const halfDec = gDec / 2;
      cgstAmt = roundMoney2(taxableValue * halfDec);
      sgstAmt = roundMoney2(taxableValue * halfDec);
    }
  }

  const taxParts = igstAmt + cgstAmt + sgstAmt;
  const balancingRounding = roundMoney2(billTotalBeforeRounding - taxableValue - taxParts);
  const billRoundOff = roundMoney2(billTotal - billTotalBeforeRounding);
  const rounding = roundMoney2(balancingRounding + billRoundOff);

  return {
    rateAfterDiscountInclTax,
    taxableValueAfterDiscountPerUnit: q > 0 ? roundMoney2(taxableValue / q) : '',
    totalTaxableLine: taxableValue,
    igstRate,
    igstAmt,
    cgstRate,
    cgstAmt,
    sgstRate,
    sgstAmt,
    rounding,
    billTotal,
  };
};

const parseDateRange = (req) => {
  const fromS = firstQueryString(req.query.from);
  const toS = firstQueryString(req.query.to);
  const dateS = firstQueryString(req.query.date);

  if (fromS && toS) {
    if (!YMD_DATE_REGEX.test(fromS) || !YMD_DATE_REGEX.test(toS)) {
      return { ok: false, status: 400, body: { success: false, error: 'from and to must be YYYY-MM-DD' } };
    }
    if (fromS > toS) {
      return { ok: false, status: 400, body: { success: false, error: 'from must be on or before to' } };
    }
    const dateKeys = enumerateDateRangeInclusive(fromS, toS);
    if (dateKeys.length > MAX_XLSX_RANGE_DAYS) {
      return {
        ok: false,
        status: 400,
        body: {
          success: false,
          error: `Date range spans ${dateKeys.length} days; maximum is ${MAX_XLSX_RANGE_DAYS}`,
        },
      };
    }
    return { ok: true, fromDate: fromS, toDate: toS, usedRange: true };
  }

  if (dateS) {
    if (!YMD_DATE_REGEX.test(dateS)) {
      return { ok: false, status: 400, body: { success: false, error: 'date must be YYYY-MM-DD' } };
    }
    return { ok: true, fromDate: dateS, toDate: dateS, usedRange: false };
  }

  return {
    ok: false,
    status: 400,
    body: {
      success: false,
      error: 'Provide date=YYYY-MM-DD or from and to (inclusive range, maximum 10 days)',
    },
  };
};

const buildMilkTallyExportRows = async (req) => {
  const { tenantId } = req;
  const range = parseDateRange(req);
  if (!range.ok) return range;

  const interState = ['1', 'true', true].includes(req.query.interState);
  const defaultGstNum = req.query.defaultGst !== undefined && req.query.defaultGst !== ''
    ? parseFloat(String(req.query.defaultGst))
    : NaN;
  const gstPct = Number.isFinite(defaultGstNum) ? defaultGstNum : 0;

  const counterParsed = req.query.counter !== undefined && req.query.counter !== ''
    ? parseInt(String(req.query.counter), 10)
    : NaN;
  const startVoucherNumber = Number.isFinite(counterParsed) && counterParsed >= 1
    ? counterParsed
    : 1;

  const start = new Date(`${range.fromDate}T00:00:00`);
  const end = new Date(`${range.toDate}T23:59:59.999`);

  const procurements = await Procurement.find({
    tenantId,
    date: { $gte: start, $lte: end },
  })
    .populate('supplierId', 'name supplierCode state pinCode gstNumber address village')
    .sort({ date: 1, createdAt: 1 })
    .lean();

  if (!procurements.length) {
    const rangeLabel = range.fromDate === range.toDate
      ? range.fromDate
      : `${range.fromDate}–${range.toDate}`;
    return {
      ok: false,
      status: 404,
      body: {
        success: false,
        message: `No milk procurement data found for requested day(s): ${rangeLabel}`,
      },
    };
  }

  const rows = [];
  let voucherOffset = 0;

  for (const group of groupProcurementsForTally(procurements)) {
    const supplier = group.supplier;
    const gstNo = supplier.gstNumber ? String(supplier.gstNumber).trim() : '';
    const registrationType = gstNo ? 'Regular' : 'Unregistered/Consumer';
    const registrationNumber = gstNo || '';
    const address = supplier.address != null ? String(supplier.address).trim() : '';
    const state = supplier.state != null ? String(supplier.state).trim() : '';
    const pinCodeRaw = supplier.pinCode != null && supplier.pinCode !== ''
      ? String(supplier.pinCode).trim()
      : '';
    const supplierName = supplier.name || '';
    const voucherNumber = startVoucherNumber + voucherOffset;
    voucherOffset += 1;
    const voucherDate = formatVoucherDate(group.date);

    const lines = [
      bucketToExportLine('Cow Milk', group.cow),
      bucketToExportLine('Buffalo Milk', group.buffalo),
    ].filter(Boolean);
    let isFirstRowOfGroup = true;

    for (const line of lines) {
      const tax = computeVoucherTaxLine(
        line.rate,
        0,
        line.quantity,
        gstPct,
        interState,
      );
      const perUnitTaxable = tax.taxableValueAfterDiscountPerUnit;

      const rowAddress = isFirstRowOfGroup ? address : '';
      const rowPinCode = isFirstRowOfGroup && pinCodeRaw !== '' && /^\d+$/.test(pinCodeRaw)
        ? Number(pinCodeRaw)
        : (isFirstRowOfGroup ? pinCodeRaw : '');
      const rowRegistrationType = isFirstRowOfGroup ? registrationType : '';
      const rowRegistrationNumber = isFirstRowOfGroup ? registrationNumber : '';
      const rowNarration = buildLineNarration(supplierName, {
        fat: line.fat,
        snf: line.snf,
        fatMeterReading: line.fatMeterReading,
      });
      isFirstRowOfGroup = false;

      rows.push([
        voucherDate,
        voucherNumber,
        supplierName,
        rowAddress,
        state,
        rowPinCode,
        rowRegistrationType,
        rowRegistrationNumber,
        '',
        line.itemName,
        roundMoney2(line.quantity),
        line.rate,
        'KG',
        0,
        tax.rateAfterDiscountInclTax,
        perUnitTaxable === '' ? '' : perUnitTaxable,
        tax.totalTaxableLine,
        tax.igstRate,
        tax.igstAmt,
        tax.cgstRate,
        tax.cgstAmt,
        tax.sgstRate,
        tax.sgstAmt,
        tax.rounding,
        tax.billTotal,
        rowNarration,
      ]);
    }
  }

  const filenameBase = range.usedRange
    ? `MilkTallyPurchase_${range.fromDate}_to_${range.toDate}`
    : `MilkTallyPurchase_${range.fromDate}`;

  return {
    ok: true,
    headers: PRODUCT_VOUCHER_EXPORT_HEADERS,
    rows,
    filenameBase,
  };
};

/**
 * GET /milk/reports/tally/xlsx
 *
 * Single day: `?date=YYYY-MM-DD&counter=1`
 * Date range (inclusive, max 10 days): `?from=YYYY-MM-DD&to=YYYY-MM-DD`
 * Optional: `counter`, `interState`, `defaultGst`
 */
export const getMilkTallyXLSX = async (req, res) => {
  try {
    const result = await buildMilkTallyExportRows(req);
    if (!result.ok) return res.status(result.status).json(result.body);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tally Purchase', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow(result.headers);
    result.rows.forEach((row) => sheet.addRow(row));

    const buf = await workbook.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${result.filenameBase}.xlsx"`);
    return res.status(200).send(Buffer.from(buf));
  } catch (err) {
    console.error('Milk Tally XLSX export error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to export Tally report',
    });
  }
};
