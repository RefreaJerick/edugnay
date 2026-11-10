const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { buildSf10Pages, isCompleteQuarterlySchedule } = require('../config/sf10');
const exportDirectory = path.join(os.tmpdir(), `academix-sf10-test-exports-${process.pid}`);
process.env.SF_EXPORT_DIRECTORY = exportDirectory;
const { createExportWorkbook, getEditableCells, getExportFilePath } = require('../config/sfExports');

const sourcePath = path.resolve(__dirname, '../../assets/templates/school-forms/sf10.xlsx');
const template = { formCode: 'SF10', filePath: '/assets/templates/school-forms/sf10.xlsx', sheetName: 'Front' };
const school = { schoolName: 'Test School', depedSchoolId: '001234', district: 'North', division: 'Division', region: 'Region' };
const learner = { lastName: 'Santos', firstName: 'Ana', middleName: 'Dela Cruz', lrn: '012345678901', birthDate: '2012-05-07', sex: 'Female' };

function history(year, grade, score) {
  const terms = [1, 2, 3, 4].map(id => ({ id, sequenceNumber: id }));
  return {
    section: { academicYear: year, gradeCode: `grade-${grade}`, name: 'Rizal', adviserName: 'Ms. Reyes' },
    subjects: [{ id: 10, code: 'filipino-jhs', name: 'Filipino' }],
    terms,
    grades: terms.map(term => ({ subjectId: 10, academicTermId: term.id, finalGrade: score }))
  };
}

function historyWithPeriods(year, grade, score, sequenceNumbers) {
  const terms = sequenceNumbers.map((sequenceNumber, index) => ({ id: index + 1, sequenceNumber }));
  return {
    section: { academicYear: year, gradeCode: `grade-${grade}`, name: 'Rizal', adviserName: 'Ms. Reyes' },
    subjects: [{ id: 10, code: 'filipino-jhs', name: 'Filipino' }],
    terms,
    grades: terms.map(term => ({ subjectId: 10, academicTermId: term.id, finalGrade: score }))
  };
}

test('SF10 download filenames resolve inside private storage', () => {
  const name = 'sf10-11111111-1111-1111-1111-111111111111.xlsx';
  assert.equal(getExportFilePath(name), path.join(exportDirectory, name));
  assert.equal(getExportFilePath(`../${name}`), path.join(exportDirectory, name));
  assert.throws(() => getExportFilePath('sf11-11111111-1111-1111-1111-111111111111.xlsx'));
  assert.throws(() => getExportFilePath('sf10-invalid.xlsx'));
});

test('SF10 fills recorded years in Front and Back blocks and leaves unused blocks empty', () => {
  const result = buildSf10Pages(school, learner, [
    history('2023-2024', 7, 88), history('2024-2025', 8, 89), history('2025-2026', 9, 90)
  ]);
  const front = new Map(result.pages[0].map(cell => [cell.cellAddress, cell.value]));
  const back = new Map(result.pages[1].map(cell => [cell.cellAddress, cell.value]));
  assert.equal(front.get('M8'), '012345678901');
  assert.equal(front.get('U26'), 88);
  assert.equal(front.get('U54'), 89);
  assert.equal(back.get('U8'), 90);
  assert.equal(back.has('U36'), false);
  assert.equal(front.has('AJ40'), false, 'general average requires separate review');
});

test('SF10 leaves incomplete finals blank and warns about missing grades', () => {
  const record = history('2025-2026', 7, 90);
  record.grades.pop();
  const result = buildSf10Pages(school, learner, [record]);
  const front = new Map(result.pages[0].map(cell => [cell.cellAddress, cell.value]));
  assert.equal(front.has('AJ26'), false);
  assert.ok(result.issues.some(issue => issue.fieldKey === 'grades'));
});

test('SF10 only fills grade cells for complete four-period schedules', () => {
  const quarterly = historyWithPeriods('2024-2025', 8, 89, [1, 2, 3, 4]);
  const threeTerm = historyWithPeriods('2023-2024', 7, 88, [1, 2, 3]);
  const result = buildSf10Pages(school, learner, [threeTerm, quarterly]);
  const front = new Map(result.pages[0].map(cell => [cell.cellAddress, cell.value]));

  assert.equal(front.has('U26'), false, 'three-term grades are not placed into quarter columns');
  assert.equal(front.get('U54'), 89, 'the separate quarterly year is populated');
  assert.ok(result.issues.some(issue => issue.fieldKey === 'periodStructure'
    && issue.message.includes('2023-2024') && issue.message.includes('three-term')));
  assert.ok(result.restrictedCells.some(cell => cell.pageIndex === 0 && cell.cellAddress === 'U26'));
  assert.ok(result.restrictedCells.some(cell => cell.pageIndex === 0 && cell.cellAddress === 'AJ26'));
  assert.ok(result.restrictedCells.some(cell => cell.pageIndex === 0 && cell.cellAddress === 'U33'));
  assert.ok(result.restrictedCells.some(cell => cell.pageIndex === 0 && cell.cellAddress === 'AJ33'));
  assert.ok(result.restrictedCells.some(cell => cell.pageIndex === 0 && cell.cellAddress === 'AJ40'));
  assert.ok(!result.restrictedCells.some(cell => cell.pageIndex === 0 && cell.cellAddress === 'U54'));
});

test('SF10 treats semestral, missing, and irregular schedules as incompatible', () => {
  const schedules = [
    historyWithPeriods('2023-2024', 7, 88, [1, 2]),
    historyWithPeriods('2024-2025', 8, 89, []),
    historyWithPeriods('2025-2026', 9, 90, [1, 2, 3, 5])
  ];
  schedules[1].terms = [];
  const result = buildSf10Pages(school, learner, schedules);
  const mapped = new Set(result.pages.flatMap(page => page.map(cell => cell.cellAddress)));

  assert.equal(isCompleteQuarterlySchedule([{ id: 1, sequenceNumber: 1 }, { id: 2, sequenceNumber: 2 },
    { id: 3, sequenceNumber: 3 }, { id: 4, sequenceNumber: 4 }]), true);
  assert.equal(isCompleteQuarterlySchedule([{ id: 1, sequenceNumber: 1 }, { id: 2, sequenceNumber: 2 },
    { id: 3, sequenceNumber: 3 }, { id: 4, sequenceNumber: 5 }]), false);
  assert.ok(!mapped.has('U8') && !mapped.has('U26') && !mapped.has('U54'));
  assert.equal(result.issues.filter(issue => issue.fieldKey === 'periodStructure').length, 3);
  assert.ok(result.restrictedCells.some(cell => cell.pageIndex === 1 && cell.cellAddress === 'U15'));
  assert.ok(result.restrictedCells.some(cell => cell.pageIndex === 1 && cell.cellAddress === 'AJ15'));
  assert.equal(result.restrictedCells.length, 3 * 51, 'each incompatible block locks its grade and rating cells');
});

test('SF10 leaves conflicting grades blank for review', () => {
  const record = history('2025-2026', 7, 90);
  record.grades.push({ subjectId: 10, academicTermId: 1, finalGrade: 85 });
  const result = buildSf10Pages(school, learner, [record]);
  const front = new Map(result.pages[0].map(cell => [cell.cellAddress, cell.value]));
  assert.equal(front.has('U26'), false);
  assert.equal(front.has('AJ26'), false);
  assert.ok(result.issues.some(issue => issue.fieldKey === 'grades' && issue.cellReference === 'U26'));
  assert.equal(result.pages[1].length, 0, 'other-school years are not invented');
});

test('SF10 export keeps all original sheets and package parts except populated worksheet XML', async () => {
  const source = await fs.promises.readFile(sourcePath);
  const original = await JSZip.loadAsync(source);
  const data = buildSf10Pages(school, learner, [history('2023-2024', 7, 88),
    history('2024-2025', 8, 89), history('2025-2026', 9, 90)]);
  data.pages[1].push({ cellAddress: 'AP8', value: 'Reviewed', type: 'text' });
  const output = await createExportWorkbook(template, data.pages);
  const generated = await JSZip.loadAsync(output);
  const changed = [];
  for (const [name, file] of Object.entries(original.files)) {
    if (file.dir) continue;
    const before = await file.async('nodebuffer');
    const after = await generated.file(name).async('nodebuffer');
    if (!before.equals(after)) changed.push(name);
  }
  assert.deepEqual(changed, ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet3.xml']);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Front', 'SirWedz Guides', 'Back']);
  assert.equal(workbook.getWorksheet('Front').getCell('M8').value, learner.lrn);
  assert.equal(workbook.getWorksheet('Back').getCell('U8').value, 90);
  assert.equal(workbook.getWorksheet('Back').getCell('AP8').value, 'Reviewed');
  assert.equal(workbook.getWorksheet('Front').pageSetup.printArea, 'B1:BD85');
  assert.equal(workbook.getWorksheet('Back').pageSetup.printArea, 'B1:BD95');
  const editable = await getEditableCells(template, data.pages[0]);
  assert.ok(editable.some(cell => cell.pageIndex === 0 && cell.cellAddress === 'M8' && cell.type === 'text'));
  assert.ok(editable.some(cell => cell.pageIndex === 1 && cell.cellAddress === 'U8'));
  assert.ok(!editable.some(cell => cell.cellAddress === 'B4'), 'printed labels stay protected');
});

test('SF10 preview uses adviser access, recorded years, and rejects stale export requests', async () => {
  const databaseModule = require('../config/database');
  const originalGetDatabase = databaseModule.getDatabase;
  let writes = 0;
  let gradeScore = 90;
  let generatedCount = 0;
  let savedFileName = null;
  let server = null;
  const periodCountByYear = { 1: 3, 2: 4, 3: 4 };
  const database = {
    async execute(sql, values = []) {
      if (sql.includes('SELECT sf_templates_enabled')) return [[{ sfTemplatesEnabled: 1 }]];
      if (sql.includes('FROM school_form_exports')) return [savedFileName && values[0] === 13
        && values[1] === 1 && values[2] === 3 ? [{ filePath: savedFileName, formCode: 'SF10' }] : []];
      if (sql.includes('INSERT INTO school_form_exports')) {
        generatedCount += 1;
        return [{ insertId: 13 }];
      }
      if (sql.includes('FROM school_form_templates')) return [[{
        id: 10, formCode: 'SF10', formName: 'SF10 JHS', version: 'jhs-2025',
        mappingStatus: 'ready', filePath: '/assets/templates/school-forms/sf10.xlsx',
        sheetName: 'Front', requiresAcademicTerm: 0
      }]];
      if (sql.includes('FROM sections') && sql.includes('sections.id = ?')) {
        return [values[2] === 3 ? [{ id: 8, name: 'Rizal', schoolId: 1, schoolLevelId: 2,
          gradeLevelId: 9, gradeCode: 'grade-9', academicYearId: 3,
          academicYear: '2025-2026', academicYearStatus: 'active',
          status: 'active', trackId: null, strandId: null }] : []];
      }
      if (sql.includes('FROM schools')) return [[school]];
      if (sql.includes('FROM section_students AS enrollment') && sql.includes('SELECT sections.id')) return [[
        { id: 6, name: 'Mabini', schoolLevelId: 2, gradeLevelId: 7,
          gradeCode: 'grade-7', academicYearId: 1, academicYear: '2023-2024',
          trackId: null, strandId: null, adviserName: 'Mr. Cruz' },
        { id: 7, name: 'Bonifacio', schoolLevelId: 2, gradeLevelId: 8,
          gradeCode: 'grade-8', academicYearId: 2, academicYear: '2024-2025',
          trackId: null, strandId: null, adviserName: 'Ms. Lim' },
        { id: 8, name: 'Rizal', schoolLevelId: 2, gradeLevelId: 9,
          gradeCode: 'grade-9', academicYearId: 3, academicYear: '2025-2026',
          trackId: null, strandId: null, adviserName: 'Ms. Reyes' }
      ]];
      if (sql.includes('FROM section_students') && sql.includes('INNER JOIN users')) return [[{
        userId: 12, profileUserId: 12, ...learner
      }]];
      if (sql.includes('FROM student_parent_links')) return [[]];
      if (sql.includes('FROM section_teachers')) return [[{ id: 10, code: 'filipino-jhs', name: 'Filipino' }]];
      if (sql.includes('FROM academic_terms')) {
        const yearId = Number(values[1]);
        return [Array.from({ length: periodCountByYear[yearId] || 0 }, (_, index) => ({
          id: index + 1, sequenceNumber: index + 1
        }))];
      }
      if (sql.includes('FROM published_final_grades')) {
        const yearId = Number(values[0]);
        return [Array.from({ length: periodCountByYear[yearId] || 0 }, (_, index) => ({
          studentId: 12, subjectId: 10, academicTermId: index + 1, finalGrade: gradeScore
        }))];
      }
      writes += 1;
      throw new Error(`Unexpected query: ${sql.slice(0, 60)}`);
    },
    async query(sql) {
      if (sql.includes('INSERT INTO school_form_export_issues')) return [{}];
      throw new Error(`Unexpected query: ${sql.slice(0, 60)}`);
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async execute(sql, values = []) {
          if (sql.includes('UPDATE school_form_exports SET export_status')) {
            savedFileName = values[0];
            return [{ affectedRows: 1 }];
          }
          if (sql.includes('INSERT INTO audit_logs')) return [{ insertId: 1 }];
          throw new Error(`Unexpected transaction query: ${sql.slice(0, 60)}`);
        },
        async commit() {},
        async rollback() {},
        release() {}
      };
    }
  };
  databaseModule.getDatabase = () => database;
  delete require.cache[require.resolve('../controllers/sfTemplatesController')];
  const controller = require('../controllers/sfTemplatesController');
  const call = (handler, user, method = 'GET', body = {}, query = {}) => new Promise(resolve => {
    const result = { status: 200 };
    const res = { status(code) { result.status = code; return this; },
      json(value) { result.body = value; resolve(result); return this; } };
    handler({ user, method, body, query, params: { templateId: '10' } }, res, error => {
      result.status = error.status || 500;
      result.error = error;
      resolve(result);
    });
  });
  try {
    const query = { sectionId: '8', studentId: '12' };
    const preview = await call(controller.previewTemplate, { id: 3, schoolId: 1 }, 'GET', {}, query);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.pages.length, 2);
    assert.ok(preview.body.pages[1].some(cell => cell.cellAddress === 'U8' && cell.value === 90));
    assert.ok(!preview.body.pages[0].some(cell => cell.cellAddress === 'U26'), 'three-term history stays blank');
    assert.ok(preview.body.issues.some(issue => issue.fieldKey === 'periodStructure'
      && issue.message.includes('2023-2024')));
    assert.ok(!preview.body.editableCells.some(cell => cell.pageIndex === 0 && cell.cellAddress === 'U26'));
    assert.ok(!preview.body.editableCells.some(cell => cell.pageIndex === 0 && cell.cellAddress === 'AJ26'));
    assert.ok(!preview.body.editableCells.some(cell => cell.pageIndex === 0 && cell.cellAddress === 'U33'));
    assert.ok(!preview.body.editableCells.some(cell => cell.pageIndex === 0 && cell.cellAddress === 'AJ33'));
    assert.ok(preview.body.editableCells.some(cell => cell.pageIndex === 1 && cell.cellAddress === 'AP8'));
    assert.equal((await call(controller.previewTemplate, { id: 4, schoolId: 1 }, 'GET', {}, query)).status, 403);
    const stale = await call(controller.generateTemplate, { id: 3, schoolId: 1 }, 'POST',
      { sectionId: 8, studentId: 12, previewFingerprint: '0'.repeat(64), edits: [] });
    assert.equal(stale.status, 409);
    gradeScore = 91;
    const changedGrade = await call(controller.generateTemplate, { id: 3, schoolId: 1 }, 'POST',
      { sectionId: 8, studentId: 12, previewFingerprint: preview.body.previewFingerprint, edits: [] });
    assert.equal(changedGrade.status, 409, 'changed source grades invalidate the preview');
    gradeScore = 90;
    periodCountByYear[1] = 4;
    const changedSchedule = await call(controller.generateTemplate, { id: 3, schoolId: 1 }, 'POST',
      { sectionId: 8, studentId: 12, previewFingerprint: preview.body.previewFingerprint, edits: [] });
    assert.equal(changedSchedule.status, 409, 'changed historical schedule invalidates the preview');
    periodCountByYear[1] = 3;
    const blockedGradeEdit = await call(controller.generateTemplate, { id: 3, schoolId: 1 }, 'POST',
      { sectionId: 8, studentId: 12, previewFingerprint: preview.body.previewFingerprint,
        edits: [{ pageIndex: 0, cellAddress: 'U33', value: 91 }] });
    assert.equal(blockedGradeEdit.status, 400, 'incompatible quarter cells reject crafted edits');
    const wrongSheetEdit = await call(controller.generateTemplate, { id: 3, schoolId: 1 }, 'POST',
      { sectionId: 8, studentId: 12, previewFingerprint: preview.body.previewFingerprint,
        edits: [{ pageIndex: 1, cellAddress: 'M8', value: 'changed' }] });
    assert.equal(wrongSheetEdit.status, 400);
    assert.equal(writes, 0);

    const generated = await call(controller.generateTemplate, { id: 3, schoolId: 1 }, 'POST',
      { sectionId: 8, studentId: 12, previewFingerprint: preview.body.previewFingerprint,
        edits: [{ pageIndex: 1, cellAddress: 'AP8', value: 'Reviewed' }] });
    assert.equal(generated.status, 201, generated.error?.message);
    assert.equal(generated.body.export.id, 13);
    assert.match(savedFileName, /^sf10-[a-f0-9-]{36}\.xlsx$/);

    const app = express();
    app.get('/download/:exportId', (req, res, next) => {
      req.user = { id: Number(req.query.userId || 3), schoolId: 1 };
      controller.downloadExport(req, res, next);
    });
    app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
    server = app.listen(0);
    const url = `http://127.0.0.1:${server.address().port}/download/13`;
    const downloaded = await fetch(url);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get('content-disposition'), /sf10-draft-export-13\.xlsx/);
    const bytes = Buffer.from(await downloaded.arrayBuffer());
    assert.deepEqual(bytes, await fs.promises.readFile(getExportFilePath(savedFileName)));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Front', 'SirWedz Guides', 'Back']);
    assert.equal(workbook.getWorksheet('Front').getCell('M8').value, learner.lrn);
    assert.equal(workbook.getWorksheet('Front').getCell('U26').value, null, 'three-term year stays blank');
    assert.equal(workbook.getWorksheet('Front').getCell('U54').value, 90);
    assert.equal(workbook.getWorksheet('Back').getCell('U8').value, 90);
    assert.equal(workbook.getWorksheet('Back').getCell('AP8').value, 'Reviewed');
    assert.equal(workbook.getWorksheet('Front').pageSetup.printArea, 'B1:BD85');
    assert.equal(workbook.getWorksheet('Back').pageSetup.printArea, 'B1:BD95');

    const retry = await fetch(url);
    assert.equal(retry.status, 200);
    assert.deepEqual(Buffer.from(await retry.arrayBuffer()), bytes);
    assert.equal(generatedCount, 1, 'retry uses the existing export');
    assert.equal((await fetch(`${url}?userId=4`)).status, 404);
    assert.equal(writes, 0);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (savedFileName) await fs.promises.unlink(getExportFilePath(savedFileName)).catch(() => {});
    databaseModule.getDatabase = originalGetDatabase;
    delete require.cache[require.resolve('../controllers/sfTemplatesController')];
  }
});
