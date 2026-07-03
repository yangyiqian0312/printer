import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

function sanitizeFilePart(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
}

function fitText(doc, text, maxWidth, preferredSize, minimumSize) {
  let size = preferredSize;

  while (size > minimumSize) {
    doc.fontSize(size);
    if (doc.widthOfString(text) <= maxWidth) return size;
    size -= 1;
  }

  return minimumSize;
}

export async function createLabelPdf({ orderId, buyerUsername, outputDir, widthPt, heightPt }) {
  await fsPromises.mkdir(outputDir, { recursive: true });

  const fileName = `${sanitizeFilePart(orderId)}-${Date.now()}.pdf`;
  const filePath = path.resolve(outputDir, fileName);
  const qrPayload = String(orderId);
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 256
  });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [widthPt, heightPt],
      margin: 0,
      autoFirstPage: true
    });
    const stream = fs.createWriteStream(filePath);

    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    const padding = 6;
    const qrSize = Math.min(heightPt - padding * 2, 60);
    const qrX = padding;
    const qrY = (heightPt - qrSize) / 2;
    const textX = qrX + qrSize + 8;
    const textWidth = widthPt - textX - padding;

    doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });

    const normalizedBuyer = buyerUsername.startsWith('@') ? buyerUsername : `@${buyerUsername}`;
    doc.fillColor('#111111').font('Helvetica-Bold');
    fitText(doc, normalizedBuyer, textWidth, 16, 8);
    doc.text(normalizedBuyer, textX, 14, {
      width: textWidth,
      height: 20,
      ellipsis: true
    });

    doc.fillColor('#333333').font('Helvetica');
    fitText(doc, `#${orderId}`, textWidth, 10, 6);
    doc.text(`#${orderId}`, textX, 39, {
      width: textWidth,
      height: 14,
      ellipsis: true
    });

    doc.end();
  });

  return filePath;
}
