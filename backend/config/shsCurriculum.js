// DepEd Order No. 017, s. 2026: Strengthened Senior High School Curriculum.
// These are program requirements, not a catalogue of school-approved offerings.
const SHS_TRACKS = Object.freeze([
  { code: 'academic', label: 'Academic' },
  { code: 'techpro', label: 'Technical Professional (TechPro)' }
]);

const SHS_SUBJECT_TYPES = Object.freeze({
  core: 'Core subject',
  academic_elective: 'Academic elective',
  techpro_elective: 'TechPro elective',
  work_immersion: 'Work immersion'
});

const SHS_SUBJECT_HOURS = Object.freeze({
  core: [160],
  academic_elective: [80, 160, 320],
  techpro_elective: [320],
  work_immersion: [320, 640]
});

const SHS_GRADE_ELIGIBILITY = Object.freeze({
  core: [11],
  academic_elective: [11, 12],
  techpro_elective: [11, 12],
  work_immersion: [12]
});

const SHS_HOURS_BY_GRADE = Object.freeze({
  11: { core: [160], academic_elective: [80], techpro_elective: [320] },
  12: { academic_elective: [80, 160, 320], techpro_elective: [320], work_immersion: [320, 640] }
});

const SHS_PATHWAYS = Object.freeze({
  academic: {
    track: 'academic',
    grade11: { core: { count: 5, hours: 800 }, academic_elective: { count: 3, hours: 240 } },
    grade12: { academic_elective: { minCount: 9, maxCount: 12, hours: 960 } }
  },
  academic_cross_track: {
    track: 'academic',
    grade11: { core: { count: 5, hours: 800 }, academic_elective: { count: 3, hours: 240 } },
    grade12: { academic_elective: { count: 8, hours: 640 }, techpro_elective: { count: 1, hours: 320 } }
  },
  techpro: {
    track: 'techpro',
    grade11: { core: { count: 5, hours: 800 }, techpro_elective: { count: 1, hours: 320 } },
    grade12: { techpro_elective: { minCount: 1, maxCount: 2, minHours: 320, maxHours: 640 }, work_immersion: { count: 1, minHours: 320, maxHours: 640 } },
    totalElectiveHours: 1280
  },
  techpro_cross_track: {
    track: 'techpro',
    grade11: { core: { count: 5, hours: 800 }, techpro_elective: { count: 1, hours: 320 } },
    grade12: { techpro_elective: { count: 1, hours: 320 }, work_immersion: { count: 1, hours: 320 } },
    academicElectives: { count: 4, hours: 320, eligibleGrades: [11, 12] },
    totalElectiveHours: 1280
  }
});

function isStrengthenedTrack(code) {
  return SHS_TRACKS.some(track => track.code === code);
}

module.exports = {
  SHS_GRADE_ELIGIBILITY,
  SHS_HOURS_BY_GRADE,
  SHS_PATHWAYS,
  SHS_SUBJECT_HOURS,
  SHS_SUBJECT_TYPES,
  SHS_TRACKS,
  isStrengthenedTrack
};
