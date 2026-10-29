const { SHS_PATHWAYS } = require('./shsCurriculum');

function hasOccurrence(start, end, weekday) {
  const date = new Date(`${start}T00:00:00Z`);
  const offset = (weekday - (date.getUTCDay() || 7) + 7) % 7;
  return date.getTime() + offset * 86400000 <= new Date(`${end}T00:00:00Z`).getTime();
}

function conflicts(a, b) {
  if (Number(a.grade) !== Number(b.grade)) return false;
  return (a.meetings || []).some(left => (b.meetings || []).some(right => {
    if (Number(left.weekday) !== Number(right.weekday) || left.startTime >= right.endTime || left.endTime <= right.startTime) return false;
    const start = left.startDate > right.startDate ? left.startDate : right.startDate;
    const end = left.endDate < right.endDate ? left.endDate : right.endDate;
    return start <= end && hasOccurrence(start, end, Number(left.weekday));
  }));
}

function hasCombination(items, { count, minCount = count, maxCount = count, hours, minHours = hours, maxHours = hours }, fixed = []) {
  const byCode = new Map();
  for (const item of items) {
    if (!byCode.has(item.catalogCode)) byCode.set(item.catalogCode, []);
    byCode.get(item.catalogCode).push(item);
  }
  const groups = [...byCode.values()];
  function choose(index, selected, sum) {
    if (selected.length >= minCount && selected.length <= maxCount && sum >= minHours && sum <= maxHours) return true;
    if (index >= groups.length || selected.length >= maxCount || sum > maxHours
      || selected.length + groups.length - index < minCount) return false;
    if (choose(index + 1, selected, sum)) return true;
    for (const item of groups[index]) {
      if ([...selected, ...fixed].some(other => conflicts(other, item))) continue;
      if (choose(index + 1, [...selected, item], sum + Number(item.instructionalHours))) return true;
    }
    return false;
  }
  return choose(0, [], 0);
}

function pathwayReadiness(classes, coreCount = 0) {
  const usable = classes.filter(item => item.offeringActive && item.classActive && item.meetingCount > 0
    && item.teacherActive && item.availableSeats > 0);
  const of = (grade, type) => usable.filter(item => Number(item.grade) === grade && item.subjectType === type);
  const academic11 = hasCombination(of(11, 'academic_elective'), SHS_PATHWAYS.academic.grade11.academic_elective);
  const techpro11 = hasCombination(of(11, 'techpro_elective'), SHS_PATHWAYS.techpro.grade11.techpro_elective);
  const academic12 = hasCombination(of(12, 'academic_elective'), SHS_PATHWAYS.academic.grade12.academic_elective);
  const crossAcademic12 = of(12, 'techpro_elective').some(tp => hasCombination(
    of(12, 'academic_elective'), SHS_PATHWAYS.academic_cross_track.grade12.academic_elective, [tp]));
  const techpro12 = of(12, 'work_immersion').some(wi => [1, 2].some(count =>
    hasCombination(of(12, 'techpro_elective'), { count, hours: 960 - Number(wi.instructionalHours) }, [wi])));
  const crossTechpro12 = of(12, 'work_immersion').filter(wi => Number(wi.instructionalHours) === 320).some(wi =>
    of(12, 'techpro_elective').some(tp => Number(tp.instructionalHours) === 320 && !conflicts(tp, wi)
      && hasCombination([...of(11, 'academic_elective'), ...of(12, 'academic_elective')],
        SHS_PATHWAYS.techpro_cross_track.academicElectives, [tp, wi])));
  const coreReady = coreCount >= 5;
  return {
    academic: { grade11: coreReady && academic11, grade12: academic12 },
    academic_cross_track: { grade11: coreReady && academic11, grade12: crossAcademic12 },
    techpro: { grade11: coreReady && techpro11, grade12: techpro12 },
    techpro_cross_track: { grade11: coreReady && techpro11, grade12: crossTechpro12 }
  };
}

module.exports = { hasCombination, pathwayReadiness };
