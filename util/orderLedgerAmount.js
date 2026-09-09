/**
 * Sale amount used by the ledger PDF (/orders/report) and by daily
 * opening/closing snapshots. Always prefer line items after discount so a
 * stale Firestore `total amount` (partial accept, GST residue) cannot drift
 * the closing balance away from the PDF.
 */
export function getOrderLedgerAmount(orderData) {
  if (!orderData) return 0;

  const items = orderData.items;
  if (Array.isArray(items) && items.length > 0) {
    let orderAmount = 0;
    for (const item of items) {
      const price = parseFloat(item.price || 0);
      const quantity = parseFloat(item.quantity || 0);
      const discountPercentage = parseFloat(item.discountPercentage || 0);
      const itemSubtotal = price * quantity;
      let discountAmount = parseFloat(item.discountAmount || 0);
      if (discountAmount === 0 && discountPercentage > 0) {
        discountAmount = itemSubtotal * (discountPercentage / 100);
      }
      orderAmount += itemSubtotal - discountAmount;
    }
    return Math.round(orderAmount * 100) / 100;
  }

  const stored = parseFloat(orderData['total amount'] || orderData.totalAmount || 0);
  return Number.isFinite(stored) ? Math.round(stored * 100) / 100 : 0;
}
