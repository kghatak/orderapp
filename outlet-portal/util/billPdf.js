import pdf from 'html-pdf';

/**
 * Convert thermal bill HTML to a PDF buffer.
 * @param {string} html
 * @returns {Promise<Buffer>}
 */
export function htmlToPdfBuffer(html) {
  return new Promise((resolve, reject) => {
    pdf
      .create(html, {
        width: '72mm',
        height: '297mm',
        border: '2mm',
        type: 'pdf',
        timeout: 30000
      })
      .toBuffer((err, buffer) => {
        if (err) reject(err);
        else resolve(buffer);
      });
  });
}
