const PDFDocument = require('pdfkit');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { logoDirectory } = require('../config/schoolLogos');

const PERIOD_NAMES = { quarterly: 'Quarter', semestral: 'Semester', semester: 'Semester', trimestral: 'Trimester', three_term: 'Term' };
const PERIOD_COUNTS = { quarterly: 4, semestral: 2, semester: 2, trimestral: 3, three_term: 3 };

function buildStudentGradeCopy(overview, academicYearId) {
  const year = overview.academicYears.find(item => String(item.id) === String(academicYearId));
  if (!year) return null;

  const periods = new Map();
  const includedGrades = new Set();
  const ensurePeriod = (type, number, name) => {
    const key = `${type}:${number}`;
    if (!periods.has(key)) periods.set(key, { key, number, label: name || `${PERIOD_NAMES[type] || 'Period'} ${number}`, rows: [] });
    return periods.get(key);
  };
  const gradeFor = (termId, subjectId, sectionId, electiveClassId) => overview.publishedGrades.find(grade =>
    String(grade.academicYearId) === String(year.id)
    && String(grade.academicTermId) === String(termId)
    && (electiveClassId
      ? String(grade.electiveClassId) === String(electiveClassId)
      : grade.electiveClassId == null && String(grade.sectionId) === String(sectionId)
        && String(grade.subjectId) === String(subjectId)));
  const addRow = (period, code, name, grade) => {
    if (grade) includedGrades.add(grade);
    const value = grade?.finalGrade == null ? null : Number(grade.finalGrade);
    const finalGrade = Number.isFinite(value) ? value : null;
    period.rows.push({ code: code || '—', name: name || 'Subject', finalGrade });
  };

  for (const section of year.sections || []) {
    const type = section.gradingPeriodType || 'period';
    const terms = section.terms || [];
    const expectedCount = PERIOD_COUNTS[type] || terms.length;
    for (let number = 1; number <= Math.max(expectedCount, terms.length); number += 1) {
      const term = terms.find(item => Number(item.sequenceNumber) === number);
      const period = ensurePeriod(type, number, term?.name);
      if (!term) continue;
      for (const subject of section.subjects || []) {
        addRow(period, subject.subjectCode, subject.subjectName,
          gradeFor(term.id, subject.subjectId, section.id, null));
      }
    }
  }
  for (const elective of year.electiveClasses || []) {
    const type = elective.gradingPeriodType || 'period';
    for (const term of elective.terms || []) {
      const period = ensurePeriod(type, Number(term.sequenceNumber), term.name);
      addRow(period, elective.subjectCode, elective.subjectName,
        gradeFor(term.id, null, null, elective.classId));
    }
  }
  for (const grade of overview.publishedGrades) {
    if (String(grade.academicYearId) !== String(year.id) || includedGrades.has(grade)) continue;
    const type = grade.gradingPeriodType || 'period';
    const number = Number(grade.academicTermSequenceNumber || 1);
    addRow(ensurePeriod(type, number, grade.academicTermName),
      grade.subjectCode || grade.catalogCode, grade.subjectName, grade);
  }

  const groups = [...periods.values()].sort((a, b) => a.number - b.number || a.label.localeCompare(b.label));
  groups.forEach(group => {
    group.rows.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
    group.gwa = group.rows.length && group.rows.every(row => row.finalGrade !== null)
      ? group.rows.reduce((sum, row) => sum + row.finalGrade, 0) / group.rows.length
      : null;
  });
  return { year, groups };
}

async function prepareStudentGradeLogo(buffer) {
  try {
    return await sharp(buffer).resize(96, 96, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch {
    return null;
  }
}

async function loadStudentGradeLogo(logoPath) {
  if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(logoPath || '')) return null;
  try {
    return await prepareStudentGradeLogo(await fs.readFile(path.join(logoDirectory, logoPath)));
  } catch {
    return null;
  }
}

function createStudentGradePdf(copy, { schoolName, studentName, schoolLogo = null }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
      Title: 'Student Copy of Grades', Author: 'AcadeMix'
    } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const navy = '#102746';
    const blue = '#1E4884';
    const gray = '#66758A';
    const border = '#D9E2EE';
    const left = 48;
    const right = 547;
    const codeX = 58;
    const nameX = 171;
    const gradeX = 473;
    const pageBottom = 745;
    let y = 48;

    const drawWatermark = () => {
      doc.save();
      doc.fillColor('#1E4884').fillOpacity(0.08).font('Helvetica-Bold').fontSize(64)
        .rotate(-35, { origin: [297, 421] })
        .text('UNOFFICIAL', 80, 385, { width: 435, align: 'center', lineBreak: false });
      doc.restore();
    };
    doc.on('pageAdded', drawWatermark);
    drawWatermark();

    const newPageIfNeeded = height => {
      if (y + height <= pageBottom) return;
      doc.addPage();
      y = 48;
    };
    const line = (atY, color = border) => doc.moveTo(left, atY).lineTo(right, atY).lineWidth(0.7).strokeColor(color).stroke();
    const groupHeader = (label, continued = false) => {
      doc.fillColor(blue).font('Helvetica-Bold').fontSize(11)
        .text(label.toUpperCase() + (continued ? ' (CONTINUED)' : ''), left, y);
      y += 21;
      doc.rect(left, y, right - left, 25).fill('#EDF3FB');
      doc.fillColor(navy).font('Helvetica-Bold').fontSize(8)
        .text('SUBJECT CODE', codeX, y + 8, { width: 105 })
        .text('SUBJECT NAME', nameX, y + 8, { width: 285 })
        .text('GRADE', gradeX, y + 8, { width: 64, align: 'right' });
      y += 25;
    };

    const schoolLabel = String(schoolName || 'School');
    const schoolTextX = schoolLogo ? left + 52 : left;
    const schoolTextWidth = 420 - schoolTextX;
    if (schoolLogo) doc.image(schoolLogo, left, y, { fit: [40, 40] });
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(14)
      .text(schoolLabel, schoolTextX, y, { width: schoolTextWidth });
    const schoolNameHeight = doc.heightOfString(schoolLabel, { width: schoolTextWidth });
    doc.fillColor(blue).font('Helvetica-Bold').fontSize(12)
      .text('AcadeMix', 435, y, { width: 112, align: 'right' });
    y += Math.max(schoolLogo ? 40 : 18, schoolNameHeight) + 8;
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(16)
      .text('STUDENT COPY OF GRADES', schoolTextX, y, { width: right - schoolTextX });
    y += 29;
    line(y, blue);
    y += 18;
    doc.fillColor(gray).font('Helvetica').fontSize(9).text('STUDENT', left, y);
    doc.text('SCHOOL YEAR', 365, y);
    y += 14;
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(11)
      .text(String(studentName || 'Student'), left, y, { width: 300 });
    doc.text(String(copy.year.label), 365, y, { width: 182 });
    y += Math.max(32, doc.heightOfString(String(studentName || 'Student'), { width: 300 }) + 15);

    if (!copy.groups.length) {
      doc.fillColor(gray).font('Helvetica').fontSize(10).text('No subjects are available for this school year.', left, y);
      y += 34;
    }
    for (const group of copy.groups) {
      newPageIfNeeded(66);
      groupHeader(group.label);
      if (!group.rows.length) {
        doc.fillColor(gray).font('Helvetica').fontSize(9).text('No subjects assigned yet.', nameX, y + 10);
        y += 34;
      }
      for (const row of group.rows) {
        doc.font('Helvetica').fontSize(9);
        const rowHeight = Math.max(31,
          doc.heightOfString(row.code, { width: 103 }) + 14,
          doc.heightOfString(row.name, { width: 287 }) + 14);
        if (y + rowHeight + 26 > pageBottom) {
          doc.addPage();
          y = 48;
          groupHeader(group.label, true);
        }
        doc.fillColor(navy).font('Helvetica').fontSize(9).text(row.code, codeX, y + 9, { width: 103 });
        doc.text(row.name, nameX, y + 9, { width: 287 });
        doc.font('Helvetica-Bold').text(row.finalGrade === null ? 'Not published' : row.finalGrade.toFixed(1),
          gradeX - 22, y + 9, { width: 86, align: 'right' });
        y += rowHeight;
        line(y);
      }
      if (y + 64 > pageBottom) {
        doc.addPage();
        y = 48;
        groupHeader(group.label, true);
      }
      doc.rect(left, y + 8, right - left, 39).fill('#EDF3FB');
      doc.fillColor(navy).font('Helvetica-Bold').fontSize(10).text('GWA', left + 12, y + 21);
      doc.fillColor(blue).fontSize(11).text(group.gwa === null ? 'Pending' : group.gwa.toFixed(1),
        gradeX - 22, y + 20, { width: 86, align: 'right' });
      y += 67;
    }

    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(index);
      line(763);
      doc.fillColor(gray).font('Helvetica').fontSize(8)
        .text('Student copy generated through AcadeMix', left, 772, { width: 360 })
        .text(`Page ${index + 1} of ${pages.count}`, 445, 772, { width: 102, align: 'right' });
    }
    doc.end();
  });
}

module.exports = { buildStudentGradeCopy, createStudentGradePdf, loadStudentGradeLogo, prepareStudentGradeLogo };
