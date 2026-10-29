const { SHS_PATHWAYS } = require('./shsCurriculum');

function hasOccurrence(start, end, weekday) {
  const date = new Date(`${start}T00:00:00Z`);
  const offset = (weekday - (date.getUTCDay() || 7) + 7) % 7;
  return date.getTime() + offset * 86400000 <= new Date(`${end}T00:00:00Z`).getTime();
}

function meetingsConflict(a, b) {
  return a.some(left => b.some(right => {
    if (Number(left.weekday) !== Number(right.weekday) || left.startTime >= right.endTime || left.endTime <= right.startTime) return false;
    const start = left.startDate > right.startDate ? left.startDate : right.startDate;
    const end = left.endDate < right.endDate ? left.endDate : right.endDate;
    return start <= end && hasOccurrence(start, end, Number(left.weekday));
  }));
}

function normalizeClassIds(values) {
  if (!Array.isArray(values) || !values.length || values.length > 50
    || values.some(value => !Number.isSafeInteger(Number(value)) || Number(value) < 1)) {
    throw new Error('Choose one or more valid classes.');
  }
  const ids = values.map(Number);
  if (new Set(ids).size !== ids.length) throw new Error('Choose each class only once.');
  return ids;
}

function validateRecordedChoices(ids, classes, existingMeetings = []) {
  const byId = new Map(classes.map(item => [Number(item.id), item]));
  const selected = ids.map(classId => byId.get(Number(classId)));
  if (selected.some(item => !item)) return { error: 'A selected class is not offered for this learner’s grade and school year.' };

  const subjectCodes = selected.map(item => item.catalogCode);
  if (new Set(subjectCodes).size !== subjectCodes.length) return { error: 'Choose only one class for each subject.' };
  for (const item of selected) {
    if (!item.classActive || !item.offeringActive) return { error: `${item.subjectName} is paused and cannot be selected.` };
    if (item.teacherStatus !== 'active' || (item.teacherRole && item.teacherRole !== 'teacher')) {
      return { error: `${item.subjectName} has an inactive teacher.` };
    }
    if (Number(item.enrolledCount) >= Number(item.capacity)) return { error: `${item.subjectName} has no seats left.` };
    if (meetingsConflict(item.meetings || [], existingMeetings)) return { error: `${item.subjectName} conflicts with another class on the learner’s schedule.` };
  }
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      if (meetingsConflict(selected[i].meetings || [], selected[j].meetings || [])) {
        return { error: 'The chosen classes have overlapping meeting times.' };
      }
    }
  }
  return { error: null, selected };
}

function validateSelection(pathway, grade, classes, prior = []) {
  const rule = SHS_PATHWAYS[pathway];
  if (!rule) return 'Choose a valid pathway.';
  if (!classes.length) return 'Choose elective classes first.';
  const codes = classes.map(item => item.catalogCode);
  if (new Set(codes).size !== codes.length) return 'Choose each subject only once.';
  if (prior.some(item => codes.includes(item.catalogCode))) return 'A subject already completed in Grade 11 cannot be chosen again.';
  const byType = type => classes.filter(item => item.subjectType === type);
  const count = type => byType(type).length;
  const hours = type => byType(type).reduce((sum, item) => sum + Number(item.instructionalHours), 0);
  const exact = (type, wantedCount, wantedHours) => count(type) === wantedCount && hours(type) === wantedHours;
  const total = classes.reduce((sum, item) => sum + Number(item.instructionalHours), 0);
  const priorAcademic = prior.filter(item => item.subjectType === 'academic_elective');
  const priorHours = priorAcademic.reduce((sum, item) => sum + Number(item.instructionalHours), 0);
  if (grade === 11) {
    if (pathway === 'academic' || pathway === 'academic_cross_track') {
      if (!exact('academic_elective', 3, 240) || classes.length !== 3) return 'Grade 11 Academic requires three Academic electives totaling 240 hours.';
    } else if (!exact('techpro_elective', 1, 320) || classes.length !== 1) {
      return 'Grade 11 TechPro requires one 320-hour TechPro elective.';
    }
  } else if (grade === 12) {
    if (pathway === 'academic') {
      if (count('academic_elective') < 9 || count('academic_elective') > 12 || total !== 960 || classes.length !== count('academic_elective'))
        return 'Grade 12 Academic requires 9 to 12 Academic electives totaling 960 hours.';
    } else if (pathway === 'academic_cross_track') {
      if (!exact('academic_elective', 8, 640) || !exact('techpro_elective', 1, 320) || classes.length !== 9)
        return 'Grade 12 Academic cross-track requires eight Academic electives and one TechPro elective totaling 960 hours.';
    } else if (pathway === 'techpro') {
      if (count('techpro_elective') < 1 || count('techpro_elective') > 2 || count('work_immersion') !== 1
        || classes.length !== count('techpro_elective') + 1 || total !== 960)
        return 'Grade 12 TechPro requires TechPro electives and Work Immersion totaling 960 hours.';
    } else {
      if (!exact('techpro_elective', 1, 320) || !exact('work_immersion', 1, 320)
        || count('academic_elective') + priorAcademic.length !== 4 || hours('academic_elective') + priorHours !== 320
        || classes.length !== count('academic_elective') + 2)
        return 'TechPro cross-track needs four verified Academic electives across Grades 11 and 12, plus 320-hour TechPro and Work Immersion choices.';
    }
  } else return 'Only Grades 11 and 12 can choose electives.';
  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      if (meetingsConflict(classes[i].meetings || [], classes[j].meetings || [])) return 'Selected classes have overlapping meetings.';
    }
  }
  return null;
}

module.exports = { hasOccurrence, meetingsConflict, normalizeClassIds, validateRecordedChoices, validateSelection };
