const emptyShift = () => ({
  quantity: 0,
  fat: 0,
  meter: 0,
  ratePerKg: 0,
  amount: 0
});

const dateKey = (d) => {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const formatDisplayDate = (key) => {
  const [y, m, d] = key.split('-');
  return `${d}-${m}-${y}`;
};

const eachDateKey = (fromDate, toDate) => {
  const keys = [];
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    keys.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const applyEntry = (slot, entry) => {
  const qty = Number(entry.quantity) || 0;
  const amount = Number(entry.amount) || 0;
  const fat = Number(entry.fat) || 0;
  const meter = Number(entry.fatMeterReading) || 0;
  if (qty <= 0 && amount <= 0) return;

  const prevQty = slot.quantity;
  slot.quantity = round2(prevQty + qty);
  slot.amount = round2(slot.amount + amount);
  slot.fat = slot.quantity > 0
    ? round2(((prevQty * slot.fat) + (qty * fat)) / slot.quantity)
    : fat;
  slot.meter = meter || slot.meter;
  slot.ratePerKg = slot.quantity > 0 ? round2(slot.amount / slot.quantity) : 0;
};

/** Expand a procurement into cow/buffalo entries for its shift. */
const expandProcurementEntries = (proc) => {
  const shift = proc.shift === 'evening' ? 'evening' : 'morning';
  if (proc.milkType === 'mixed' && Array.isArray(proc.lines) && proc.lines.length > 0) {
    return proc.lines
      .filter((line) => line.milkType === 'cow' || line.milkType === 'buffalo')
      .map((line) => ({
        milkType: line.milkType,
        shift,
        quantity: line.quantity,
        fat: line.fat,
        fatMeterReading: line.fatMeterReading,
        amount: line.amount
      }));
  }
  const milkType = proc.milkType === 'buffalo' ? 'buffalo' : 'cow';
  return [{
    milkType,
    shift,
    quantity: proc.quantity,
    fat: proc.fat,
    fatMeterReading: proc.fatMeterReading,
    amount: proc.amount
  }];
};

/**
 * Build per-day morning/evening grids for buffalo (B) and cow (C) milk.
 */
export const buildTenDayReportData = (supplier, procurements, fromDate, toDate) => {
  const days = eachDateKey(fromDate, toDate).map((key) => ({
    dateKey: key,
    dateLabel: formatDisplayDate(key),
    buffalo: { morning: emptyShift(), evening: emptyShift() },
    cow: { morning: emptyShift(), evening: emptyShift() }
  }));

  const byDate = new Map(days.map((d) => [d.dateKey, d]));

  for (const proc of procurements) {
    const day = byDate.get(dateKey(proc.date));
    if (!day) continue;
    for (const entry of expandProcurementEntries(proc)) {
      const milk = entry.milkType === 'buffalo' ? day.buffalo : day.cow;
      applyEntry(milk[entry.shift], entry);
    }
  }

  const summarize = (milkKey) => {
    let totalQty = 0;
    let totalAmount = 0;
    const rows = days.map((day) => {
      const morning = day[milkKey].morning;
      const evening = day[milkKey].evening;
      const dayQty = round2(morning.quantity + evening.quantity);
      const dayAmount = round2(morning.amount + evening.amount);
      totalQty = round2(totalQty + dayQty);
      totalAmount = round2(totalAmount + dayAmount);
      return {
        dateLabel: day.dateLabel,
        morning,
        evening,
        totalQty: dayQty,
        totalAmount: dayAmount
      };
    });
    return { rows, totalQty, totalAmount };
  };

  const buffalo = summarize('buffalo');
  const cow = summarize('cow');

  return {
    supplierName: supplier.name,
    supplierCode: supplier.supplierCode || '',
    phone: supplier.phone,
    fromDateLabel: formatDisplayDate(dateKey(fromDate)),
    toDateLabel: formatDisplayDate(dateKey(toDate)),
    buffalo,
    cow,
    totalQty: round2(buffalo.totalQty + cow.totalQty),
    totalAmount: round2(buffalo.totalAmount + cow.totalAmount)
  };
};

export const inclusiveDayCount = (fromDate, toDate) => {
  const start = new Date(fromDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
};
