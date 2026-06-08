/** Round to max 3 decimal places (avoids float noise like 2.4000000000000004). */
export const roundQty = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
};
