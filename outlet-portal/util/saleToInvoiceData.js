const DEFAULT_STORE_NAME = 'NANNU MILK';
const DEFAULT_OUTLET_ADDRESS = 'Village Buchi, Pundri, Kaithal';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** DD-MM-YYYY and HH:mm from a sale `createdAt`. */
export function saleReceiptStamp(createdAt) {
  const d = createdAt ? new Date(createdAt) : new Date();
  const date = `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
  const billTime = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return { date, billTime };
}

/**
 * Map a Mongo sale document to the invoice shape used by thermal HTML / PDF.
 * @param {Record<string, unknown>} sale
 */
export function saleToInvoiceData(sale) {
  const { date, billTime } = saleReceiptStamp(sale.createdAt);
  const snapshot = sale.outletSnapshot && typeof sale.outletSnapshot === 'object'
    ? sale.outletSnapshot
    : {};

  const discount = sale.discount;
  let discountValue;
  if (discount && typeof discount === 'object' && discount.amount != null) {
    discountValue = Number(discount.amount);
  }

  return {
    invoiceNo: String(sale.saleId || ''),
    date,
    billTime,
    customerName: sale.customer?.name,
    customerPhone: sale.customer?.phone,
    customerAddress: sale.customer?.address,
    items: (sale.items || []).map((item) => ({
      name: item.name || '',
      unitPrice: Number(item.unitPrice) || 0,
      quantity: Number(item.quantity) || 0,
      lineTotal: Number(item.lineTotal) || 0
    })),
    subtotal: Number(sale.subtotal) || 0,
    discount: discountValue != null && Number.isFinite(discountValue) ? discountValue : sale.discount,
    total: Number(sale.total) || 0,
    paymentMode: sale.paymentMode,
    payments: sale.payments,
    orderType: 'Pick Up',
    cashierName: sale.cashierName || '—',
    storeName: snapshot.name || DEFAULT_STORE_NAME,
    outletAddress: snapshot.address || DEFAULT_OUTLET_ADDRESS,
    outletGst: snapshot.gstNo || ''
  };
}
