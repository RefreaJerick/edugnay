const COMMUNICATION_COMPONENTS = Object.freeze({
  english: 'Effective Communication',
  filipino: 'Mabisang Komunikasyon'
});
const COMMUNICATION_COMPONENT_HOURS = Object.freeze({ english: 80, filipino: 80 });

function isCommunicationComponentCode(value) {
  return Object.hasOwn(COMMUNICATION_COMPONENTS, String(value || '').trim().toLowerCase());
}

function averageCommunicationGrades(...grades) {
  if (grades.length !== 2) return null;
  const values = grades.map(grade => grade == null || String(grade).trim() === '' ? NaN : Number(grade));
  if (values.some(grade => !Number.isInteger(grade) || grade < 0 || grade > 100)) return null;
  return Math.round(values.reduce((sum, grade) => sum + grade, 0) / values.length);
}

module.exports = {
  COMMUNICATION_COMPONENTS,
  COMMUNICATION_COMPONENT_HOURS,
  averageCommunicationGrades,
  isCommunicationComponentCode
};
