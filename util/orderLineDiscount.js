/**
 * Line discount for an order item.
 * A positive percentage sent by the client is kept.
 * Zero or a missing percentage uses the outlet discount for that product icon
 * (sweet, ghee, namkeen, milk, sweet_box). Outlet values may be numbers or numeric strings.
 */
export function resolveOrderLineDiscount({
  requestedPercentage,
  icon,
  outletDiscounts,
  price,
  quantity,
}) {
  const requested = Number(requestedPercentage);
  const outletPercentage = outletDiscountPercent(outletDiscounts, icon);
  const discountPercentage = Number.isFinite(requested) && requested > 0
    ? requested
    : outletPercentage;
  const itemSubtotal = (Number(price) || 0) * (Number(quantity) || 0);
  const discountAmount = roundMoney(itemSubtotal * (discountPercentage / 100));
  return { discountPercentage, discountAmount };
}

function outletDiscountPercent(discounts, icon) {
  if (!discounts || typeof discounts !== 'object' || !icon) return 0;
  const key = String(icon).trim().toLowerCase();
  const raw = discounts[key] ?? discounts[findDiscountKey(discounts, key)];
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return percent;
}

function findDiscountKey(discounts, key) {
  return Object.keys(discounts).find((name) => String(name).trim().toLowerCase() === key);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
