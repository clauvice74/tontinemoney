import PDFDocument from 'pdfkit';

/**
 * Rendu des rapports : CSV (séparateur « ; », protégé contre l'injection de formules) et PDF
 * (pdfkit, polices standard). Aucune donnée d'identité sensible n'est incluse (noms uniquement).
 */
export interface ReportTable {
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

export interface ReportDocument {
  title: string;
  subtitle?: string;
  generatedAt: Date;
  summary?: Array<[string, string]>;
  sections: Array<{ heading: string; table?: ReportTable; lines?: string[] }>;
  footer?: string;
}

/** Neutralise les formules (=, +, -, @, tabulation) interprétées par les tableurs. */
function csvCell(v: string | number | null): string {
  let s = v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: ReportTable): string {
  return [
    '\uFEFF' + table.columns.map(csvCell).join(';'),
    ...table.rows.map((r) => r.map(csvCell).join(';')),
  ].join('\r\n');
}

/** Les polices standard PDF (WinAnsi) ne couvrent pas certains caractères typographiques. */
function pdfText(v: string): string {
  return v
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
}

export async function toPdf(doc: ReportDocument): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: { Title: pdfText(doc.title), Author: 'TontineMoney', CreationDate: doc.generatedAt },
  });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    pdf.on('end', () => resolve(Buffer.concat(chunks))),
  );
  const width = pdf.page.width - 80;

  pdf.fontSize(18).font('Helvetica-Bold').text(pdfText(doc.title));
  if (doc.subtitle)
    pdf
      .moveDown(0.2)
      .fontSize(11)
      .font('Helvetica')
      .fillColor('#555')
      .text(pdfText(doc.subtitle))
      .fillColor('#000');
  pdf
    .moveDown(0.2)
    .fontSize(8)
    .fillColor('#777')
    .text(pdfText(`Généré le ${doc.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`))
    .fillColor('#000');
  if (doc.summary?.length) {
    pdf.moveDown(0.8);
    for (const [k, v] of doc.summary)
      pdf
        .fontSize(10)
        .font('Helvetica-Bold')
        .text(pdfText(`${k} : `), { continued: true })
        .font('Helvetica')
        .text(pdfText(v));
  }
  for (const section of doc.sections) {
    pdf.moveDown(1).fontSize(13).font('Helvetica-Bold').text(pdfText(section.heading));
    pdf.moveDown(0.3).fontSize(9).font('Helvetica');
    for (const line of section.lines ?? []) pdf.text(pdfText(line));
    if (section.table) {
      const cols = section.table.columns.length;
      const colW = width / cols;
      const drawRow = (cells: Array<string | number | null>, bold: boolean) => {
        if (pdf.y > pdf.page.height - 60) pdf.addPage();
        const y = pdf.y;
        pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        let maxH = 0;
        cells.forEach((c, i) => {
          const text = pdfText(c === null ? '' : String(c));
          const h = pdf.heightOfString(text, { width: colW - 4 });
          maxH = Math.max(maxH, h);
          pdf.text(text, 40 + i * colW, y, { width: colW - 4 });
        });
        pdf.x = 40;
        pdf.y = y + maxH + 4;
      };
      drawRow(section.table.columns, true);
      pdf
        .moveTo(40, pdf.y - 2)
        .lineTo(40 + width, pdf.y - 2)
        .strokeColor('#ccc')
        .stroke();
      for (const r of section.table.rows) drawRow(r, false);
      if (section.table.rows.length === 0)
        pdf.font('Helvetica-Oblique').text('Aucune donnée pour cette période.');
    }
  }
  if (doc.footer)
    pdf
      .moveDown(1.5)
      .fontSize(7)
      .fillColor('#777')
      .text(pdfText(doc.footer), 40, undefined, { width });
  pdf.end();
  return done;
}
