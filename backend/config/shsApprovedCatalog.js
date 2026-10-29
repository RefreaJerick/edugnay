// The entries below are the released Strengthened SHS curriculum guides.
// Adding an entry requires checking the DepEd guide list, DO 017, and the
// current time-allotment document. Keep saved codes stable.
const CATALOG_VERSION = 'deped-sshs-2026-10.4';
const COMPATIBLE_CATALOG_VERSIONS = new Set(['deped-sshs-2026-10', 'deped-sshs-2026-10.1', 'deped-sshs-2026-10.2', 'deped-sshs-2026-10.3', CATALOG_VERSION]);
const GUIDE_INDEX = 'https://www.deped.gov.ph/strengthened-shs-program/';
const GRADE_11_GUIDE_INDEX = 'https://sites.google.com/deped.gov.ph/deped-lrportal/three-term-budget-of-work-bow/grade-11';
const GRADE_12_GUIDE_INDEX = 'https://sites.google.com/deped.gov.ph/deped-lrportal/three-term-budget-of-work-bow/grade-12';
const GRADE_11_TECHPRO_INDEX = 'https://sites.google.com/deped.gov.ph/lsguide/budgets-of-work/grade-11';
const GRADE_12_TECHPRO_INDEX = 'https://sites.google.com/deped.gov.ph/lsguide/budgets-of-work/grade-12';
const TIME_ALLOTMENT = 'https://www.deped.gov.ph/wp-content/uploads/5_4_2026_SSHS-Key-Features.pdf';
const STRENGTHENED_ORDER = 'https://www.deped.gov.ph/wp-content/uploads/DO_s2026_017r.pdf';

const clusterNames = Object.freeze({
  arts_social_sciences_humanities: 'Arts, Social Sciences, and Humanities',
  business_entrepreneurship: 'Business and Entrepreneurship',
  stem: 'Science, Technology, Engineering, and Mathematics',
  sports_health_wellness: 'Sports, Health, and Wellness',
  field_experience: 'Field Experience',
  aesthetic_wellness_human_care: 'Aesthetic, Wellness, and Human Care',
  agri_fishery_business_food_innovation: 'Agri-Fishery Business and Food Innovation',
  artisanry_creative_enterprise: 'Artisanry and Creative Enterprise',
  automotive_small_engine: 'Automotive and Small Engine Technologies',
  construction_building: 'Construction and Building Technology',
  creative_arts_design: 'Creative Arts and Design Technology',
  hospitality_tourism: 'Hospitality and Tourism',
  ict_support_programming: 'ICT Support and Computer Programming Technologies',
  industrial_technologies: 'Industrial Technologies',
  maritime: 'Maritime',
  work_immersion: 'Work Immersion'
});

const academic = (code, name, clusterCode, options = {}) => ({
  code,
  name,
  type: 'academic_elective',
  trackCode: 'academic',
  catalogGroup: options.catalogGroup || 'academic_electives',
  clusterCode,
  clusterName: options.clusterName || clusterNames[clusterCode],
  assessmentGroup: options.assessmentGroup || 'academic_general',
  grades: options.grades || [11, 12],
  hours: options.hours || 80,
  hoursUnit: options.hoursUnit || 'per_term',
  sourceBasis: options.sourceBasis || 'released_curriculum_guides',
  sourceTitle: options.sourceTitle || 'DepEd Strengthened SHS curriculum guides',
  sourceUrl: options.sourceUrl || GUIDE_INDEX,
  guideUrl: options.guideUrl === undefined ? GUIDE_INDEX : options.guideUrl,
  policyUrl: STRENGTHENED_ORDER,
  hoursUrl: options.hoursUrl || TIME_ALLOTMENT,
  timeAllotmentUrl: TIME_ALLOTMENT,
  gradeSourceUrls: options.gradeSourceUrls || [GRADE_11_GUIDE_INDEX, GUIDE_INDEX],
  verificationStatus: options.verificationStatus || 'verified',
  verificationNote: options.verificationNote || null,
  legacyHours: options.legacyHours || [],
  legacyNames: options.legacyNames || []
});

const techpro = (code, name, clusterCode, clusterName, options = {}) => ({
  code,
  name,
  type: 'techpro_elective',
  trackCode: 'techpro',
  catalogGroup: 'techpro_electives',
  clusterCode,
  clusterName,
  assessmentGroup: 'techpro',
  grades: options.grades || [11, 12],
  hours: 320,
  hoursUnitByGrade: options.hoursUnitByGrade || Object.fromEntries((options.grades || [11, 12]).map(grade => [grade, grade === 11 ? 'per_year' : 'per_term'])),
  sourceBasis: 'released_curriculum_guides',
  sourceTitle: 'DepEd Strengthened SHS curriculum guides',
  sourceUrl: GUIDE_INDEX,
  guideUrl: GUIDE_INDEX,
  policyUrl: STRENGTHENED_ORDER,
  hoursUrl: TIME_ALLOTMENT,
  timeAllotmentUrl: TIME_ALLOTMENT,
  verificationStatus: options.verificationStatus || 'verified',
  verificationNote: options.verificationNote || null,
  gradeSourceUrls: options.grades?.length === 1
    ? [options.grades[0] === 11 ? GRADE_11_TECHPRO_INDEX : GRADE_12_GUIDE_INDEX]
    : [GRADE_11_TECHPRO_INDEX, GRADE_12_GUIDE_INDEX],
  legacyNames: options.legacyNames || []
});

const academicEntries = [
  // Existing catalog codes stay attached to their saved offerings.
  academic('AE001', 'Contemporary Literature 1', 'arts_social_sciences_humanities'),
  academic('AE002', 'Contemporary Literature 2', 'arts_social_sciences_humanities'),
  academic('AE003', 'Creative Composition 1', 'arts_social_sciences_humanities'),
  academic('AE004', 'Creative Composition 2', 'arts_social_sciences_humanities'),
  academic('AE005', 'Citizenship and Civic Engagement', 'arts_social_sciences_humanities'),
  academic('AE006', 'Introduction to the Philosophy of the Human Person', 'arts_social_sciences_humanities', {
    legacyNames: ['Introduction to the Philosophy of Human Person', 'Introduction to Philosophy']
  }),
  academic('AE007', 'Business 1 (Basic Accounting)', 'business_entrepreneurship', {
    legacyNames: ['Business 1 - Basic Accounting']
  }),
  academic('AE008', 'Business 2 (Business Finance and Income Taxation)', 'business_entrepreneurship', {
    legacyNames: ['Business 2 - Business Finance and Income Taxation']
  }),
  academic('AE009', 'Business 3 (Business Economics)', 'business_entrepreneurship', {
    grades: [12], legacyNames: ['Business 3 - Business Economics']
  }),
  academic('AE010', 'Entrepreneurship', 'business_entrepreneurship'),
  academic('AE011', 'Biology 1', 'stem'),
  academic('AE012', 'Biology 2', 'stem'),
  academic('AE013', 'Chemistry 1', 'stem'),
  academic('AE014', 'Chemistry 2', 'stem'),
  academic('AE015', 'Earth and Space Science 1', 'stem'),
  academic('AE016', 'Earth and Space Science 2', 'stem'),
  academic('AE017', 'Finite Mathematics 1', 'stem'),
  academic('AE018', 'Finite Mathematics 2', 'stem'),
  academic('AE019', 'Physics 1', 'stem'),
  academic('AE020', 'Physics 2', 'stem'),

  // Arts, Social Sciences, and Humanities electives present in released guides.
  academic('AE021', 'Creative Industries - Visual Arts', 'arts_social_sciences_humanities'),
  academic('AE022', 'Creative Industries - Literary Arts', 'arts_social_sciences_humanities'),
  academic('AE023', 'Creative Industries - Media Arts', 'arts_social_sciences_humanities'),
  academic('AE024', 'Creative Industries - Applied and Traditional Arts', 'arts_social_sciences_humanities'),
  academic('AE025', 'Creative Industries - Music', 'arts_social_sciences_humanities'),
  academic('AE026', 'Creative Industries - Dance', 'arts_social_sciences_humanities'),
  academic('AE027', 'Creative Industries - Theater Arts', 'arts_social_sciences_humanities'),
  academic('AE028', 'Filipino 1 (Wika at Komunikasyon sa Akademikong Filipino)', 'arts_social_sciences_humanities'),
  academic('AE029', 'Filipino 2 (Filipino sa Larang Teknikal-Propesyonal)', 'arts_social_sciences_humanities'),
  academic('AE030', 'Filipino 2 (Filipino sa Isports)', 'arts_social_sciences_humanities'),
  academic('AE031', 'Filipino 2 (Filipino sa Sining at Disenyo)', 'arts_social_sciences_humanities'),
  academic('AE032', 'Filipino Identity Through the Arts', 'arts_social_sciences_humanities'),
  academic('AE033', 'Leadership and Management in the Arts', 'arts_social_sciences_humanities'),
  academic('AE034', 'Malikhaing Pagsulat', 'arts_social_sciences_humanities'),
  academic('AE035', 'Philippine Governance (Philippine Politics and Governance)', 'arts_social_sciences_humanities'),
  academic('AE036', 'Social Sciences (Theory and Practice)', 'arts_social_sciences_humanities'),

  // Business and Entrepreneurship electives present in released guides.
  academic('AE037', 'Contemporary Marketing', 'business_entrepreneurship'),
  academic('AE038', 'Introduction to Organization and Management', 'business_entrepreneurship'),

  // Grade 12 guides released for the 2026 SHS curriculum.
  academic('AE039', 'Creative Production and Presentation', 'arts_social_sciences_humanities', {
    grades: [12], hours: 160, hoursUnit: 'per_term', hoursUrl: STRENGTHENED_ORDER, legacyHours: [80],
    assessmentGroup: 'field_exposure',
    sourceTitle: 'DepEd Strengthened SHS Grade 12 curriculum guides',
    sourceUrl: GRADE_12_GUIDE_INDEX, guideUrl: GRADE_12_GUIDE_INDEX,
    gradeSourceUrls: [GRADE_12_GUIDE_INDEX, GUIDE_INDEX],
    verificationStatus: 'verified'
  }),
  academic('AE040', 'Advanced Mathematics', 'stem', { grades: [11, 12], sourceTitle: 'DepEd Order 017, s. 2026, Annex A', sourceUrl: STRENGTHENED_ORDER, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [STRENGTHENED_ORDER] }),
  academic('AE041', 'Basic Calculus', 'stem', { grades: [11, 12], sourceTitle: 'DepEd Order 017, s. 2026, Annex A', sourceUrl: STRENGTHENED_ORDER, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [STRENGTHENED_ORDER] }),
  academic('AE042', 'Biology 3', 'stem', { grades: [11, 12], sourceTitle: 'DepEd Order 017, s. 2026, Annex A', sourceUrl: STRENGTHENED_ORDER, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [STRENGTHENED_ORDER] }),
  academic('AE043', 'Biology 4', 'stem', { grades: [12], sourceTitle: 'DepEd Strengthened SHS Grade 12 curriculum guides', sourceUrl: GRADE_12_GUIDE_INDEX, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [GRADE_12_GUIDE_INDEX, GUIDE_INDEX] }),
  academic('AE044', 'Chemistry 3', 'stem', { grades: [11, 12], sourceTitle: 'DepEd Order 017, s. 2026, Annex A', sourceUrl: STRENGTHENED_ORDER, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [STRENGTHENED_ORDER] }),
  academic('AE045', 'Chemistry 4', 'stem', { grades: [12], sourceTitle: 'DepEd Strengthened SHS Grade 12 curriculum guides', sourceUrl: GRADE_12_GUIDE_INDEX, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [GRADE_12_GUIDE_INDEX, GUIDE_INDEX] }),
  academic('AE046', 'Conceptual Biology and Earth and Space Science', 'stem', {
    grades: [12], sourceTitle: 'DepEd Strengthened SHS Grade 12 curriculum guides',
    sourceUrl: GRADE_12_GUIDE_INDEX, guideUrl: GRADE_12_GUIDE_INDEX,
    gradeSourceUrls: [STRENGTHENED_ORDER], legacyNames: ['Conceptual Biology and Earth and Space'],
    verificationStatus: 'verified'
  }),
  academic('AE047', 'Conceptual Physics and Chemistry in Daily Life', 'stem', { grades: [12], sourceTitle: 'DepEd Strengthened SHS Grade 12 curriculum guides', sourceUrl: GRADE_12_GUIDE_INDEX, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [GRADE_12_GUIDE_INDEX, GUIDE_INDEX] }),
  academic('AE048', 'Database Management', 'stem', { grades: [12], sourceTitle: 'DepEd Strengthened SHS Grade 12 curriculum guides', sourceUrl: GRADE_12_GUIDE_INDEX, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [GRADE_12_GUIDE_INDEX, GUIDE_INDEX] }),
  academic('AE049', 'Earth and Space Science 3', 'stem', { grades: [11, 12], sourceTitle: 'DepEd Order 017, s. 2026, Annex A', sourceUrl: STRENGTHENED_ORDER, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [STRENGTHENED_ORDER] }),
  academic('AE050', 'Earth and Space Science 4', 'stem', { grades: [12], sourceTitle: 'DepEd Strengthened SHS Grade 12 curriculum guides', sourceUrl: GRADE_12_GUIDE_INDEX, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [GRADE_12_GUIDE_INDEX, GUIDE_INDEX] }),
  academic('AE051', 'Empowerment Technologies', 'stem', { grades: [11, 12], sourceTitle: 'DepEd Order 017, s. 2026, Annex A', sourceUrl: STRENGTHENED_ORDER, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [STRENGTHENED_ORDER] }),
  academic('AE052', 'Fundamentals of Data Analytics', 'stem', { grades: [12], sourceTitle: 'DepEd Strengthened SHS Grade 12 curriculum guides', sourceUrl: GRADE_12_GUIDE_INDEX, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [GRADE_12_GUIDE_INDEX, GUIDE_INDEX] }),
  academic('AE053', 'Physics 3', 'stem', { grades: [11, 12], sourceTitle: 'DepEd Order 017, s. 2026, Annex A', sourceUrl: STRENGTHENED_ORDER, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [STRENGTHENED_ORDER] }),
  academic('AE054', 'Physics 4', 'stem', { grades: [12], sourceTitle: 'DepEd Strengthened SHS Grade 12 curriculum guides', sourceUrl: GRADE_12_GUIDE_INDEX, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [GRADE_12_GUIDE_INDEX, GUIDE_INDEX] }),
  academic('AE055', 'Pre-Calculus', 'stem', { grades: [11, 12], sourceTitle: 'DepEd Order 017, s. 2026, Annex A', sourceUrl: STRENGTHENED_ORDER, guideUrl: GRADE_12_GUIDE_INDEX, gradeSourceUrls: [STRENGTHENED_ORDER] }),

  // Sports, Health, and Wellness electives present in released guides.
  academic('AE056', 'Human Movement 1 (Basic Anatomy in Sports and Exercise)', 'sports_health_wellness', {
    assessmentGroup: 'arts_sports_wellness'
  }),
  academic('AE057', 'Human Movement 2 (Motor Skills Development)', 'sports_health_wellness', {
    assessmentGroup: 'arts_sports_wellness'
  }),
  academic('AE058', 'Physical Education 1 (Fitness and Recreation)', 'sports_health_wellness', {
    assessmentGroup: 'arts_sports_wellness'
  }),
  academic('AE059', 'Physical Education 2 (Sports and Dance)', 'sports_health_wellness', {
    assessmentGroup: 'arts_sports_wellness'
  }),
  academic('AE060', 'Sports Activity Management', 'sports_health_wellness', {
    assessmentGroup: 'arts_sports_wellness'
  }),
  academic('AE061', 'Sports Coaching', 'sports_health_wellness', {
    assessmentGroup: 'arts_sports_wellness'
  }),
  academic('AE062', 'Sports Officiating', 'sports_health_wellness', {
    assessmentGroup: 'arts_sports_wellness'
  }),
  academic('AE063', 'Art Criticism and Creative Markets', 'arts_social_sciences_humanities', {
    sourceBasis: 'released_curriculum_guides', sourceTitle: 'DepEd Strengthened SHS Grade 11/12 curriculum guides',
    sourceUrl: GRADE_11_GUIDE_INDEX, guideUrl: GRADE_11_GUIDE_INDEX
  }),
  academic('AE064', 'Performance Criticism and Creative Markets', 'arts_social_sciences_humanities', {
    sourceBasis: 'released_curriculum_guides', sourceTitle: 'DepEd Strengthened SHS Grade 11/12 curriculum guides',
    sourceUrl: GRADE_11_GUIDE_INDEX, guideUrl: GRADE_11_GUIDE_INDEX
  }),
  academic('AE065', 'Exercise and Sports Programming', 'sports_health_wellness', {
    assessmentGroup: 'arts_sports_wellness', sourceBasis: 'released_curriculum_guides',
    sourceTitle: 'DepEd Strengthened SHS Grade 11/12 curriculum guides',
    sourceUrl: GRADE_11_GUIDE_INDEX, guideUrl: GRADE_11_GUIDE_INDEX
  }),
  academic('AE066', 'First Aid', 'sports_health_wellness', {
    assessmentGroup: 'arts_sports_wellness', sourceBasis: 'released_curriculum_guides',
    sourceTitle: 'DepEd Strengthened SHS Grade 11/12 curriculum guides',
    sourceUrl: GRADE_11_GUIDE_INDEX, guideUrl: GRADE_11_GUIDE_INDEX
  }),
  academic('AE067', 'Fundamentals of Basic Life Support', 'sports_health_wellness', {
    assessmentGroup: 'arts_sports_wellness', sourceBasis: 'released_curriculum_guides',
    sourceTitle: 'DepEd Strengthened SHS Grade 11/12 curriculum guides',
    sourceUrl: GRADE_11_GUIDE_INDEX, guideUrl: GRADE_11_GUIDE_INDEX
  })
];

const techproEntries = [
  techpro('TP-AWHC-01', 'Aesthetic Services (Beauty Care)', 'aesthetic_wellness_human_care', clusterNames.aesthetic_wellness_human_care, { legacyNames: ['Aesthetic Services Beauty Care'] }),
  techpro('TP-AWHC-02', 'Caregiving (Adult Care)', 'aesthetic_wellness_human_care', clusterNames.aesthetic_wellness_human_care, { legacyNames: ['Caregiving Adult Care'] }),
  techpro('TP-AWHC-03', 'Caregiving (Child Care)', 'aesthetic_wellness_human_care', clusterNames.aesthetic_wellness_human_care, { legacyNames: ['Caregiving Child Care'] }),
  techpro('TP-AWHC-04', 'Hairdressing Services', 'aesthetic_wellness_human_care', clusterNames.aesthetic_wellness_human_care, { legacyNames: ['Hairdressing'] }),

  techpro('TP-AF-01', 'Agricultural Crops Production', 'agri_fishery_business_food_innovation', clusterNames.agri_fishery_business_food_innovation),
  techpro('TP-AF-02', 'Agro-entrepreneurship', 'agri_fishery_business_food_innovation', clusterNames.agri_fishery_business_food_innovation, { legacyNames: ['Agro-Entrepreneurship'] }),
  techpro('TP-AF-03', 'Aquaculture', 'agri_fishery_business_food_innovation', clusterNames.agri_fishery_business_food_innovation),
  techpro('TP-AF-04', 'Fish Capture Operation', 'agri_fishery_business_food_innovation', clusterNames.agri_fishery_business_food_innovation, { legacyNames: ['Fish Capture'] }),
  techpro('TP-AF-05', 'Food Processing', 'agri_fishery_business_food_innovation', clusterNames.agri_fishery_business_food_innovation),
  techpro('TP-AF-06', 'Organic Agriculture Production', 'agri_fishery_business_food_innovation', clusterNames.agri_fishery_business_food_innovation),
  techpro('TP-AF-07', 'Poultry Production (Chicken)', 'agri_fishery_business_food_innovation', clusterNames.agri_fishery_business_food_innovation),
  techpro('TP-AF-08', 'Ruminants Production', 'agri_fishery_business_food_innovation', clusterNames.agri_fishery_business_food_innovation),
  techpro('TP-AF-09', 'Swine Production', 'agri_fishery_business_food_innovation', clusterNames.agri_fishery_business_food_innovation),

  techpro('TP-ACE-01', 'Garments Artisanry', 'artisanry_creative_enterprise', clusterNames.artisanry_creative_enterprise),
  techpro('TP-ACE-02', 'Handicrafts: Weaving', 'artisanry_creative_enterprise', clusterNames.artisanry_creative_enterprise, { legacyNames: ['Handicrafts (Weaving)'] }),

  techpro('TP-AUTO-01', 'Automotive Servicing (Electrical Repair)', 'automotive_small_engine', clusterNames.automotive_small_engine, { grades: [12] }),
  techpro('TP-AUTO-02', 'Automotive Servicing (Engine and Chassis Repairs)', 'automotive_small_engine', clusterNames.automotive_small_engine, { grades: [12] }),
  techpro('TP-AUTO-03', 'Driving and Automotive Servicing', 'automotive_small_engine', clusterNames.automotive_small_engine),
  techpro('TP-AUTO-04', 'Motorcycle and Small Engine Servicing', 'automotive_small_engine', clusterNames.automotive_small_engine),

  techpro('TP-CBT-01', 'Carpentry', 'construction_building', clusterNames.construction_building),
  techpro('TP-CBT-02', 'Construction Operation', 'construction_building', clusterNames.construction_building),
  techpro('TP-CBT-03', 'Manual Metal Arc Welding', 'construction_building', clusterNames.construction_building),
  techpro('TP-CBT-04', 'Technical Drafting', 'construction_building', clusterNames.construction_building),

  techpro('TP-CADT-01', 'Animation', 'creative_arts_design', clusterNames.creative_arts_design),
  techpro('TP-CADT-02', 'Illustration', 'creative_arts_design', clusterNames.creative_arts_design),
  techpro('TP-CADT-03', 'Visual Graphic Design', 'creative_arts_design', clusterNames.creative_arts_design),

  techpro('TP-HT-01', 'Bakery Operations', 'hospitality_tourism', clusterNames.hospitality_tourism),
  techpro('TP-HT-02', 'Events Management Services', 'hospitality_tourism', clusterNames.hospitality_tourism),
  techpro('TP-HT-03', 'Food and Beverage Operation', 'hospitality_tourism', clusterNames.hospitality_tourism),
  techpro('TP-HT-04', 'Hotel Operations (Front Office Services)', 'hospitality_tourism', clusterNames.hospitality_tourism, { legacyNames: ['Hotel Operation (Front Office Services)'] }),
  techpro('TP-HT-05', 'Hotel Operations (Housekeeping Services)', 'hospitality_tourism', clusterNames.hospitality_tourism, { legacyNames: ['Hotel Operation (Housekeeping Services)'] }),
  techpro('TP-HT-06', 'Kitchen Operations', 'hospitality_tourism', clusterNames.hospitality_tourism),
  techpro('TP-HT-07', 'Tourism Services', 'hospitality_tourism', clusterNames.hospitality_tourism),

  techpro('TP-ICT-01', 'Broadband Installation', 'ict_support_programming', clusterNames.ict_support_programming),
  techpro('TP-NET', 'Computer Programming (.NET Technology)', 'ict_support_programming', clusterNames.ict_support_programming),
  techpro('TP-JAVA', 'Computer Programming (Java)', 'ict_support_programming', clusterNames.ict_support_programming),
  techpro('TP-ICT-04', 'Computer Programming (Oracle Database)', 'ict_support_programming', clusterNames.ict_support_programming),
  techpro('TP-ICT-05', 'Computer Systems Servicing', 'ict_support_programming', clusterNames.ict_support_programming),
  techpro('TP-ICT-06', 'Contact Center Services', 'ict_support_programming', clusterNames.ict_support_programming),

  techpro('TP-IND-01', 'Commercial Air-Conditioning Installation and Servicing', 'industrial_technologies', clusterNames.industrial_technologies, { grades: [12], legacyNames: ['Commercial Air Conditioning Installation and Servicing'] }),
  techpro('TP-IND-02', 'Domestic Refrigeration and Air-Conditioning Servicing', 'industrial_technologies', clusterNames.industrial_technologies, { legacyNames: ['Domestic Refrigeration and Air Conditioning Servicing'] }),
  techpro('TP-IND-03', 'Electrical Installation and Maintenance', 'industrial_technologies', clusterNames.industrial_technologies, { legacyNames: ['Electrical Installation Maintenance'] }),
  techpro('TP-IND-04', 'Electronic Products Assembly and Servicing', 'industrial_technologies', clusterNames.industrial_technologies, { legacyNames: ['Electronics Product Assembly and Servicing'] }),
  techpro('TP-IND-05', 'Mechatronics', 'industrial_technologies', clusterNames.industrial_technologies, { grades: [12] }),
  techpro('TP-IND-06', 'Photovoltaic Systems Installation', 'industrial_technologies', clusterNames.industrial_technologies),

  techpro('TP-MAR-01', 'Marine Engineering at the Support Level', 'maritime', clusterNames.maritime),
  techpro('TP-MAR-02', 'Marine Transportation at the Support Level', 'maritime', clusterNames.maritime),
  techpro('TP-MAR-03', 'Ships Catering Services', 'maritime', clusterNames.maritime)
];

const fieldExperience = [
  { code: 'WI-ACADEMIC-320', name: 'Work Immersion for Academic Track', assessmentGroup: 'work_immersion', hours: 320, legacyNames: [] },
  { code: 'AA-DANCE', name: 'Arts Apprenticeship - Dance', assessmentGroup: 'field_exposure', hours: 160, grades: [12], legacyNames: [] },
  { code: 'AA-LITERARY', name: 'Arts Apprenticeship - Literary Arts', assessmentGroup: 'field_exposure', hours: 160, grades: [12], legacyNames: [] },
  { code: 'AA-MEDIA', name: 'Arts Apprenticeship - Media Arts', assessmentGroup: 'field_exposure', hours: 160, grades: [12], legacyNames: [] },
  { code: 'AA-MUSIC', name: 'Arts Apprenticeship - Music', assessmentGroup: 'field_exposure', hours: 160, grades: [12], legacyNames: [] },
  { code: 'AA-THEATER', name: 'Arts Apprenticeship - Theater Arts', assessmentGroup: 'field_exposure', hours: 160, grades: [12], legacyNames: [] },
  { code: 'AA-TRADITIONAL', name: 'Arts Apprenticeship - Traditional Cultural Expressions', assessmentGroup: 'field_exposure', hours: 160, grades: [12], legacyNames: [] },
  { code: 'AA-VISUAL', name: 'Arts Apprenticeship - Visual Arts', assessmentGroup: 'field_exposure', hours: 160, grades: [12], legacyNames: [] },
  { code: 'FE-DESIGN-INNOVATION', name: 'Design and Innovation', assessmentGroup: 'research_design', hours: 80, grades: [11, 12] },
  { code: 'FE-RESEARCH-1', name: 'Research 1', assessmentGroup: 'research_design', hours: 80, grades: [11, 12] },
  { code: 'FE-RESEARCH-2', name: 'Research 2', assessmentGroup: 'research_design', hours: 80, grades: [11, 12] },
  { code: 'FE-SPORTS-INCAMPUS', name: 'In-Campus Field Exposure for Sports', assessmentGroup: 'field_exposure', hours: 160, grades: [12] },
  { code: 'FE-OFFCAMPUS', name: 'Field Exposure (Off Campus)', assessmentGroup: 'field_exposure', hours: 80, grades: [12] }
].map(item => ({
  ...academic(item.code, item.name, 'field_experience', {
    catalogGroup: 'field_experience', clusterName: clusterNames.field_experience,
    assessmentGroup: item.assessmentGroup, grades: item.grades || [12], hours: item.hours,
    sourceBasis: 'do_017_annex_a',
    hoursUnit: 'per_term', verificationStatus: 'verified',
    sourceTitle: 'DepEd Order No. 017, s. 2026, Annex A',
    sourceUrl: STRENGTHENED_ORDER,
    guideUrl: null,
    hoursUrl: STRENGTHENED_ORDER,
    gradeSourceUrls: [STRENGTHENED_ORDER],
    legacyNames: item.legacyNames
  })
}));

const workImmersion = [
  { code: 'WI-320', hours: 320, hoursUnit: 'per_term' },
  { code: 'WI-540', hours: 540, hoursUnit: 'two_terms' },
  { code: 'WI-640', hours: 640, hoursUnit: 'two_terms' }
].map(item => ({
  code: item.code,
  name: 'Work Immersion for Tech-Pro Track',
  type: 'work_immersion',
  trackCode: 'techpro',
  catalogGroup: 'techpro_work_immersion',
  clusterCode: 'work_immersion',
  clusterName: clusterNames.work_immersion,
  assessmentGroup: 'work_immersion',
  grades: [12],
  hours: item.hours,
  hoursUnitByGrade: { 12: item.hoursUnit },
  sourceBasis: 'do_017_annex_a',
  sourceTitle: 'DepEd Order No. 017, s. 2026, Annex A',
  sourceUrl: STRENGTHENED_ORDER,
  guideUrl: null,
  policyUrl: STRENGTHENED_ORDER,
  hoursUrl: STRENGTHENED_ORDER,
  timeAllotmentUrl: TIME_ALLOTMENT,
  gradeSourceUrls: [STRENGTHENED_ORDER],
  verificationStatus: 'verified',
  verificationNote: null,
  legacyNames: ['Work Immersion']
}));

const allEntries = [...academicEntries, ...fieldExperience, ...techproEntries, ...workImmersion];
const catalog = Object.freeze(allEntries.map(entry => Object.freeze({
  ...entry,
  grades: Object.freeze([...entry.grades]),
  hoursUnitByGrade: entry.hoursUnitByGrade ? Object.freeze({ ...entry.hoursUnitByGrade }) : undefined,
  gradeSourceUrls: Object.freeze([...(entry.gradeSourceUrls || [])]),
  legacyHours: Object.freeze([...(entry.legacyHours || [])]),
  legacyNames: Object.freeze([...entry.legacyNames]),
  version: CATALOG_VERSION,
  trackLabel: entry.trackCode === 'academic' ? 'Academic' : 'TechPro'
})));

function getCatalogEntry(code) {
  return catalog.find(entry => entry.code === code) || null;
}

function matchesCatalogSnapshot(entry, snapshot) {
  if (!entry || !snapshot) return false;
  const snapshotName = String(snapshot.subjectName ?? snapshot.name ?? '').trim().replace(/\s+/g, ' ');
  const validNames = [entry.name, ...entry.legacyNames].map(value => value.trim().replace(/\s+/g, ' '));
  return COMPATIBLE_CATALOG_VERSIONS.has(snapshot.catalogVersion)
    && snapshot.trackCode === entry.trackCode
    && (snapshot.subjectType ?? snapshot.type) === entry.type
    && validNames.includes(snapshotName)
    && (Number(snapshot.instructionalHours ?? snapshot.hours) === entry.hours
      || entry.legacyHours.includes(Number(snapshot.instructionalHours ?? snapshot.hours)));
}

function isCatalogGradeEligible(entry, grade) {
  return Boolean(entry && entry.grades.includes(Number(String(grade ?? '').replace(/^grade-/, ''))));
}

function isCatalogAvailableForNewUse(entry) {
  return Boolean(entry && entry.verificationStatus === 'verified');
}

module.exports = {
  CATALOG_VERSION,
  GUIDE_INDEX,
  GRADE_11_GUIDE_INDEX,
  GRADE_12_GUIDE_INDEX,
  GRADE_11_TECHPRO_INDEX,
  GRADE_12_TECHPRO_INDEX,
  TIME_ALLOTMENT,
  STRENGTHENED_ORDER,
  catalog,
  getCatalogEntry,
  matchesCatalogSnapshot,
  isCatalogGradeEligible,
  isCatalogAvailableForNewUse
};
