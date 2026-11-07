import PDFDocument from 'pdfkit';
import path from 'path';

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
  branding: {
    platformName: string;
    socials: { label: string; url: string }[];
    privacyUrl: string;
    termsUrl: string;
  };
}

const NAVY = '#102D52';
const BLUE = '#007AFF';
const ORANGE = '#F58220';
const PAGE_MARGIN = 48;
const HEADER_SPACE = 88;
const FOOTER_SPACE = 100;

const money = (amount: number, currency: string) => {
  const fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return `${amount.toLocaleString('fr-FR', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })} ${currency}`;
};

const drawBrandHeader = (document: PDFKit.PDFDocument, quote: QuoteDocumentData) => {
  const { width } = document.page;
  document.save();
  document.rect(0, 0, width, 7).fill(BLUE);
  document.rect(0, 7, width, 3).fill(ORANGE);
  document.image(path.resolve(__dirname, '../../public/logo.png'), PAGE_MARGIN, 22, { fit: [42, 42] });
  document.fillColor(NAVY).font('Helvetica-Bold').fontSize(13)
    .text(quote.branding.platformName, PAGE_MARGIN + 52, 29, { width: 250 });
  document.fillColor(BLUE).font('Helvetica-Bold').fontSize(17)
    .text('DEVIS', width - 150, 30, { width: 102, align: 'right' });
  document.restore();
};

const drawBrandFooter = (document: PDFKit.PDFDocument, quote: QuoteDocumentData) => {
  const { width, height } = document.page;
  const footerY = height - FOOTER_SPACE;
  const innerWidth = width - PAGE_MARGIN * 2;
  document.save();
  document.rect(0, footerY, width, FOOTER_SPACE).fill(NAVY);
  document.rect(0, footerY, width, 4).fill(ORANGE);
  document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);

  let socialX = PAGE_MARGIN;
  const socialY = footerY + 16;
  for (const social of quote.branding.socials) {
    const label = social.label;
    const labelWidth = document.widthOfString(label) + 14;
    if (socialX + labelWidth > width - PAGE_MARGIN) break;
    document.fillColor('#FFFFFF').text(label, socialX, socialY, {
      link: social.url,
      underline: true,
      continued: false,
    });
    socialX += labelWidth;
  }

  document.fillColor('#FFFFFF').font('Helvetica').fontSize(8);
  document.text('Mentions légales et confidentialité', PAGE_MARGIN, footerY + 39, {
    link: quote.branding.privacyUrl,
    underline: true,
  });
  document.text("Conditions d'utilisation", PAGE_MARGIN + 178, footerY + 39, {
    link: quote.branding.termsUrl,
    underline: true,
  });
  document.fillColor('#DCE6F2').fontSize(7).text(
    `© ${new Date().getFullYear()} ${quote.branding.platformName} · ${quote.quoteNumber}`,
    PAGE_MARGIN,
    footerY + 61,
    { width: innerWidth, align: 'center' },
  );
  document.restore();
};

export const renderQuotePdf = (quote: QuoteDocumentData): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      margins: { top: HEADER_SPACE, right: PAGE_MARGIN, bottom: FOOTER_SPACE, left: PAGE_MARGIN },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];

    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));

    document.fontSize(10).font('Helvetica').text(`Référence : ${quote.quoteNumber}`);
    document.text(`Client : ${quote.clientName}`);
    document.text(`Artisan : ${quote.artisanName}${quote.profession ? ` — ${quote.profession}` : ''}`);
    document.moveDown();
    document.fontSize(15).font('Helvetica-Bold').text(quote.title);
    document.moveDown(0.5);
    if (quote.description) document.fontSize(10).font('Helvetica').text(quote.description);
    document.moveDown();

    const headerY = document.y;
    document.font('Helvetica-Bold').text('Désignation', PAGE_MARGIN, headerY, { width: 280 });
    document.text('Qté', 340, headerY, { width: 52, align: 'right' });
    document.text('Prix unitaire', 392, headerY, { width: 85, align: 'right' });
    document.text('Total', 477, headerY, { width: 70, align: 'right' });
    document.y = headerY + 18;

    for (const item of quote.items) {
      const fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency: quote.currency }).resolvedOptions().maximumFractionDigits ?? 2;
      const precision = 10 ** fractionDigits;
      const lineTotal = Math.round(item.quantity * item.unitPrice * precision) / precision;
      const descriptionHeight = document.heightOfString(item.description, { width: 280 });
      if (document.y + Math.max(descriptionHeight, 12) + 4 > document.page.height - FOOTER_SPACE) {
        document.addPage();
      }
      const rowY = document.y;
      document.font('Helvetica').text(item.description, PAGE_MARGIN, rowY, { width: 280 });
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

    const pages = document.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index += 1) {
      document.switchToPage(index);
      drawBrandHeader(document, quote);
      drawBrandFooter(document, quote);
    }
    document.end();
  });
