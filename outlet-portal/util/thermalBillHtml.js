function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;'
  );
}

function fmtInr(n) {
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function normalizeDiscountAmount(v) {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  if (typeof v === 'object' && v !== null && 'amount' in v) {
    const a = v.amount;
    if (typeof a === 'number' && Number.isFinite(a)) return Math.max(0, a);
    if (typeof a === 'string') {
      const n = Number(a);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    }
  }
  return 0;
}

function formatRetailBillDate(dateStr) {
  const m = String(dateStr).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[1]}/${m[2]}/${m[3].slice(-2)}`;
  const d = new Date(dateStr);
  if (!Number.isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  }
  return dateStr;
}

function displayBillNo(invoiceNo) {
  return String(invoiceNo).replace(/^#/, '').trim();
}

function isSplitPaymentMode(mode) {
  return String(mode || '').trim() === 'Split';
}

function renderPaymentSectionHtml(data) {
  const mode = typeof data.paymentMode === 'string' ? data.paymentMode.trim() : '';
  const payments = data.payments ?? [];

  if (isSplitPaymentMode(mode) && payments.length > 0) {
    const rows = payments
      .map(
        (p) =>
          `<div class="summary"><span>${escapeHtml(p.mode)}</span><span>${escapeHtml(fmtInr(p.amount))}</span></div>`
      )
      .join('');
    const paidTotal = payments.reduce((s, p) => s + p.amount, 0);
    return `<div class="center bold meta-single">Payment (Split)</div>${rows}<div class="summary bold"><span>Total Paid</span><span>${escapeHtml(fmtInr(paidTotal))}</span></div>`;
  }

  if (mode) {
    return `<div class="center bold meta-single">Payment Mode: ${escapeHtml(mode)}</div>`;
  }

  return '';
}

function renderItemsRowsHtml(items) {
  return items
    .map((item, idx) => {
      const qty = String(item.quantity ?? 0);
      const price = (item.unitPrice || 0).toFixed(2);
      const amount = (item.lineTotal || 0).toFixed(2);
      return `<tr>
        <td class="no">${idx + 1}</td>
        <td class="item">${escapeHtml(item.name)}</td>
        <td class="c">${escapeHtml(qty)}</td>
        <td class="r">${escapeHtml(price)}</td>
        <td class="r">${escapeHtml(amount)}</td>
      </tr>`;
    })
    .join('');
}

/**
 * Build a self-contained 3″ thermal HTML receipt (same layout as POS print).
 * @param {Record<string, unknown>} data
 */
export function buildThermalBillHtml(data) {
  const items = data.items ?? [];
  const grossMerchandise = items.reduce(
    (s, i) => s + (i.unitPrice || 0) * (i.quantity || 0),
    0
  );
  const sumLineTotals = items.reduce((s, i) => s + (i.lineTotal || 0), 0);
  const displaySubtotal = data.subtotal ?? Math.max(grossMerchandise, sumLineTotals);

  let discountAmt = normalizeDiscountAmount(data.discount);
  const netPayable = Number(data.total);
  if (discountAmt < 0.005 && Number.isFinite(netPayable)) {
    const implied = Math.round((displaySubtotal - netPayable) * 100) / 100;
    if (implied > 0.005) discountAmt = implied;
  }

  const totalQty = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  const orderType = data.orderType ?? 'Pick Up';
  const cashier = data.cashierName ?? '—';
  const billTime = data.billTime ?? '—';
  const billDate = formatRetailBillDate(data.date);
  const billNo = displayBillNo(String(data.invoiceNo));
  const displayOutletAddress = data.outletAddress || 'Village Buchi, Pundri, Kaithal';
  const displayOutletGst = String(data.outletGst || '').trim();
  const storeName = data.storeName || 'NANNU MILK';
  const paymentSection = renderPaymentSectionHtml(data);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Invoice ${escapeHtml(billNo || '')}</title>
<style>
  @page { size: 72mm auto; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: "Segoe UI", Roboto, Arial, sans-serif;
    width: 72mm;
    max-width: 72mm;
    padding: 2mm 2mm;
    font-size: 9pt;
    line-height: 1.25;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .center { text-align: center; }
  .right  { text-align: right; }
  .bold   { font-weight: 700; }
  .title  { font-size: 10pt; font-weight: 700; text-align: center; }
  .store  { font-size: 12pt; font-weight: 700; text-align: center; margin-top: 1mm; }
  .small  { font-size: 8pt; }
  .meta {
    display: flex;
    justify-content: space-between;
    gap: 1mm;
    font-size: 9pt;
    margin-bottom: 1mm;
  }
  .meta > span { min-width: 0; word-break: break-word; }
  .meta-single { font-size: 9pt; margin-bottom: 1mm; word-break: break-word; }
  hr.rule { border: 0; border-top: 1px solid #000; margin: 1.5mm 0; }
  table.items {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  table.items th,
  table.items td {
    padding: 0.6mm 0.4mm;
    font-size: 9pt;
    vertical-align: top;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  table.items thead th {
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    font-size: 8pt;
  }
  table.items th.no, table.items td.no { width: 8%;  text-align: center; }
  table.items th.item, table.items td.item { width: 40%; text-align: left; padding-right: 1mm; }
  table.items th.qty, table.items td.c { width: 14%; text-align: center; }
  table.items th.price, table.items td.r { width: 18%; text-align: right; }
  table.items th.amt { width: 20%; text-align: right; }
  .summary {
    display: flex;
    justify-content: space-between;
    gap: 2mm;
    font-size: 9pt;
    margin-top: 1mm;
  }
  .summary > span { min-width: 0; word-break: break-word; }
  .gstNote { font-size: 8pt; text-align: center; font-style: italic; margin: 1.5mm 0; }
  .grand {
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    text-align: center;
    font-size: 12pt;
    font-weight: 700;
    padding: 1.5mm 0;
    margin: 1.5mm 0;
    word-break: break-word;
  }
  .foot { font-size: 9pt; text-align: center; margin-top: 2mm; }
</style>
</head>
<body>
  <div class="title">RETAIL INVOICE</div>
  <div class="store">${escapeHtml(storeName)}</div>
  <div class="center small">Add: ${escapeHtml(displayOutletAddress)}</div>
  ${
    displayOutletGst
      ? `<div class="center small">GST: ${escapeHtml(displayOutletGst)}</div>`
      : ''
  }
  <hr class="rule" />

  <div class="meta-single">Name: ${escapeHtml(
    (data.customerName ?? '').trim() || '________________'
  )}</div>
  <hr class="rule" />

  <div class="meta">
    <span>Date: ${escapeHtml(billDate)}</span>
    <span>Order Type: ${escapeHtml(orderType)}</span>
  </div>
  <div class="meta">
    <span>Time: ${escapeHtml(billTime)}</span>
    <span>Cashier: ${escapeHtml(cashier)}</span>
  </div>
  <div class="meta-single">Bill No.: ${escapeHtml(billNo)}</div>
  <hr class="rule" />

  <table class="items">
    <thead>
      <tr>
        <th class="no">No.</th>
        <th class="item">Item</th>
        <th class="qty">Qty.</th>
        <th class="price">Price</th>
        <th class="amt">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${renderItemsRowsHtml(items)}
    </tbody>
  </table>

  <hr class="rule" />
  <div class="summary"><span>Total Qty</span><span>${escapeHtml(String(totalQty))}</span></div>
  <div class="summary"><span>Sub Total</span><span>${escapeHtml(displaySubtotal.toFixed(2))}</span></div>
  ${
    discountAmt > 0.005
      ? `<div class="summary"><span>Discount (-)</span><span>-${escapeHtml(
          discountAmt.toFixed(2)
        )}</span></div>`
      : ''
  }
  <div class="gstNote">[Net Total inclusive of GST]</div>
  <hr class="rule" />

  <div class="grand">Grand Total: Rs ${escapeHtml(fmtInr(netPayable))}</div>
  ${paymentSection}
  <hr class="rule" />

  <div class="foot">Thanks &amp; visit again...!!!</div>
</body>
</html>`;
}

/**
 * Mobile-friendly public bill page with download PDF action.
 * @param {Record<string, unknown>} data - invoice data from saleToInvoiceData
 * @param {{ pdfUrl: string }} options
 */
export function buildPublicBillPage(data, { pdfUrl }) {
  const receiptHtml = buildThermalBillHtml(data);
  const billNo = displayBillNo(String(data.invoiceNo));
  const storeName = data.storeName || 'NANNU MILK';
  const escapedReceipt = receiptHtml
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bill ${escapeHtml(billNo)} — ${escapeHtml(storeName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", Roboto, Arial, sans-serif;
    background: #f4f6f8;
    color: #1a1a1a;
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: #fff;
    border-bottom: 1px solid #e0e0e0;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  .toolbar h1 {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
  }
  .toolbar p {
    margin: 2px 0 0;
    font-size: 0.8rem;
    color: #666;
  }
  .btn {
    display: inline-block;
    padding: 10px 18px;
    background: #1976d2;
    color: #fff;
    text-decoration: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.9rem;
    white-space: nowrap;
  }
  .btn:hover { background: #1565c0; }
  .wrap {
    display: flex;
    justify-content: center;
    padding: 20px 12px 40px;
  }
  .receipt-frame {
    background: #fff;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    border-radius: 4px;
    overflow: hidden;
    max-width: 100%;
  }
  .receipt-frame iframe {
    display: block;
    border: 0;
    width: 72mm;
    min-height: 400px;
    max-width: 100%;
  }
  @media print {
    .toolbar { display: none; }
    body { background: #fff; }
    .wrap { padding: 0; }
    .receipt-frame { box-shadow: none; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <div>
      <h1>${escapeHtml(storeName)}</h1>
      <p>Bill #${escapeHtml(billNo)} · ₹${escapeHtml(fmtInr(Number(data.total)))}</p>
    </div>
    <a class="btn" href="${escapeHtml(pdfUrl)}">Download PDF</a>
  </div>
  <div class="wrap">
    <div class="receipt-frame">
      <iframe title="Bill receipt" srcdoc="${escapedReceipt}"></iframe>
    </div>
  </div>
</body>
</html>`;
}
