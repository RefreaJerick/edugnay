const SHS_TRACKS = [
  { code: 'academic', label: 'Academic' },
  { code: 'tvl', label: 'Technical-Vocational-Livelihood' },
  { code: 'arts-design', label: 'Arts and Design' },
  { code: 'sports', label: 'Sports' }
];

const SHS_STRANDS = {
  academic: [
    ['stem', 'Science, Technology, Engineering, and Mathematics'],
    ['abm', 'Accountancy, Business, and Management'],
    ['humss', 'Humanities and Social Sciences'],
    ['gas', 'General Academic Strand']
  ],
  tvl: [
    ['agri-fishery-arts', 'Agri-Fishery Arts'],
    ['home-economics', 'Home Economics'],
    ['ict', 'Information and Communications Technology'],
    ['industrial-arts', 'Industrial Arts']
  ],
  'arts-design': [],
  sports: []
};

const LEGACY_SHS_GRADING_GROUPS = {
  core: { label: 'Core subject', weights: { ww: 25, pt: 50, qa: 25 } },
  academic_other: { label: 'Academic track subject', weights: { ww: 25, pt: 45, qa: 30 } },
  academic_immersion: { label: 'Academic immersion, research, or enterprise', weights: { ww: 35, pt: 40, qa: 25 } },
  other_other: { label: 'TVL, Sports, or Arts and Design subject', weights: { ww: 20, pt: 60, qa: 20 } },
  other_immersion: { label: 'TVL, Sports, or Arts immersion, performance, or exhibit', weights: { ww: 20, pt: 60, qa: 20 } }
};

const LEGACY_SHS_GRADING_TYPES = Object.entries(LEGACY_SHS_GRADING_GROUPS).map(([code, group]) => ({
  code,
  label: group.label,
  weights: { ...group.weights }
}));

function transmuteLegacyShsInitialGrade(value) {
  const initialGrade = Number(value);
  if (!Number.isFinite(initialGrade) || initialGrade < 0 || initialGrade > 100) return null;
  if (initialGrade === 100) return 100;
  if (initialGrade < 60) return 60 + Math.floor((initialGrade + 1e-9) / 4);
  return 75 + Math.floor(((initialGrade - 60) + 1e-9) / 1.6);
}

module.exports = {
  LEGACY_SHS_GRADING_GROUPS,
  LEGACY_SHS_GRADING_TYPES,
  SHS_STRANDS,
  SHS_TRACKS,
  transmuteLegacyShsInitialGrade
};
