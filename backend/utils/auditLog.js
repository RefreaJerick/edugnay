function summaryParts(value) {
  return String(value || '')
    .split(/\s*(?:\u00c3\u201a\u00c2\u00b7|\u00c2\u00b7|\u00b7)\s*|\s+\?+\s+|\s*(?:\u00e2\u2020\u2019|\u00e2\u2020\u2012|→)\s*/)
    .map(part => part.trim())
    .filter(Boolean);
}

function structuredActivityDetails(actionType, details = {}) {
  const normalized = { ...details };
  const summary = String(details.summary || '').trim();
  const parts = summaryParts(summary);
  const setIfMissing = (key, value) => {
    if (normalized[key] === undefined && value !== undefined && value !== null && value !== '') normalized[key] = value;
  };

  if (['user_created', 'user_updated', 'user_activated', 'user_deactivated', 'user_deleted'].includes(actionType)) {
    setIfMissing('displayName', parts[0]);
    setIfMissing('role', parts[1]);
  } else if (actionType === 'users_imported') {
    const match = summary.match(/^(\d+)\s+(.+?)\s+accounts?$/i);
    if (match) {
      setIfMissing('accountCount', Number(match[1]));
      setIfMissing('role', match[2]);
    }
  } else if (['section_created', 'section_updated', 'section_deleted'].includes(actionType)) {
    setIfMissing('sectionName', parts[0]);
  } else if (actionType === 'student_moved') {
    setIfMissing('studentName', parts[0]);
    setIfMissing('sourceSectionName', parts[1]);
    setIfMissing('targetSectionName', parts[2]);
  } else if (actionType === 'student_withdrawn') {
    setIfMissing('studentName', parts[0]);
    setIfMissing('sectionName', parts[1]);
  } else if (['teacher_assigned', 'teacher_unassigned', 'shs_teacher_assigned', 'shs_teacher_unassigned'].includes(actionType)) {
    setIfMissing('teacherName', parts[0]);
    setIfMissing('sectionName', parts[1]);
    setIfMissing('subjectName', parts[2]);
  } else if (['teacher_assignment_updated', 'shs_teacher_assignment_updated'].includes(actionType)) {
    setIfMissing('previousTeacher', parts[0]);
    setIfMissing('teacherName', parts[1]);
    setIfMissing('sectionName', parts[2]);
    setIfMissing('subjectName', parts[3]);
  } else if (['subject_created', 'subject_updated', 'subject_deactivated', 'subject_deleted',
    'shs_subject_created', 'shs_subject_updated', 'shs_subject_deactivated', 'shs_subject_deleted'].includes(actionType)) {
    setIfMissing('subjectName', parts[0]);
  } else if (actionType.startsWith('announcement_')) {
    setIfMissing('announcementTitle', summary);
  } else if (actionType === 'calendar_notice_created') {
    setIfMissing('noticeTitle', summary);
  } else if (['academic_year_created', 'academic_year_updated'].includes(actionType)) {
    setIfMissing('schoolYearLabel', summary);
  } else if (actionType.startsWith('academic_term_')) {
    setIfMissing('termName', parts[0]);
    setIfMissing('schoolYearLabel', parts[1]);
  } else if (actionType.startsWith('grading_period_reopen_')) {
    const isRequest = actionType === 'grading_period_reopen_requested';
    setIfMissing('teacherName', isRequest ? undefined : parts[0]);
    setIfMissing('subjectName', parts[isRequest ? 0 : 1]);
    setIfMissing('sectionName', parts[isRequest ? 1 : 2]);
    setIfMissing('termName', parts[isRequest ? 2 : 3]);
  } else if (actionType.startsWith('shs_elective_class_')) {
    setIfMissing('className', summary);
  } else if (actionType === 'shs_offering_activated') {
    const match = summary.match(/\b(\d+)\b/);
    if (match) setIfMissing('subjectCount', Number(match[1]));
  } else if (actionType === 'shs_offering_updated' && /^(activated|paused)$/i.test(summary)) {
    setIfMissing('isActive', /^activated$/i.test(summary));
  }

  const namedContextKeys = ['displayName', 'role', 'accountCount', 'studentName', 'sectionName',
    'sourceSectionName', 'targetSectionName', 'teacherName', 'subjectName', 'className',
    'announcementTitle', 'noticeTitle', 'schoolYearLabel', 'termName', 'title', 'entityName'];
  const hasNamedContext = namedContextKeys.some(key => normalized[key] !== undefined && normalized[key] !== null && normalized[key] !== '');
  const summaryLooksLikeAction = /^(created|updated|added|removed|restored|saved|published|scheduled|confirmed|approved|rejected|submitted|imported|applied|deleted|activated|paused|reopened|returned|moved|withdrew|assigned|generated|regenerated|changed|requested|extended|revoked|corrected)\b/i.test(summary)
    || /\b(updated|removed|restored|saved|published|deleted|added|approved|rejected|confirmed|archived|activated|deactivated|extended|reopened)$/i.test(summary);
  if (!hasNamedContext && summary && !summaryLooksLikeAction) normalized.entityName = summary;
  return normalized;
}

async function writeAuditLog(connection, req, actionType, entityType, entityId, details = {}, schoolId = req.user.schoolId) {
  const storedDetails = structuredActivityDetails(actionType, details);
  await connection.execute(
    `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [schoolId, req.user.id, actionType, entityType, entityId || null, JSON.stringify(storedDetails)]
  );
}

module.exports = { writeAuditLog, structuredActivityDetails };
