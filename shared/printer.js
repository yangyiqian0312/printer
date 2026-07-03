import pdfToPrinter from 'pdf-to-printer';

const { getPrinters, print } = pdfToPrinter;

export async function printPdf(filePath, printerName) {
  const options = {
    scale: 'noscale',
    orientation: 'landscape'
  };

  if (printerName) {
    options.printer = printerName;
  }

  await print(filePath, options);
}

export async function listPrinters() {
  return getPrinters();
}
