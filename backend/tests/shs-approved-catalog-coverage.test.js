const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CATALOG_VERSION, GUIDE_INDEX, GRADE_11_GUIDE_INDEX, GRADE_12_GUIDE_INDEX, GRADE_11_TECHPRO_INDEX,
  STRENGTHENED_ORDER, TIME_ALLOTMENT, catalog, getCatalogEntry, matchesCatalogSnapshot,
  isCatalogGradeEligible, isCatalogAvailableForNewUse
} = require('../config/shsApprovedCatalog');
const { DEPED_SHS_CORE_SUBJECTS } = require('../config/depedShsCoreSubjects');

const academicNames = [
  'Contemporary Literature 1', 'Contemporary Literature 2', 'Creative Composition 1', 'Creative Composition 2',
  'Citizenship and Civic Engagement', 'Introduction to the Philosophy of the Human Person',
  'Business 1 (Basic Accounting)', 'Business 2 (Business Finance and Income Taxation)',
  'Business 3 (Business Economics)', 'Entrepreneurship', 'Biology 1', 'Biology 2', 'Chemistry 1', 'Chemistry 2',
  'Earth and Space Science 1', 'Earth and Space Science 2', 'Finite Mathematics 1', 'Finite Mathematics 2',
  'Physics 1', 'Physics 2', 'Creative Industries - Visual Arts', 'Creative Industries - Literary Arts',
  'Creative Industries - Media Arts', 'Creative Industries - Applied and Traditional Arts', 'Creative Industries - Music',
  'Creative Industries - Dance', 'Creative Industries - Theater Arts',
  'Filipino 1 (Wika at Komunikasyon sa Akademikong Filipino)',
  'Filipino 2 (Filipino sa Larang Teknikal-Propesyonal)', 'Filipino 2 (Filipino sa Isports)',
  'Filipino 2 (Filipino sa Sining at Disenyo)', 'Filipino Identity Through the Arts',
  'Leadership and Management in the Arts', 'Malikhaing Pagsulat',
  'Philippine Governance (Philippine Politics and Governance)', 'Social Sciences (Theory and Practice)',
  'Contemporary Marketing', 'Introduction to Organization and Management', 'Creative Production and Presentation',
  'Advanced Mathematics', 'Basic Calculus', 'Biology 3', 'Biology 4', 'Chemistry 3', 'Chemistry 4',
  'Conceptual Biology and Earth and Space Science', 'Conceptual Physics and Chemistry in Daily Life',
  'Database Management', 'Earth and Space Science 3', 'Earth and Space Science 4', 'Empowerment Technologies',
  'Fundamentals of Data Analytics', 'Physics 3', 'Physics 4', 'Pre-Calculus',
  'Human Movement 1 (Basic Anatomy in Sports and Exercise)', 'Human Movement 2 (Motor Skills Development)',
  'Physical Education 1 (Fitness and Recreation)', 'Physical Education 2 (Sports and Dance)',
  'Sports Activity Management', 'Sports Coaching', 'Sports Officiating', 'Art Criticism and Creative Markets',
  'Performance Criticism and Creative Markets', 'Exercise and Sports Programming', 'First Aid',
  'Fundamentals of Basic Life Support'
];
const fieldExperience = [
  ['WI-ACADEMIC-320', 'Work Immersion for Academic Track'],
  ['AA-DANCE', 'Arts Apprenticeship - Dance'],
  ['AA-LITERARY', 'Arts Apprenticeship - Literary Arts'],
  ['AA-MEDIA', 'Arts Apprenticeship - Media Arts'],
  ['AA-MUSIC', 'Arts Apprenticeship - Music'],
  ['AA-THEATER', 'Arts Apprenticeship - Theater Arts'],
  ['AA-TRADITIONAL', 'Arts Apprenticeship - Traditional Cultural Expressions'],
  ['AA-VISUAL', 'Arts Apprenticeship - Visual Arts'],
  ['FE-DESIGN-INNOVATION', 'Design and Innovation'],
  ['FE-RESEARCH-1', 'Research 1'], ['FE-RESEARCH-2', 'Research 2'],
  ['FE-SPORTS-INCAMPUS', 'In-Campus Field Exposure for Sports'],
  ['FE-OFFCAMPUS', 'Field Exposure (Off Campus)']
];
const techProNames = [
  ['TP-AWHC-01', 'Aesthetic Services (Beauty Care)'], ['TP-AWHC-02', 'Caregiving (Adult Care)'],
  ['TP-AWHC-03', 'Caregiving (Child Care)'], ['TP-AWHC-04', 'Hairdressing Services'],
  ['TP-AF-01', 'Agricultural Crops Production'], ['TP-AF-02', 'Agro-entrepreneurship'], ['TP-AF-03', 'Aquaculture'],
  ['TP-AF-04', 'Fish Capture Operation'], ['TP-AF-05', 'Food Processing'], ['TP-AF-06', 'Organic Agriculture Production'],
  ['TP-AF-07', 'Poultry Production (Chicken)'], ['TP-AF-08', 'Ruminants Production'], ['TP-AF-09', 'Swine Production'],
  ['TP-ACE-01', 'Garments Artisanry'], ['TP-ACE-02', 'Handicrafts: Weaving'],
  ['TP-AUTO-01', 'Automotive Servicing (Electrical Repair)'],
  ['TP-AUTO-02', 'Automotive Servicing (Engine and Chassis Repairs)'],
  ['TP-AUTO-03', 'Driving and Automotive Servicing'], ['TP-AUTO-04', 'Motorcycle and Small Engine Servicing'],
  ['TP-CBT-01', 'Carpentry'], ['TP-CBT-02', 'Construction Operation'], ['TP-CBT-03', 'Manual Metal Arc Welding'],
  ['TP-CBT-04', 'Technical Drafting'], ['TP-CADT-01', 'Animation'], ['TP-CADT-02', 'Illustration'],
  ['TP-CADT-03', 'Visual Graphic Design'], ['TP-HT-01', 'Bakery Operations'], ['TP-HT-02', 'Events Management Services'],
  ['TP-HT-03', 'Food and Beverage Operation'], ['TP-HT-04', 'Hotel Operations (Front Office Services)'],
  ['TP-HT-05', 'Hotel Operations (Housekeeping Services)'], ['TP-HT-06', 'Kitchen Operations'], ['TP-HT-07', 'Tourism Services'],
  ['TP-ICT-01', 'Broadband Installation'], ['TP-NET', 'Computer Programming (.NET Technology)'],
  ['TP-JAVA', 'Computer Programming (Java)'], ['TP-ICT-04', 'Computer Programming (Oracle Database)'],
  ['TP-ICT-05', 'Computer Systems Servicing'], ['TP-ICT-06', 'Contact Center Services'],
  ['TP-IND-01', 'Commercial Air-Conditioning Installation and Servicing'],
  ['TP-IND-02', 'Domestic Refrigeration and Air-Conditioning Servicing'],
  ['TP-IND-03', 'Electrical Installation and Maintenance'],
  ['TP-IND-04', 'Electronic Products Assembly and Servicing'], ['TP-IND-05', 'Mechatronics'],
  ['TP-IND-06', 'Photovoltaic Systems Installation'], ['TP-MAR-01', 'Marine Engineering at the Support Level'],
  ['TP-MAR-02', 'Marine Transportation at the Support Level'], ['TP-MAR-03', 'Ships Catering Services']
];
const expectedRows = [
  ...academicNames.map((name, index) => [`AE${String(index + 1).padStart(3, '0')}`, name]),
  ...fieldExperience,
  ...techProNames,
  ['WI-320', 'Work Immersion for Tech-Pro Track'], ['WI-540', 'Work Immersion for Tech-Pro Track'],
  ['WI-640', 'Work Immersion for Tech-Pro Track']
];
const groupCounts = items => items.reduce((counts, item) => {
  counts[item.catalogGroup] = (counts[item.catalogGroup] || 0) + 1;
  return counts;
}, {});

test('the complete catalog matches the checked official Strengthened SHS subject list', () => {
  assert.equal(catalog.length, 131);
  assert.equal(new Set(catalog.map(item => item.code)).size, catalog.length, 'catalog codes must be unique');
  assert.deepEqual(catalog.map(({ code, name }) => [code, name]), expectedRows);
  assert.deepEqual(groupCounts(catalog), {
    academic_electives: 67, field_experience: 13, techpro_electives: 48, techpro_work_immersion: 3
  });

  for (const item of catalog) {
    assert.ok(item.sourceUrl && item.policyUrl === STRENGTHENED_ORDER, item.code);
    assert.equal(item.timeAllotmentUrl, TIME_ALLOTMENT, item.code);
    assert.ok(item.sourceTitle && item.sourceBasis, item.code);
    assert.ok(['academic', 'techpro'].includes(item.trackCode), item.code);
    assert.ok(Number.isInteger(item.hours) && item.hours > 0, item.code);
    assert.ok(item.grades.length && item.grades.every(grade => [11, 12].includes(grade)), item.code);
    if (item.sourceBasis === 'released_curriculum_guides') assert.ok(item.guideUrl, item.code);
    else assert.equal(item.guideUrl, null, item.code);
    assert.ok(item.gradeSourceUrls.length, `grade source is required for ${item.code}`);
  }
  assert.equal(getCatalogEntry('NOT-A-DEPED-SUBJECT'), null);
});

test('Grade 11 core subjects stay separate from electives and use the official five-subject list', () => {
  assert.deepEqual(DEPED_SHS_CORE_SUBJECTS.map(({ code, name }) => [code, name]), [
    ['shs-core-communication', 'Effective Communication / Mabisang Komunikasyon'],
    ['shs-core-life-career', 'Life and Career Skills'],
    ['shs-core-mathematics', 'General Mathematics'],
    ['shs-core-science', 'General Science'],
    ['shs-core-philippine-history', 'Pag-aaral ng Kasaysayan at Lipunang Pilipino']
  ]);
  for (const subject of DEPED_SHS_CORE_SUBJECTS) {
    assert.deepEqual(subject.gradeCodes, ['grade-11'], subject.code);
    assert.equal(subject.hours, 160, subject.code);
    assert.ok(subject.sourceUrl.includes('deped.gov.ph'), subject.code);
    assert.equal(subject.hoursUrl, TIME_ALLOTMENT, subject.code);
    assert.equal(subject.policyUrl, STRENGTHENED_ORDER, subject.code);
    assert.equal(getCatalogEntry(subject.code), null, 'core subjects are not selectable as electives');
  }
});

test('every catalog record has the checked track, category, grade eligibility, and time allotment', () => {
  const grade12Only = new Set([
    'AE009', 'AE039', 'AE043', 'AE045', 'AE046', 'AE047', 'AE048', 'AE050', 'AE052', 'AE054',
    'WI-ACADEMIC-320', 'AA-DANCE', 'AA-LITERARY', 'AA-MEDIA', 'AA-MUSIC', 'AA-THEATER',
    'AA-TRADITIONAL', 'AA-VISUAL', 'FE-SPORTS-INCAMPUS', 'FE-OFFCAMPUS',
    'TP-AUTO-01', 'TP-AUTO-02', 'TP-IND-01', 'TP-IND-05',
    'WI-320', 'WI-540', 'WI-640'
  ]);
  const hoursByCode = new Map([
    ['AE039', 160], ['WI-ACADEMIC-320', 320], ['AA-DANCE', 160], ['AA-LITERARY', 160], ['AA-MEDIA', 160],
    ['AA-MUSIC', 160], ['AA-THEATER', 160], ['AA-TRADITIONAL', 160], ['AA-VISUAL', 160],
    ['FE-SPORTS-INCAMPUS', 160], ['WI-320', 320], ['WI-540', 540], ['WI-640', 640]
  ]);
  const expectedType = {
    academic_electives: ['academic', 'academic_elective'], field_experience: ['academic', 'academic_elective'],
    techpro_electives: ['techpro', 'techpro_elective'], techpro_work_immersion: ['techpro', 'work_immersion']
  };

  for (const item of catalog) {
    const expectedGrades = grade12Only.has(item.code) ? [12] : [11, 12];
    assert.deepEqual(item.grades, expectedGrades, item.code);
    assert.deepEqual([item.trackCode, item.type], expectedType[item.catalogGroup], item.code);
    const expectedHours = hoursByCode.get(item.code)
      ?? (item.catalogGroup === 'techpro_electives' ? 320 : 80);
    assert.equal(item.hours, expectedHours, item.code);
    if (item.catalogGroup === 'academic_electives' && item.verificationStatus === 'verified')
      assert.equal(item.hoursUnit, 'per_term', item.code);
    if (item.catalogGroup === 'techpro_electives') {
      for (const grade of item.grades)
        assert.equal(item.hoursUnitByGrade[grade], grade === 11 ? 'per_year' : 'per_term', `${item.code} grade ${grade}`);
    }
  }
  const grade12TechProCodes = new Set(techProNames.map(([code]) => code));
  assert.deepEqual(new Set(catalog.filter(item => item.type === 'techpro_elective' && item.grades.includes(12)).map(item => item.code)),
    grade12TechProCodes, 'Grade 12 TechPro eligibility must match the official Grade 12 guide list');
  assert.equal(getCatalogEntry('AE009').grades.includes(11), false);
  assert.equal(getCatalogEntry('TP-AUTO-01').grades.includes(11), false);
  assert.equal(getCatalogEntry('AE040').grades.includes(11), true);
  assert.equal(getCatalogEntry('FE-DESIGN-INNOVATION').grades.includes(11), true);
  assert.equal(getCatalogEntry('WI-ACADEMIC-320').trackCode, 'academic');
  assert.equal(getCatalogEntry('WI-320').catalogGroup, 'techpro_work_immersion');
  assert.equal(isCatalogGradeEligible(getCatalogEntry('AE040'), 'grade-11'), true);
  assert.equal(isCatalogGradeEligible(getCatalogEntry('TP-AUTO-01'), 'grade-11'), false);
  assert.equal(isCatalogGradeEligible(getCatalogEntry('TP-IND-05'), 'grade-11'), false);
});

test('the guide-backed and order-listed entries have their actual official source links', () => {
  for (const item of catalog) {
    if (item.sourceBasis === 'released_curriculum_guides') {
      assert.equal(item.sourceBasis, 'released_curriculum_guides', item.code);
      assert.ok([GUIDE_INDEX, GRADE_11_GUIDE_INDEX, GRADE_12_GUIDE_INDEX, STRENGTHENED_ORDER].includes(item.sourceUrl), item.code);
      assert.ok([GUIDE_INDEX, GRADE_11_GUIDE_INDEX, GRADE_12_GUIDE_INDEX].includes(item.guideUrl), item.code);
    } else {
      assert.equal(item.sourceBasis, 'do_017_annex_a', item.code);
      assert.equal(item.sourceUrl, STRENGTHENED_ORDER, item.code);
      assert.equal(item.guideUrl, null, item.code);
      assert.deepEqual(item.gradeSourceUrls, [STRENGTHENED_ORDER], item.code);
    }
  }
  for (const code of ['AE063', 'AE064', 'AE065', 'AE066', 'AE067'])
    assert.equal(getCatalogEntry(code).sourceUrl, GRADE_11_GUIDE_INDEX, code);
  assert.equal(getCatalogEntry('FE-OFFCAMPUS').hours, 80);
  assert.equal(getCatalogEntry('FE-DESIGN-INNOVATION').grades.includes(11), true);
});

test('annex-confirmed entries are available for new use', () => {
  assert.deepEqual(catalog.filter(item => !isCatalogAvailableForNewUse(item)).map(item => item.code), []);
  for (const item of catalog) {
    assert.equal(item.verificationStatus, 'verified', item.code);
  }
  assert.equal(getCatalogEntry('AE039').hoursUnit, 'per_term');
  assert.equal(getCatalogEntry('AE046').name, 'Conceptual Biology and Earth and Space Science');
  assert.equal(isCatalogAvailableForNewUse(getCatalogEntry('AE046')), true);
});

test('catalog review report counts stay in sync', () => {
  const report = fs.readFileSync(path.join(__dirname, '../docs/shs-approved-catalog-review.md'), 'utf8');
  const availableCount = catalog.filter(isCatalogAvailableForNewUse).length;
  const summary = report.match(/At this review, (\d+) catalog entries are available for new offerings and (\d+) remain blocked/);
  assert.ok(summary);
  assert.equal(Number(summary[1]), availableCount);
  assert.equal(Number(summary[2]), 0);
  for (const [label, count] of [['Academic electives', 67], ['Academic Field Experience', 13], ['TechPro electives', 48], ['TechPro Work Immersion', 3]])
    assert.ok(report.includes(`| ${label} | ${count} | Available |`));
});

test('catalog snapshots preserve existing classes after guide, name, or grade corrections', () => {
  assert.match(CATALOG_VERSION, /^deped-sshs-2026-10\./);
  const previousBusiness3 = getCatalogEntry('AE009');
  for (const catalogVersion of ['deped-sshs-2026-10', 'deped-sshs-2026-10.1']) {
    assert.equal(matchesCatalogSnapshot(previousBusiness3, {
      catalogVersion, trackCode: 'academic', subjectType: 'academic_elective',
      subjectName: 'Business 3 (Business Economics)', instructionalHours: 80
    }), true, 'grade eligibility and source updates must not invalidate saved class snapshots');
  }

  const renamed = getCatalogEntry('TP-AWHC-01');
  assert.equal(matchesCatalogSnapshot(renamed, {
    catalogVersion: 'deped-sshs-2026-10', trackCode: 'techpro', subjectType: 'techpro_elective',
    subjectName: 'Aesthetic Services Beauty Care', instructionalHours: 320
  }), true, 'previous saved display names remain recognized');
  for (const [code, name] of [
    ['TP-AWHC-03', 'Caregiving Child Care'], ['TP-AWHC-04', 'Hairdressing Services'],
    ['TP-HT-04', 'Hotel Operations (Front Office Services)'],
    ['TP-HT-05', 'Hotel Operations (Housekeeping Services)'],
    ['TP-IND-03', 'Electrical Installation and Maintenance'],
    ['TP-IND-04', 'Electronic Products Assembly and Servicing']
  ]) {
    assert.equal(matchesCatalogSnapshot(getCatalogEntry(code), {
      catalogVersion: 'deped-sshs-2026-10.3', trackCode: 'techpro', subjectType: 'techpro_elective',
      subjectName: name, instructionalHours: 320
    }), true, `the former ${code} subject name remains readable`);
  }
  assert.equal(matchesCatalogSnapshot(getCatalogEntry('AE006'), {
    catalogVersion: 'deped-sshs-2026-10.2', trackCode: 'academic', subjectType: 'academic_elective',
    subjectName: 'Introduction to the Philosophy of the Human Person', instructionalHours: 80
  }), true, 'the former published subject display name remains readable');
  assert.equal(matchesCatalogSnapshot(getCatalogEntry('TP-AF-04'), {
    catalogVersion: 'deped-sshs-2026-10.2', trackCode: 'techpro', subjectType: 'techpro_elective',
    subjectName: 'Fish Capture Operation', instructionalHours: 320
  }), true, 'the former Fish Capture display name remains readable');
  assert.equal(matchesCatalogSnapshot(getCatalogEntry('AE046'), {
    catalogVersion: 'deped-sshs-2026-10.1', trackCode: 'academic', subjectType: 'academic_elective',
    subjectName: 'Conceptual Biology and Earth and Space', instructionalHours: 80
  }), true);
  assert.equal(matchesCatalogSnapshot(getCatalogEntry('AE046'), {
    catalogVersion: 'deped-sshs-2026-10.2', trackCode: 'academic', subjectType: 'academic_elective',
    subjectName: 'Conceptual Biology and Earth and Space Science', instructionalHours: 80
  }), true, 'the prior displayed title remains readable for saved records');
  assert.equal(matchesCatalogSnapshot(getCatalogEntry('AE039'), {
    catalogVersion: 'deped-sshs-2026-10.2', trackCode: 'academic', subjectType: 'academic_elective',
    subjectName: 'Creative Production and Presentation', instructionalHours: 160
  }), true, 'the historical 160-hour snapshot remains readable while new use is blocked');
  assert.equal(matchesCatalogSnapshot(getCatalogEntry('AE039'), {
    catalogVersion: 'deped-sshs-2026-10.3', trackCode: 'academic', subjectType: 'academic_elective',
    subjectName: 'Creative Production and Presentation', instructionalHours: 80
  }), true, 'any records saved while the prior catalog label was active remain readable');
  assert.equal(getCatalogEntry('AE039').hours, 160);
  assert.equal(matchesCatalogSnapshot(renamed, {
    catalogVersion: 'unknown-version', trackCode: 'techpro', subjectType: 'techpro_elective',
    subjectName: renamed.name, instructionalHours: 320
  }), false);
});

test('catalog grade eligibility is enforced by offering activation', async () => {
  const databaseModule = require('../config/database');
  const controllerPath = require.resolve('../controllers/shsProgramController');
  const originalGetDatabase = databaseModule.getDatabase;
  const queries = [];
  let gradeCode = 'grade-11';
  databaseModule.getDatabase = () => ({ getConnection: async () => ({
    async execute(sql) {
      queries.push(sql);
      if (sql.includes('FROM academic_years WHERE id')) return [[{ id: 3, label: '2027-2028', status: 'active' }]];
      if (sql.includes('FROM school_grade_levels g')) return [[{ id: 4, gradeCode }]];
      if (sql.includes('FROM school_shs_tracks')) return [[{ trackCode: 'academic' }, { trackCode: 'techpro' }]];
      return [[]];
    }, async beginTransaction() { throw new Error('invalid grade must fail before writes'); },
    async rollback() {}, release() {}
  }) });
  delete require.cache[controllerPath];
  const controller = require(controllerPath);

  async function attempt(catalogCode, grade) {
    gradeCode = `grade-${grade}`;
    let error;
    await controller.activate({ user: { schoolId: 2 }, body: { academicYearId: 3, gradeLevelId: 4, catalogCode } },
      { status() { return this; }, json() {} }, value => { error = value; });
    return error;
  }
  try {
    assert.match((await attempt('TP-AUTO-01', 11)).message, /not approved for the selected grade/);
    assert.match((await attempt('AE009', 11)).message, /not approved for the selected grade/);
    assert.equal(queries.some(sql => sql.startsWith('INSERT INTO shs_offerings')), false);
  } finally {
    databaseModule.getDatabase = originalGetDatabase;
    delete require.cache[controllerPath];
  }
});
