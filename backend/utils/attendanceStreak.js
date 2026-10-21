function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

// Records must belong to one learner, subject, and section.
function consecutiveMissedMeetingDates(records) {
  const dates = new Map();
  for (const record of records) {
    const date = dateKey(record.date);
    const day = dates.get(date) || { date, allAbsent: true, sessionId: null };
    day.allAbsent &&= record.status === 'absent';
    if (record.sessionId != null && (day.sessionId == null || Number(record.sessionId) < Number(day.sessionId))) {
      day.sessionId = record.sessionId;
    }
    dates.set(date, day);
  }
  const missed = [];
  for (const day of [...dates.values()].sort((a, b) => b.date.localeCompare(a.date))) {
    if (!day.allAbsent) break;
    missed.push(day);
  }
  return missed;
}

module.exports = { consecutiveMissedMeetingDates };
