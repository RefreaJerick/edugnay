const PDFDocument = require('pdfkit');

function pdfText(value) {
  return String(value ?? '')
    .replace(/â€“|â€”|[\u2012-\u2015]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, ' ');
}

function percent(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? 'Not available' : `${Number(value)}%`;
}

function archiveDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available'
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function createArchiveSummaryPdf(archive, schoolName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, right: 48, bottom: 0, left: 48 }, bufferPages: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const left = 48;
    const width = doc.page.width - 96;
    const bottom = doc.page.height - 68;
    const navy = '#20314B';
    const blue = '#3264A3';
    const muted = '#687991';
    const border = '#DBE3EE';
    let y = 48;

    function newPageIfNeeded(height) {
      if (y + height <= bottom) return;
      doc.addPage();
      y = 48;
    }

    function table(title, headers, rows, widths, emptyText) {
      newPageIfNeeded(72);
      doc.fillColor(navy).font('Helvetica-Bold').fontSize(11).text(title, left, y);
      y += 22;
      const drawHeader = () => {
        doc.rect(left, y, width, 27).fill('#EDF3FA');
        let x = left;
        headers.forEach((header, index) => {
          doc.fillColor(muted).font('Helvetica-Bold').fontSize(8)
            .text(header.toUpperCase(), x + 9, y + 9, { width: widths[index] - 18, lineBreak: false });
          x += widths[index];
        });
        y += 27;
      };
      drawHeader();
      if (!rows.length) rows = [[emptyText, ...headers.slice(1).map(() => '')]];
      rows.forEach(row => {
        doc.font('Helvetica').fontSize(9);
        const height = Math.max(27, ...row.map((value, index) =>
          doc.heightOfString(pdfText(value), { width: widths[index] - 18 }) + 12));
        if (y + height > bottom) {
          doc.addPage();
          y = 48;
          drawHeader();
        }
        let x = left;
        row.forEach((value, index) => {
          doc.fillColor(navy).font('Helvetica').fontSize(9)
            .text(pdfText(value), x + 9, y + 6, { width: widths[index] - 18 });
          x += widths[index];
        });
        y += height;
        doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.7).strokeColor(border).stroke();
      });
      y += 18;
    }

    doc.fillColor(blue).font('Helvetica-Bold').fontSize(11).text('EDUGNAY  /  ARCHIVE DATA', left, y);
    y += 23;
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(17)
      .text(pdfText(schoolName), left, y, { width });
    y += doc.heightOfString(pdfText(schoolName), { width }) + 9;
    doc.fontSize(15).text(`S.Y. ${pdfText(archive.label)}: Archive`, left, y, { width });
    y += 27;
    doc.fillColor(muted).font('Helvetica').fontSize(9)
      .text(`Archived on ${archiveDate(archive.archivedAt)}  |  By ${pdfText(archive.archivedBy || 'Unavailable')}`, left, y);
    y += 27;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor(blue).stroke();
    y += 22;

    const figures = [
      ['Students', Number(archive.students || 0).toLocaleString()],
      ['Teachers', Number(archive.teachers || 0).toLocaleString()],
      ['Sections', Number(archive.sections || 0).toLocaleString()],
      ['Pass rate', percent(archive.passRate)],
      ['Attendance', percent(archive.attendanceRate)]
    ];
    const cardGap = 9;
    const cardWidth = (width - cardGap * 2) / 3;
    figures.forEach(([label, value], index) => {
      const row = Math.floor(index / 3);
      const column = index % 3;
      const x = left + column * (cardWidth + cardGap);
      const top = y + row * 58;
      doc.rect(x, top, cardWidth, 51).fillAndStroke('#F7F9FC', border);
      doc.fillColor(navy).font('Helvetica-Bold').fontSize(17)
        .text(value, x + 9, top + 7, { width: cardWidth - 18, align: 'center' });
      doc.fillColor(muted).font('Helvetica-Bold').fontSize(8)
        .text(label.toUpperCase(), x + 9, top + 33, { width: cardWidth - 18, align: 'center' });
    });
    y += 124;

    table('SECTIONS', ['Section', 'Grade', 'Students', 'Pass rate'],
      (archive.sectionsTable || []).map(section => [section.name, section.grade,
        Number(section.students || 0).toLocaleString(), percent(section.passRate)]),
      [190, 110, 95, width - 395], 'No section records.');
    table('GRADING PERIODS', ['Period', 'Dates', 'Pass rate'],
      (archive.academicPeriods || []).map(period => [period.label, period.period, percent(period.passRate)]),
      [115, 275, width - 390], 'No grading-period records.');

    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(index);
      doc.moveTo(left, doc.page.height - 47).lineTo(left + width, doc.page.height - 47)
        .lineWidth(0.7).strokeColor(border).stroke();
      doc.fillColor(muted).font('Helvetica').fontSize(8)
        .text('Read-only archived school-year summary', left, doc.page.height - 36, { width: 350 })
        .text(`Page ${index + 1} of ${pages.count}`, left + width - 110, doc.page.height - 36,
          { width: 110, align: 'right' });
    }
    doc.end();
  });
}

module.exports = { createArchiveSummaryPdf };
