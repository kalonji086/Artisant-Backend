import PDFDocument from 'pdfkit';

export interface QuoteDocumentItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface QuoteDocumentData {
  quoteNumber: string;
  clientName: string;
  artisanName: string;
  profession: string;
  title: string;
  description: string;
  items: QuoteDocumentItem[];
  currency: string;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  validUntil: string | null;
  terms: string;
}

const money = (amount: number, currency: string) => {
  const fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return `${amount.toLocaleString('fr-FR', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })} ${currency}`;
};

export const renderQuotePdf = (quote: QuoteDocumentData): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];

    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));

    document.fontSize(22).font('Helvetica-Bold').text('DEVIS', { align: 'right' });
    document.moveDown();
    document.fontSize(10).font('Helvetica').text(`Référence : ${quote.quoteNumber}`);
    document.text(`Client : ${quote.clientName}`);
    document.text(`Artisan : ${quote.artisanName}${quote.profession ? ` — ${quote.profession}` : ''}`);
    document.moveDown();
    document.fontSize(15).font('Helvetica-Bold').text(quote.title);
    document.moveDown(0.5);
    if (quote.description) document.fontSize(10).font('Helvetica').text(quote.description);
    document.moveDown();

    const headerY = document.y;
    document.font('Helvetica-Bold').text('Désignation', 48, headerY, { width: 280 });
    document.text('Qté', 340, headerY, { width: 52, align: 'right' });
    document.text('Prix unitaire', 392, headerY, { width: 85, align: 'right' });
    document.text('Total', 477, headerY, { width: 70, align: 'right' });
    document.y = headerY + 18;

    for (const item of quote.items) {
      const fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency: quote.currency }).resolvedOptions().maximumFractionDigits ?? 2;
      const precision = 10 ** fractionDigits;
      const lineTotal = Math.round(item.quantity * item.unitPrice * precision) / precision;
      const descriptionHeight = document.heightOfString(item.description, { width: 280 });
      if (document.y + Math.max(descriptionHeight, 12) + 4 > document.page.height - 48) {
        document.addPage();
      }
      const rowY = document.y;
      document.font('Helvetica').text(item.description, 48, rowY, { width: 280 });
      document.text(String(item.quantity), 340, rowY, { width: 52, align: 'right' });
      document.text(money(item.unitPrice, quote.currency), 392, rowY, { width: 85, align: 'right' });
      document.text(money(lineTotal, quote.currency), 477, rowY, { width: 70, align: 'right' });
      document.y = rowY + Math.max(descriptionHeight, 12) + 4;
    }

    document.moveDown();
    document.font('Helvetica').text(`Sous-total : ${money(quote.subtotal, quote.currency)}`, { align: 'right' });
    document.text(`TVA (${quote.taxRate} %) : ${money(quote.taxAmount, quote.currency)}`, { align: 'right' });
    document.font('Helvetica-Bold').text(`Total TTC : ${money(quote.total, quote.currency)}`, { align: 'right' });
    if (quote.validUntil) {
      document.moveDown();
      document.font('Helvetica').text(`Valable jusqu’au : ${quote.validUntil}`);
    }
    if (quote.terms) {
      document.moveDown();
      document.font('Helvetica-Bold').text('Conditions');
      document.font('Helvetica').text(quote.terms);
    }

    document.end();
  });
