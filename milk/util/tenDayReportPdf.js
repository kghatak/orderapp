import PDFDocument from 'pdfkit';

const fmt = (n, digits = 1) => {
  const num = Number(n) || 0;
  return num === 0 ? '' : num.toFixed(digits);
};

const fmtAmt = (n) => {
  const num = Number(n) || 0;
  return num === 0 ? '' : Math.round(num).toLocaleString('en-IN');
};

const COLS = [
  { key: 'date', label: 'Date', w: 58 },
  { key: 'mQty', label: 'Qnty', w: 38 },
  { key: 'mFat', label: 'Fat', w: 30 },
  { key: 'mMtr', label: 'Mtr.', w: 30 },
  { key: 'mRate', label: 'Rs./Kg', w: 42 },
  { key: 'mAmt', label: 'Amnt.', w: 48 },
  { key: 'eQty', label: 'Qnty', w: 38 },
  { key: 'eFat', label: 'Fat', w: 30 },
  { key: 'eMtr', label: 'Mtr.', w: 30 },
  { key: 'eRate', label: 'Rs./Kg', w: 42 },
  { key: 'eAmt', label: 'Amnt.', w: 48 },
  { key: 'tQty', label: 'T.Qnty', w: 48 },
  { key: 'tAmt', label: 'Amount', w: 54 }
];

const tableWidth = COLS.reduce((s, c) => s + c.w, 0);

const drawCell = (doc, x, y, w, h, text, opts = {}) => {
  const {
    fill = null,
    align = 'center',
    bold = false,
    textColor = '#000'
  } = opts;
  if (fill) {
    doc.save();
    doc.rect(x, y, w, h).fill(fill);
    doc.restore();
  }
  doc.rect(x, y, w, h).stroke('#333');
  doc.fillColor(textColor);
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7);
  doc.text(String(text ?? ''), x + 2, y + (h - 8) / 2, {
    width: w - 4,
    align,
    lineBreak: false
  });
  doc.fillColor('#000');
};

const drawMilkTable = (doc, title, section, left, top) => {
  const rowH = 16;
  const headerH = 28;
  let y = top;
  let x = left;

  doc.font('Helvetica-Bold').fontSize(11).text(title, left, y);
  y += 16;

  // Group header: Morning / Evening
  const morningW = COLS.slice(1, 6).reduce((s, c) => s + c.w, 0);
  const eveningW = COLS.slice(6, 11).reduce((s, c) => s + c.w, 0);
  drawCell(doc, x, y, COLS[0].w, headerH / 2, '', { fill: '#f0f0f0' });
  x += COLS[0].w;
  drawCell(doc, x, y, morningW, headerH / 2, 'Morning', { fill: '#e8f4ff', bold: true });
  x += morningW;
  drawCell(doc, x, y, eveningW, headerH / 2, 'Evening', { fill: '#fff4e6', bold: true });
  x += eveningW;
  drawCell(doc, x, y, COLS[11].w + COLS[12].w, headerH / 2, '', { fill: '#f0f0f0' });

  y += headerH / 2;
  x = left;
  for (const col of COLS) {
    drawCell(doc, x, y, col.w, headerH / 2, col.label, { fill: '#f5f5f5', bold: true });
    x += col.w;
  }
  y += headerH / 2;

  for (const row of section.rows) {
    const cells = [
      row.dateLabel,
      fmt(row.morning.quantity),
      fmt(row.morning.fat),
      fmt(row.morning.meter, 0),
      fmt(row.morning.ratePerKg),
      fmtAmt(row.morning.amount),
      fmt(row.evening.quantity),
      fmt(row.evening.fat),
      fmt(row.evening.meter, 0),
      fmt(row.evening.ratePerKg),
      fmtAmt(row.evening.amount),
      fmt(row.totalQty),
      fmtAmt(row.totalAmount)
    ];
    x = left;
    cells.forEach((text, i) => {
      const opts = {};
      if (i === 11) opts.textColor = '#c00';
      if (i === 12) opts.fill = '#d6ecff';
      drawCell(doc, x, y, COLS[i].w, rowH, text, opts);
      x += COLS[i].w;
    });
    y += rowH;
  }

  // Totals row
  x = left;
  drawCell(doc, x, y, COLS[0].w, rowH, 'Total', { bold: true, fill: '#eee' });
  x += COLS[0].w;
  for (let i = 1; i <= 10; i += 1) {
    drawCell(doc, x, y, COLS[i].w, rowH, '', { fill: '#eee' });
    x += COLS[i].w;
  }
  drawCell(doc, x, y, COLS[11].w, rowH, fmt(section.totalQty), {
    bold: true,
    fill: '#eee',
    textColor: '#c00'
  });
  x += COLS[11].w;
  drawCell(doc, x, y, COLS[12].w, rowH, fmtAmt(section.totalAmount), {
    bold: true,
    fill: '#d6ecff'
  });
  y += rowH + 8;

  return y;
};

/**
 * @returns {Promise<Buffer>}
 */
export const generateTenDayReportPdf = (report) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 28
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = (doc.page.width - tableWidth) / 2;

      doc.font('Helvetica-Bold').fontSize(14)
        .text(`${report.supplierName} — Milk Collection Report`, { align: 'center' });
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10)
        .text(`Period: ${report.fromDateLabel} to ${report.toDateLabel}`, { align: 'center' });
      doc.moveDown(0.8);

      let y = doc.y;
      y = drawMilkTable(
        doc,
        `${report.supplierName} — B Milk (Buffalo)`,
        report.buffalo,
        left,
        y
      );
      y += 10;
      y = drawMilkTable(
        doc,
        `${report.supplierName} — C Milk (Cow)`,
        report.cow,
        left,
        y
      );

      doc.font('Helvetica-Bold').fontSize(10)
        .text(
          `Combined Total Qty: ${fmt(report.totalQty)} Kg    Combined Amount: ₹ ${fmtAmt(report.totalAmount)}`,
          left,
          y + 4
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
