/* Shared shell behavior for every portal role. */

const EDUGNAY_SESSION_STORAGE_KEY = 'edugnay_session';
const EDUGNAY_API_BASE_URL = String(window.EDUGNAY_APP_CONFIG?.apiBaseUrl || '').trim().replace(/\/+$/, '');
const TOAST_SOUND_STORAGE_KEY = 'edugnay_toast_sounds_enabled';

let appToastTimer;
let toastSoundsEnabled = true;
let toastAudioContext = null;
let lastToastSound = { message: '', type: '', at: 0 };
try { toastSoundsEnabled = localStorage.getItem(TOAST_SOUND_STORAGE_KEY) !== 'false'; } catch {}

function prepareToastAudio() {
  if (!toastSoundsEnabled) return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  try {
    if (!toastAudioContext) toastAudioContext = new AudioContext();
    if (toastAudioContext.state === 'suspended') toastAudioContext.resume().catch(() => {});
    return toastAudioContext;
  } catch { return null; }
}

async function playToastSound(type, message) {
  if (!toastSoundsEnabled) return;
  const now = Date.now();
  if (lastToastSound.message === message && lastToastSound.type === type && now - lastToastSound.at < 1000) return;
  const context = prepareToastAudio();
  if (!context) return;
  const notes = type === 'error' ? [392] : type === 'info' ? [440] : [523, 659];
  try {
    if (context.state === 'suspended') await context.resume();
    if (!toastSoundsEnabled || context.state !== 'running') return;
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * .09;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.linearRampToValueAtTime(0.65, start + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        gain.disconnect();
      }, { once: true });
      oscillator.start(start);
      oscillator.stop(start + .18);
    });
    lastToastSound = { message, type, at: now };
  } catch { /* The visible toast still provides feedback. */ }
}

document.addEventListener('pointerdown', prepareToastAudio, { passive: true });
document.addEventListener('keydown', prepareToastAudio);

function showAppToast(message, type = 'success') {
  if (!message) return;
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = 'app-toast';
    toast.innerHTML = '<span class="app-toast-message"></span><button type="button" class="app-toast-close" aria-label="Dismiss notification"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"></path></svg></button>';
    toast.querySelector('button').addEventListener('click', () => {
      clearTimeout(appToastTimer);
      toast.hidden = true;
    });
    document.body.appendChild(toast);
  }
  clearTimeout(appToastTimer);
  toast.className = `app-toast app-toast-${['success', 'error', 'info'].includes(type) ? type : 'info'}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  toast.querySelector('.app-toast-message').textContent = String(message);
  toast.hidden = false;
  playToastSound(type, String(message));
  appToastTimer = setTimeout(() => { toast.hidden = true; }, type === 'success' ? 4000 : 7000);
}

async function requestApi(path, options = {}) {
  if (!EDUGNAY_API_BASE_URL) throw new Error('The API address has not been configured.');

  const response = await fetch(`${EDUGNAY_API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    }
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.message || 'The request could not be completed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function requestApiFile(path, options = {}) {
  if (!EDUGNAY_API_BASE_URL) throw new Error('The API address has not been configured.');

  const response = await fetch(`${EDUGNAY_API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: options.headers || {}
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const error = new Error(data?.message || 'The file could not be downloaded.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return {
    buffer: await response.arrayBuffer(),
    fileName: response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || '',
    contentType: response.headers.get('Content-Type') || ''
  };
}

async function requestApiMultipart(path, formData, options = {}) {
  if (!EDUGNAY_API_BASE_URL) throw new Error('The API address has not been configured.');

  const response = await fetch(`${EDUGNAY_API_BASE_URL}${path}`, {
    ...options,
    method: options.method || 'POST',
    body: formData,
    credentials: 'include'
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.message || 'The upload could not be completed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function normalizeApiUser(user) {
  if (!user || typeof user !== 'object') return null;

  const profile = user.profile && typeof user.profile === 'object' ? user.profile : {};
  return {
    ...user,
    id: String(user.id),
    apiId: Number(user.id),
    sectionId: user.sectionId == null ? null : String(user.sectionId),
    sectionName: user.sectionName || null,
    gradeLevel: user.gradeLevel || null,
    schoolLevel: user.schoolLevel || null,
    strand: user.strand || null,
    status: user.accountStatus || 'active',
    employeeNo: profile.employeeNumber || null,
    lrn: profile.lrn || null,
    profile
  };
}

async function getApiUsers(filters = {}) {
  const params = new URLSearchParams();
  ['role', 'status', 'search', 'page', 'limit', 'schoolId'].forEach(name => {
    if (filters[name] !== undefined && filters[name] !== null && String(filters[name]).trim()) {
      params.set(name, String(filters[name]).trim());
    }
  });
  const query = params.toString();
  const response = await requestApi(`/users${query ? `?${query}` : ''}`);
  return {
    users: Array.isArray(response?.users) ? response.users.map(normalizeApiUser).filter(Boolean) : [],
    pagination: response?.pagination || null
  };
}

async function getAllApiUsers(filters = {}) {
  const requestedLimit = Number(filters.limit);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 100)
    : 100;
  const firstPage = await getApiUsers({ ...filters, page: 1, limit });
  const users = [...firstPage.users];
  const total = Number(firstPage.pagination?.total);
  const pageCount = Number.isFinite(total)
    ? Math.ceil(total / (Number(firstPage.pagination?.limit) || limit))
    : 1;

  for (let page = 2; page <= pageCount; page += 1) {
    const nextPage = await getApiUsers({ ...filters, page, limit });
    if (!nextPage.users.length) break;
    users.push(...nextPage.users);
  }

  return users;
}

async function getApiUser(userId) {
  const numericId = Number(userId);
  if (!Number.isInteger(numericId) || numericId < 1) return null;
  const response = await requestApi(`/users/${numericId}`);
  return normalizeApiUser(response?.user);
}

async function getApiParentChildren(parentId) {
  const path = parentId == null ? '/users/me/children' : `/users/${Number(parentId)}/children`;
  const response = await requestApi(path);
  return Array.isArray(response?.children) ? response.children : [];
}

async function getApiStudentParents() {
  const response = await requestApi('/users/me/parents');
  return Array.isArray(response?.parents) ? response.parents : [];
}

async function createApiUser(values = {}) {
  const response = await requestApi('/users', {
    method: 'POST',
    body: JSON.stringify(values)
  });
  return {
    user: normalizeApiUser(response?.user),
    emailDelivery: response?.emailDelivery || null
  };
}

async function updateApiUser(userId, values = {}) {
  const numericId = Number(userId);
  if (!Number.isInteger(numericId) || numericId < 1) throw new Error('The user ID is invalid.');
  const response = await requestApi(`/users/${numericId}`, {
    method: 'PATCH',
    body: JSON.stringify(values)
  });
  return {
    user: normalizeApiUser(response?.user),
    emailDelivery: response?.emailDelivery || null
  };
}

async function deleteApiUser(userId) {
  const numericId = Number(userId);
  if (!Number.isSafeInteger(numericId) || numericId < 1) throw new Error('The user ID is invalid.');
  await requestApi(`/users/${numericId}`, { method: 'DELETE' });
  return true;
}

async function setApiUserStatus(userId, status) {
  const numericId = Number(userId);
  if (!Number.isInteger(numericId) || numericId < 1) throw new Error('The user ID is invalid.');
  const action = status === 'active' ? 'activate' : 'deactivate';
  const response = await requestApi(`/users/${numericId}/${action}`, { method: 'POST' });
  return {
    user: normalizeApiUser(response?.user),
    emailDelivery: response?.emailDelivery || null
  };
}

async function getApiSchoolSettings() {
  const response = await requestApi('/school/settings');
  return response?.school ? { ...response.school, logoUrl: resolveApiSchoolLogo(response.school.logoUrl) } : null;
}

function resolveApiSchoolLogo(value) {
  return typeof value === 'string' && /^\/api\/schools\/\d+\/logo$/.test(value)
    ? new URL(value, EDUGNAY_API_BASE_URL).href : null;
}

async function registerApiSchool(values, logoFile) {
  const body = new FormData();
  body.append('payload', JSON.stringify(values));
  if (logoFile) body.append('logo', logoFile);
  const response = await requestApi('/schools/register', { method: 'POST', body });
  return response?.school || null;
}

async function updateApiSchoolLogo(file) {
  const body = new FormData();
  body.append('logo', file);
  const response = await requestApi('/school/logo', { method: 'POST', body });
  return response?.school ? { ...response.school, logoUrl: resolveApiSchoolLogo(response.school.logoUrl) } : null;
}

async function getApiParentNotificationTriggers() {
  return requestApi('/school/parent-notification-triggers');
}

async function updateApiParentNotificationTriggers(triggers) {
  return requestApi('/school/parent-notification-triggers', {
    method: 'PATCH', body: JSON.stringify({ triggers })
  });
}

async function updateApiSchoolSettings(values = {}) {
  const response = await requestApi('/school/settings', {
    method: 'PATCH',
    body: JSON.stringify(values)
  });
  return response?.school ? { ...response.school, logoUrl: resolveApiSchoolLogo(response.school.logoUrl) } : null;
}

async function getApiPortalFeatures() {
  const response = await requestApi('/school/portal-features');
  return {
    features: response?.features || {},
    journalSubjectId: response?.journalSubjectId || null,
    journalSubjectName: response?.journalSubjectName || null
  };
}

async function updateApiPortalFeatures(values = {}) {
  const response = await requestApi('/school/portal-features', {
    method: 'PATCH',
    body: JSON.stringify(values)
  });
  return {
    features: response?.features || {},
    journalSubjectId: response?.journalSubjectId || null
  };
}

async function getApiAcademicStructure() {
  const response = await requestApi('/school/academic-structure');
  return Array.isArray(response?.levels) ? response.levels : [];
}

async function updateApiAcademicStructure(levels = []) {
  const response = await requestApi('/school/academic-structure', {
    method: 'PATCH',
    body: JSON.stringify({ levels })
  });
  return Array.isArray(response?.levels) ? response.levels : [];
}

async function getApiAcademicYears() {
  const response = await requestApi('/academic-years');
  return Array.isArray(response?.academicYears)
    ? response.academicYears.map(normalizeApiAcademicYear)
    : [];
}

async function getApiAcademicTerms(filters = {}) {
  const params = new URLSearchParams();
  ['academicYearId', 'schoolLevelId', 'status'].forEach(name => {
    if (filters[name] !== undefined && filters[name] !== null && String(filters[name]).trim()) {
      params.set(name, String(filters[name]).trim());
    }
  });
  const query = params.toString();
  const response = await requestApi(`/academic-terms${query ? `?${query}` : ''}`);
  return Array.isArray(response?.academicTerms)
    ? response.academicTerms.map(normalizeApiAcademicTerm)
    : [];
}

function normalizeApiDate(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || '').trim());
  return match ? match[1] : (value || null);
}

function normalizeApiAcademicYear(year) {
  return year ? {
    ...year,
    startDate: normalizeApiDate(year.startDate),
    endDate: normalizeApiDate(year.endDate)
  } : null;
}

function normalizeApiAcademicTerm(term) {
  return term ? {
    ...term,
    plannedStartDate: normalizeApiDate(term.plannedStartDate),
    plannedEndDate: normalizeApiDate(term.plannedEndDate)
  } : null;
}

async function createApiAcademicYear(values = {}) {
  const response = await requestApi('/academic-years', {
    method: 'POST',
    body: JSON.stringify(values)
  });
  return normalizeApiAcademicYear(response?.academicYear);
}

async function updateApiAcademicYear(yearId, values = {}) {
  const response = await requestApi(`/academic-years/${Number(yearId)}`, {
    method: 'PATCH',
    body: JSON.stringify(values)
  });
  return normalizeApiAcademicYear(response?.academicYear);
}

async function createApiAcademicTerm(values = {}) {
  const response = await requestApi('/academic-terms', {
    method: 'POST',
    body: JSON.stringify(values)
  });
  return normalizeApiAcademicTerm(response?.academicTerm);
}

async function updateApiAcademicTerm(termId, values = {}) {
  const response = await requestApi(`/academic-terms/${Number(termId)}`, {
    method: 'PATCH',
    body: JSON.stringify(values)
  });
  return normalizeApiAcademicTerm(response?.academicTerm);
}

async function activateApiAcademicTerm(termId) {
  const response = await requestApi(`/academic-terms/${Number(termId)}/activate`, { method: 'POST' });
  return normalizeApiAcademicTerm(response?.academicTerm);
}

async function completeApiAcademicTerm(termId) {
  const response = await requestApi(`/academic-terms/${Number(termId)}/complete`, { method: 'POST' });
  return normalizeApiAcademicTerm(response?.academicTerm);
}

async function extendApiAcademicTerm(termId, values = {}) {
  const response = await requestApi(`/academic-terms/${Number(termId)}/extend`, {
    method: 'POST',
    body: JSON.stringify(values)
  });
  return normalizeApiAcademicTerm(response?.academicTerm);
}

function normalizeApiAssignment(record) {
  if (!record) return null;
  const dueDate = String(record.dueAt || '').slice(0, 10) || null;
  return {
    ...record,
    id: String(record.id),
    apiId: Number(record.id),
    schoolId: Number(record.schoolId) === 1 ? 'scc' : String(record.schoolId || ''),
    sectionId: String(record.sectionId),
    subjectId: String(record.subjectId),
    teacherId: String(record.teacherUserId || ''),
    teacher: record.teacherName || '',
    subject: record.subjectName || '',
    subjectName: record.subjectName || '',
    academicPeriodId: record.academicTermId ? String(record.academicTermId) : null,
    gradingItemId: record.gradingItemId ? String(record.gradingItemId) : null,
    categoryId: record.gradingCategoryCode || (record.gradingCategoryId ? String(record.gradingCategoryId) : null),
    instructions: record.description || null,
    assignedDate: dueDate,
    dueDate,
    onlineSubmissionEnabled: record.onlineSubmissionEnabled === undefined
      ? true
      : Boolean(record.onlineSubmissionEnabled),
    maxScore: record.maxScore === null || record.maxScore === undefined ? null : Number(record.maxScore)
  };
}

async function getApiAssignments(filters = {}) {
  const params = new URLSearchParams();
  ['sectionId', 'subjectId', 'status'].forEach(name => {
    if (filters[name] !== undefined && filters[name] !== null && String(filters[name]).trim()) {
      params.set(name, String(filters[name]).trim());
    }
  });
  const query = params.toString();
  const response = await requestApi(`/assignments${query ? `?${query}` : ''}`);
  return (response?.assignments || []).map(normalizeApiAssignment).filter(Boolean);
}

async function getApiParentAssignmentActivity(studentId, date) {
  const numericStudentId = Number(studentId);
  if (!Number.isSafeInteger(numericStudentId) || numericStudentId < 1) throw new Error('The student ID is invalid.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('The activity date is invalid.');
  const params = new URLSearchParams({ studentId: String(numericStudentId), date });
  const response = await requestApi(`/assignments/activity?${params.toString()}`);
  return Array.isArray(response?.assignments) ? response.assignments.map(assignment => ({
    ...assignment,
    id: String(assignment.id),
    subjectId: String(assignment.subjectId),
    subject: assignment.subjectName || '',
    task: assignment.title || '',
    status: assignment.submissionStatus || 'pending'
  })) : [];
}

function normalizeApiJournalPrompt(prompt) {
  return prompt ? {
    ...prompt,
    id: String(prompt.id),
    journalSubjectId: String(prompt.journalSubjectId),
    subjectId: String(prompt.subjectId),
    sectionId: String(prompt.sectionId),
    gradingItemId: prompt.gradingItemId ? String(prompt.gradingItemId) : null,
    maxScore: prompt.maxScore === null || prompt.maxScore === undefined ? null : Number(prompt.maxScore),
    minWords: Number(prompt.minWords),
    allowLate: prompt.allowLate === true || Number(prompt.allowLate) === 1,
    createdByUserId: String(prompt.createdByUserId)
  } : null;
}

function normalizeApiJournalEntry(entry) {
  return entry ? {
    ...entry,
    id: String(entry.id),
    promptId: entry.promptId ? String(entry.promptId) : null,
    journalSubjectId: String(entry.journalSubjectId),
    studentId: String(entry.studentId),
    sectionId: String(entry.sectionId),
    isLate: entry.isLate === true || Number(entry.isLate) === 1,
    score: entry.score === null || entry.score === undefined ? null : Number(entry.score),
    maxScore: entry.maxScore === null || entry.maxScore === undefined ? null : Number(entry.maxScore),
    submitted: true,
    reviewed: entry.status === 'reviewed'
  } : null;
}

async function getApiJournalSubjects() {
  const response = await requestApi('/journal-subjects');
  return (response?.journalSubjects || []).map(subject => ({
    ...subject,
    id: String(subject.id),
    subjectId: String(subject.subjectId)
  }));
}

async function getApiJournalSections() {
  const response = await requestApi('/journal-sections');
  return (response?.sections || []).map(section => ({
    ...section,
    id: String(section.id),
    schoolId: String(section.schoolId),
    academicYearId: String(section.academicYearId),
    studentCount: Number(section.studentCount)
  }));
}

async function getApiJournalPrompts(filters = {}) {
  const params = new URLSearchParams();
  if (filters.sectionId) params.set('sectionId', String(filters.sectionId));
  const query = params.toString();
  const response = await requestApi(`/journal-prompts${query ? `?${query}` : ''}`);
  return (response?.journalPrompts || []).map(normalizeApiJournalPrompt).filter(Boolean);
}

async function getApiJournalHistory(filters = {}) {
  const query = filters.sectionId ? `?sectionId=${encodeURIComponent(filters.sectionId)}` : '';
  const response = await requestApi(`/journal-history${query}`);
  return {
    prompts: (response?.prompts || []).map(normalizeApiJournalPrompt).filter(Boolean),
    entries: (response?.entries || []).map(normalizeApiJournalEntry).filter(Boolean)
  };
}

async function deleteApiJournalPrompt(promptId) {
  return requestApi(`/journal-prompts/${Number(promptId)}`, { method: 'DELETE' });
}

async function createApiJournalPrompt(values = {}) {
  const response = await requestApi('/journal-prompts', {
    method: 'POST',
    body: JSON.stringify({
      sectionId: Number(values.sectionId),
      gradingItemId: values.gradingItemId ? Number(values.gradingItemId) : null,
      weekStartDate: values.weekStartDate,
      promptText: values.promptText,
      opensAt: values.opensAt,
      dueAt: values.dueAt,
      minWords: Number(values.minWords),
      allowLate: Boolean(values.allowLate)
    })
  });
  return normalizeApiJournalPrompt(response?.journalPrompt);
}

async function updateApiJournalPrompt(promptId, values = {}) {
  const response = await requestApi(`/journal-prompts/${Number(promptId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      gradingItemId: values.gradingItemId ? Number(values.gradingItemId) : null,
      promptText: values.promptText,
      opensAt: values.opensAt,
      dueAt: values.dueAt,
      minWords: Number(values.minWords),
      allowLate: Boolean(values.allowLate)
    })
  });
  return normalizeApiJournalPrompt(response?.journalPrompt);
}

async function getApiJournalEntries(filters = {}) {
  const params = new URLSearchParams();
  ['sectionId', 'promptId'].forEach(name => {
    if (filters[name]) params.set(name, String(filters[name]));
  });
  const query = params.toString();
  const response = await requestApi(`/journal-entries${query ? `?${query}` : ''}`);
  return (response?.entries || []).map(normalizeApiJournalEntry).filter(Boolean);
}

async function submitApiJournalEntry(values = {}) {
  const response = await requestApi('/journal-entries', {
    method: 'POST',
    body: JSON.stringify({ promptId: Number(values.promptId), entryText: values.entryText })
  });
  return normalizeApiJournalEntry(response?.entry);
}

async function reviewApiJournalEntry(entryId, score) {
  const response = await requestApi(`/journal-entries/${Number(entryId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ score: Number(score) })
  });
  return normalizeApiJournalEntry(response?.entry);
}

async function createApiAssignment(values = {}) {
  const dueAt = values.dueAt || values.dueDate;
  const response = await requestApi('/assignments', {
    method: 'POST',
    body: JSON.stringify({
      sectionId: Number(values.sectionId),
      subjectId: Number(values.subjectId),
      academicTermId: values.academicTermId ? Number(values.academicTermId) : null,
      gradingCategoryId: values.gradingCategoryId ? Number(values.gradingCategoryId) : null,
      title: values.title,
      description: values.description ?? values.instructions ?? null,
      dueAt: dueAt ? `${String(dueAt).slice(0, 10)}T23:59:00` : null,
      maxScore: values.maxScore ?? null,
      status: values.status || 'published',
      onlineSubmissionEnabled: values.onlineSubmissionEnabled === true
    })
  });
  return normalizeApiAssignment(response?.assignment);
}

async function updateApiAssignment(assignmentId, values = {}) {
  const response = await requestApi(`/assignments/${Number(assignmentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      academicTermId: values.academicTermId === undefined ? undefined : (values.academicTermId ? Number(values.academicTermId) : null),
      gradingCategoryId: values.gradingCategoryId === undefined ? undefined : (values.gradingCategoryId ? Number(values.gradingCategoryId) : null),
      title: values.title,
      description: values.description ?? values.instructions,
      dueAt: values.dueAt || values.dueDate ? `${String(values.dueAt || values.dueDate).slice(0, 10)}T23:59:00` : null,
      maxScore: values.maxScore ?? null,
      status: values.status,
      onlineSubmissionEnabled: values.onlineSubmissionEnabled
    })
  });
  return normalizeApiAssignment(response?.assignment);
}

async function updateApiAssignmentStudentStatus(assignmentId, studentId, status) {
  const assignment = Number(assignmentId);
  const student = Number(studentId);
  if (!Number.isSafeInteger(assignment) || assignment < 1 || !Number.isSafeInteger(student) || student < 1) {
    throw new Error('The assignment or student ID is invalid.');
  }
  if (!['pending', 'submitted', 'not_submitted'].includes(status)) throw new Error('The submission status is invalid.');

  const response = await requestApi(`/assignments/${assignment}/students/${student}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
  return response ? {
    ...response,
    assignmentId: String(response.assignmentId),
    studentId: String(response.studentId),
    status: response.submissionStatus || status
  } : null;
}

async function deleteApiAssignment(assignmentId) {
  await requestApi(`/assignments/${Number(assignmentId)}`, { method: 'DELETE' });
  return true;
}

function normalizeApiGradingItem(record) {
  if (!record) return null;
  return {
    ...record,
    id: String(record.id),
    apiId: Number(record.id),
    sectionId: String(record.sectionId),
    subjectId: String(record.subjectId),
    academicTermId: String(record.academicTermId),
    academicPeriodId: String(record.academicTermId),
    gradingCategoryId: String(record.gradingCategoryId),
    categoryId: record.gradingCategoryCode || String(record.gradingCategoryId),
    cat: String(record.gradingCategoryCode || record.gradingCategoryName || '').slice(0, 3).toUpperCase(),
    name: record.title || '',
    max: Number(record.maxScore),
    maxScore: Number(record.maxScore),
    usedInPublishedGrades: Boolean(record.usedInPublishedGrades),
    journalPromptId: record.journalPromptId ? String(record.journalPromptId) : null,
    currentJournalSubjectId: record.currentJournalSubjectId ? String(record.currentJournalSubjectId) : null
  };
}

async function getApiGradingItems(filters = {}) {
  const params = new URLSearchParams();
  ['sectionId', 'studentId'].forEach(name => {
    if (filters[name] !== undefined && filters[name] !== null && String(filters[name]).trim()) {
      params.set(name, String(filters[name]).trim());
    }
  });
  const query = params.toString();
  const response = await requestApi(`/grading-items${query ? `?${query}` : ''}`);
  return (response?.gradingItems || []).map(normalizeApiGradingItem).filter(Boolean);
}

async function createApiGradingItem(values = {}) {
  const response = await requestApi('/grading-items', {
    method: 'POST',
    body: JSON.stringify({
      sectionId: Number(values.sectionId),
      subjectId: Number(values.subjectId),
      academicTermId: Number(values.academicTermId),
      gradingCategoryId: Number(values.gradingCategoryId),
      assignmentId: values.assignmentId ? Number(values.assignmentId) : undefined,
      title: values.title,
      maxScore: values.maxScore
    })
  });
  return normalizeApiGradingItem(response?.gradingItem);
}

async function updateApiGradingItem(gradingItemId, values = {}) {
  const response = await requestApi(`/grading-items/${Number(gradingItemId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: values.title, maxScore: values.maxScore })
  });
  return normalizeApiGradingItem(response?.gradingItem);
}

async function deleteApiGradingItem(gradingItemId) {
  return requestApi(`/grading-items/${Number(gradingItemId)}`, { method: 'DELETE' });
}

function normalizeApiStudentScore(record) {
  return record ? {
    ...record,
    id: String(record.id),
    apiId: Number(record.id),
    gradingItemId: String(record.gradingItemId),
    studentId: String(record.studentId),
    score: record.score === null || record.score === undefined ? null : Number(record.score)
  } : null;
}

async function getApiStudentScores(filters = {}) {
  const params = new URLSearchParams();
  ['gradingItemId', 'studentId'].forEach(name => {
    if (filters[name] !== undefined && filters[name] !== null && String(filters[name]).trim()) {
      params.set(name, String(filters[name]).trim());
    }
  });
  const query = params.toString();
  const response = await requestApi(`/student-scores${query ? `?${query}` : ''}`);
  return (response?.studentScores || response?.scores || []).map(normalizeApiStudentScore).filter(Boolean);
}

async function saveApiStudentScore(values = {}) {
  const response = await requestApi('/student-scores', {
    method: 'POST',
    body: JSON.stringify({
      gradingItemId: Number(values.gradingItemId),
      studentId: Number(values.studentId),
      score: values.score === '' ? null : values.score,
      remarks: values.remarks || null
    })
  });
  return normalizeApiStudentScore(response?.studentScore || response?.score);
}

async function getApiGradingPeriodReopenRequests(filters = {}) {
  const params = new URLSearchParams();
  ['sectionId', 'subjectId', 'academicTermId'].forEach(name => {
    if (filters[name] !== undefined && filters[name] !== null && String(filters[name]).trim()) {
      params.set(name, String(filters[name]).trim());
    }
  });
  const query = params.toString();
  const response = await requestApi(`/grading-period-reopen-requests${query ? `?${query}` : ''}`);
  return Array.isArray(response?.requests) ? response.requests : [];
}

async function getApiGradeEditAccess(scope = {}) {
  const params = new URLSearchParams();
  ['sectionId', 'subjectId', 'academicTermId'].forEach(name => {
    if (scope[name] !== undefined && scope[name] !== null && String(scope[name]).trim()) {
      params.set(name, String(scope[name]).trim());
    }
  });
  const response = await requestApi(`/grading-period-reopen-requests/access?${params.toString()}`);
  return response || null;
}

async function createApiGradingPeriodReopenRequest(values = {}) {
  const response = await requestApi('/grading-period-reopen-requests', {
    method: 'POST',
    body: JSON.stringify({
      sectionId: Number(values.sectionId),
      subjectId: Number(values.subjectId),
      academicTermId: Number(values.academicTermId),
      reason: values.reason
    })
  });
  return response?.request || null;
}

async function decideApiGradingPeriodReopenRequest(requestId, action, values = {}) {
  const allowedActions = new Set(['approve', 'reject', 'extend', 'revoke']);
  if (!allowedActions.has(action)) throw new Error('The reopen request action is invalid.');
  const body = action === 'approve'
    ? { expiresAt: values.expiresAt, adminNote: values.adminNote }
    : action === 'reject'
      ? { adminNote: values.adminNote }
      : action === 'extend'
        ? { expiresAt: values.expiresAt, reason: values.reason }
        : { reason: values.reason };
  const response = await requestApi(`/grading-period-reopen-requests/${Number(requestId)}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return response?.request || null;
}

async function getApiFinalGradePreview(scope = {}) {
  const params = new URLSearchParams();
  ['sectionId', 'subjectId', 'academicTermId'].forEach(name => {
    if (scope[name] !== undefined && scope[name] !== null && String(scope[name]).trim()) {
      params.set(name, String(scope[name]).trim());
    }
  });
  const response = await requestApi(`/final-grades/preview?${params.toString()}`);
  if (!response?.preview) throw new Error('The grade preview could not be loaded.');
  return response.preview;
}

async function publishApiFinalGrades(scope = {}) {
  const response = await requestApi('/final-grades/publish', {
    method: 'POST',
    body: JSON.stringify({
      sectionId: String(scope.sectionId || ''),
      subjectId: String(scope.subjectId || ''),
      academicTermId: String(scope.academicTermId || '')
    })
  });
  if (!response?.published) throw new Error('The grades were not published.');
  return response;
}

function normalizeApiFinalGrade(record) {
  return record ? {
    ...record,
    id: String(record.id),
    schoolId: String(record.schoolId),
    studentId: String(record.studentId),
    sectionId: String(record.sectionId),
    subjectId: String(record.subjectId),
    academicTermId: String(record.academicTermId),
    academicYearId: String(record.academicYearId),
    finalGrade: Number(record.finalGrade)
  } : null;
}

function gradeScoreClass(subject) {
  if (subject.finalGrade === null || subject.finalGrade === undefined || !Number.isFinite(Number(subject.finalGrade))) return 'is-pending';
  const threshold = subject.passingGradeThreshold;
  if (threshold === null || threshold === undefined || threshold === '' || !Number.isFinite(Number(threshold))
    || Number(threshold) < 0 || Number(threshold) > 100) return 'is-published';
  return Number(subject.finalGrade) >= Number(threshold) ? 'is-published is-passing' : 'is-published is-below-passing';
}

function buildApiFinalGradeYears(overview) {
  const grades = Array.isArray(overview?.publishedGrades) ? overview.publishedGrades : [];
  const years = Array.isArray(overview?.academicYears) ? overview.academicYears.map(year => ({ ...year })) : [];

  grades.forEach(grade => {
    if (!years.some(year => year.id === grade.academicYearId)) {
      years.push({
        id: grade.academicYearId,
        label: grade.academicYearLabel,
        status: grade.academicYearStatus || 'closed',
        sections: []
      });
    }
  });

  return years.map(year => {
    const periodsByKey = new Map();
    (year.sections || []).forEach(section => {
      const termsBySequence = new Map((section.terms || []).map(term => [Number(term.sequenceNumber), term]));
      const counts = { quarterly: 4, semestral: 2, semester: 2, trimestral: 3, three_term: 3 };
      const configuredCount = counts[section.gradingPeriodType] || 0;
      const periodCount = year.status === 'closed' && termsBySequence.size
        ? termsBySequence.size
        : Math.max(configuredCount, termsBySequence.size);

      for (let sequenceNumber = 1; sequenceNumber <= periodCount; sequenceNumber += 1) {
        const term = termsBySequence.get(sequenceNumber);
        const periodType = section.gradingPeriodType || 'period';
        const periodKey = periodType + ':' + sequenceNumber;
        if (!periodsByKey.has(periodKey)) {
          const names = { quarterly: 'Quarter', semestral: 'Semester', semester: 'Semester', trimestral: 'Trimester', three_term: 'Term' };
          periodsByKey.set(periodKey, {
            id: year.id + ':' + periodKey,
            label: term?.name || (names[periodType] || 'Period') + ' ' + sequenceNumber,
            sequenceNumber,
            status: 'unconfigured',
            disabled: true,
            termIds: [],
            subjects: []
          });
        }

        const period = periodsByKey.get(periodKey);
        if (!term) continue;
        if (!period.termIds.includes(term.id)) period.termIds.push(term.id);
        if (term.status === 'active') {
          period.status = 'active';
          period.disabled = false;
        } else if (term.status === 'closed' && period.status !== 'active') {
          period.status = 'closed';
          period.disabled = false;
        } else if (term.status === 'upcoming' && period.status === 'unconfigured') {
          period.status = 'upcoming';
        }

        (section.subjects || []).forEach(subject => {
          const grade = grades.find(item => item.sectionId === section.id
            && item.academicYearId === year.id
            && item.academicTermId === term.id
            && item.subjectId === subject.subjectId);
          period.subjects.push({
            sectionId: section.id,
            subjectId: subject.subjectId,
            subjectName: subject.subjectName,
            sectionName: section.name,
            finalGrade: grade ? grade.finalGrade : null,
            passingGradeThreshold: grade?.passingGradeThreshold ?? section.passingGradeThreshold,
            publishedAt: grade?.publishedAt || null
          });
        });
      }
    });

    grades.filter(grade => grade.academicYearId === year.id).forEach(grade => {
      const periodType = grade.gradingPeriodType || 'period';
      const sequenceNumber = Number(grade.academicTermSequenceNumber || 1);
      const periodKey = periodType + ':' + sequenceNumber;
      let period = Array.from(periodsByKey.values()).find(item => item.termIds.includes(grade.academicTermId));
      if (!period) {
        const names = { quarterly: 'Quarter', semestral: 'Semester', semester: 'Semester', trimestral: 'Trimester', three_term: 'Term' };
        period = {
          id: year.id + ':' + periodKey,
          label: grade.academicTermName || (names[periodType] || 'Period') + ' ' + sequenceNumber,
          sequenceNumber,
          status: 'history',
          disabled: false,
          termIds: [grade.academicTermId],
          subjects: []
        };
        periodsByKey.set(periodKey, period);
      }
      if (period.subjects.some(subject => subject.sectionId === grade.sectionId && subject.subjectId === grade.subjectId)) return;
      period.subjects.push({
        sectionId: grade.sectionId,
        subjectId: grade.subjectId,
        subjectName: grade.subjectName,
        sectionName: grade.sectionName,
        finalGrade: grade.finalGrade,
        passingGradeThreshold: grade.passingGradeThreshold,
        publishedAt: grade.publishedAt
      });
    });

    return {
      ...year,
      periods: Array.from(periodsByKey.values()).sort((first, second) => first.sequenceNumber - second.sequenceNumber)
    };
  }).sort((first, second) => new Date(second.startDate || 0) - new Date(first.startDate || 0));
}

async function getApiFinalGrades(filters = {}) {
  const params = new URLSearchParams();
  ['studentId', 'sectionId', 'subjectId', 'academicTermId', 'academicYearId'].forEach(name => {
    if (filters[name] !== undefined && filters[name] !== null && String(filters[name]).trim()) {
      params.set(name, String(filters[name]).trim());
    }
  });
  const query = params.toString();
  const response = await requestApi(`/final-grades${query ? `?${query}` : ''}`);
  return Array.isArray(response?.finalGrades)
    ? response.finalGrades.map(normalizeApiFinalGrade).filter(Boolean)
    : [];
}

async function getApiFinalGradesOverview(studentId) {
  const params = new URLSearchParams();
  if (studentId !== undefined && studentId !== null) params.set('studentId', String(studentId));
  const query = params.toString();
  const response = await requestApi(`/final-grades/overview${query ? `?${query}` : ''}`);
  const overview = response?.overview;
  if (!overview) return null;

  return {
    student: overview.student ? {
      ...overview.student,
      id: String(overview.student.id)
    } : null,
    academicYears: (overview.academicYears || []).map(year => ({
      ...year,
      id: String(year.id),
      sections: (year.sections || []).map(section => ({
        ...section,
        id: String(section.id),
        schoolLevelId: String(section.schoolLevelId),
        terms: (section.terms || []).map(term => ({
          ...term,
          id: String(term.id),
          sequenceNumber: Number(term.sequenceNumber)
        })),
        subjects: (section.subjects || []).map(subject => ({
          ...subject,
          subjectId: String(subject.subjectId)
        }))
      }))
    })),
    current: overview.current ? {
      ...overview.current,
      sectionId: String(overview.current.sectionId),
      academicYearId: String(overview.current.academicYearId),
      schoolLevelId: String(overview.current.schoolLevelId),
      terms: (overview.current.terms || []).map(term => ({
        ...term,
        id: String(term.id),
        sequenceNumber: Number(term.sequenceNumber)
      })),
      subjects: (overview.current.subjects || []).map(subject => ({
        ...subject,
        subjectId: String(subject.subjectId)
      }))
    } : null,
    publishedGrades: (overview.publishedGrades || []).map(grade => ({
      ...grade,
      id: String(grade.id),
      sectionId: String(grade.sectionId),
      subjectId: String(grade.subjectId),
      academicTermId: String(grade.academicTermId),
      academicYearId: String(grade.academicYearId),
      academicTermSequenceNumber: Number(grade.academicTermSequenceNumber),
      finalGrade: Number(grade.finalGrade)
    }))
  };
}

async function getApiAssignmentSubmissions(assignmentId) {
  const response = await requestApi(`/assignments/${Number(assignmentId)}/submissions`);
  return Array.isArray(response?.submissions) ? response.submissions.map(record => ({
    ...record,
    id: String(record.id),
    assignmentId: String(record.assignmentId),
    studentId: String(record.studentId),
    fileUrl: record.fileUrl || null,
    fileSize: record.fileSizeBytes,
    submittedAt: record.submittedAt || record.updatedAt || null,
    status: record.submissionStatus || 'pending'
  })) : [];
}

function getApiAssignmentSubmissionDownloadUrl(assignmentId, submissionId) {
  const assignment = Number(assignmentId);
  const submission = Number(submissionId);
  if (!EDUGNAY_API_BASE_URL || !Number.isSafeInteger(assignment) || assignment < 1
    || !Number.isSafeInteger(submission) || submission < 1) return null;

  return `${EDUGNAY_API_BASE_URL}/assignments/${assignment}/submissions/${submission}/download`;
}

async function getApiAssignmentSubmissionPreview(assignmentId, submissionId) {
  const assignment = Number(assignmentId);
  const submission = Number(submissionId);
  if (!Number.isSafeInteger(assignment) || assignment < 1 || !Number.isSafeInteger(submission) || submission < 1) {
    throw new Error('The submitted file could not be identified.');
  }
  return requestApiFile(`/assignments/${assignment}/submissions/${submission}/preview`);
}

async function submitApiAssignment(assignmentId, file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await requestApiMultipart(`/assignments/${Number(assignmentId)}/submissions`, formData);
  return response ? {
    ...response,
    assignmentId: String(response.assignmentId),
    studentId: String(response.studentId),
    fileSize: response.fileSizeBytes,
    status: response.submissionStatus || 'submitted'
  } : null;
}

async function getApiGradingCategories(filters = {}) {
  const params = new URLSearchParams();
  if (filters.schoolLevelId) params.set('schoolLevelId', String(filters.schoolLevelId));
  const query = params.toString();
  const response = await requestApi(`/grading-categories${query ? `?${query}` : ''}`);
  return Array.isArray(response?.gradingCategories)
    ? response.gradingCategories.map(category => ({ ...category, weight: Number(category.weight) }))
    : [];
}

async function updateApiGradingCategories(values = {}) {
  const response = await requestApi('/grading-categories', {
    method: 'PATCH',
    body: JSON.stringify(values)
  });
  return {
    ...response,
    passingGradeThreshold: Number(response?.passingGradeThreshold),
    gradingCategories: Array.isArray(response?.gradingCategories)
      ? response.gradingCategories.map(category => ({ ...category, weight: Number(category.weight) }))
      : []
  };
}

function normalizeApiAttendanceData(data) {
  if (!data) return null;
  return {
    ...data,
    subjectId: data.subjectId == null ? null : String(data.subjectId),
    attendanceDate: normalizeApiDate(data.attendanceDate),
    currentDate: normalizeApiDate(data.currentDate),
    canEdit: data.canEdit === true,
    session: data.session ? {
      ...data.session,
      id: String(data.session.id),
      status: data.session.status || 'draft'
    } : null,
    students: Array.isArray(data.students) ? data.students.map(student => ({
      ...student,
      id: String(student.id || student.studentId),
      studentId: String(student.studentId || student.id),
      displayName: student.displayName || '',
      initials: student.initials || '',
      attendanceStatus: student.attendanceStatus || null,
      remark: student.remarks || student.remark || null,
      isScanned: Boolean(student.isScanned)
    })) : []
  };
}

async function getApiSectionAttendance(sectionId, subjectId, date) {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const response = await requestApi(`/attendance/sections/${Number(sectionId)}/subjects/${Number(subjectId)}${query}`);
  return normalizeApiAttendanceData(response);
}

async function getApiSectionAttendanceHistory(sectionId, subjectId) {
  const response = await requestApi(`/attendance/sections/${Number(sectionId)}/subjects/${Number(subjectId)}/history`);
  return {
    section: response?.section || null,
    sessions: Array.isArray(response?.sessions)
      ? response.sessions.map(session => normalizeApiAttendanceData({ ...session, section: response.section, subjectId: response.subjectId }))
      : []
  };
}

async function saveApiSectionAttendance(sectionId, subjectId, values = {}) {
  const response = await requestApi(`/attendance/sections/${Number(sectionId)}/subjects/${Number(subjectId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      attendanceDate: values.attendanceDate,
      records: (values.records || []).map(record => ({
        studentId: Number(record.studentId),
        status: record.status,
        remarks: record.remarks ?? record.remark ?? null
      }))
    })
  });
  return normalizeApiAttendanceData(response);
}

async function getApiQrAttendance(sectionId, subjectId) {
  const response = await requestApi(`/qr-attendance/sections/${Number(sectionId)}/subjects/${Number(subjectId)}`);
  return normalizeApiAttendanceData(response);
}

async function startApiQrAttendance(sectionId, subjectId) {
  const response = await requestApi(`/qr-attendance/sections/${Number(sectionId)}/subjects/${Number(subjectId)}/start`, { method: 'POST' });
  return normalizeApiAttendanceData(response);
}

async function scanApiQrAttendance(sessionId, qrToken) {
  const response = await requestApi(`/qr-attendance/sessions/${Number(sessionId)}/scan`, {
    method: 'POST',
    body: JSON.stringify({ qrToken })
  });
  return response ? {
    ...response,
    student: response.student ? {
      ...response.student,
      id: String(response.student.id)
    } : null
  } : null;
}

async function confirmApiQrAttendance(sessionId, records = []) {
  const response = await requestApi(`/qr-attendance/sessions/${Number(sessionId)}/confirm`, {
    method: 'PUT',
    body: JSON.stringify({
      records: records.map(record => ({
        studentId: Number(record.studentId),
        status: record.status,
        remarks: record.remarks ?? record.remark ?? null
      }))
    })
  });
  return normalizeApiAttendanceData(response);
}

async function getApiParentAttendance() {
  return requestApi('/attendance/children');
}

async function getApiSchoolAttendanceSummary(academicYearId = '') {
  const query = academicYearId ? `?academicYearId=${Number(academicYearId)}` : '';
  return requestApi(`/attendance/school-summary${query}`);
}

async function getApiSchoolGradeSummary(academicYearId = '') {
  const query = academicYearId ? `?academicYearId=${Number(academicYearId)}` : '';
  return requestApi(`/reports/grade-summary${query}`);
}

async function getApiArchive() {
  return requestApi('/archive');
}

async function getApiArchivedYear(yearId) {
  const id = Number(yearId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('The academic year is invalid.');
  return requestApi(`/archive/academic-years/${id}`);
}

async function archiveApiAcademicYear(yearId) {
  const id = Number(yearId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('The academic year is invalid.');
  return requestApi(`/archive/academic-years/${id}`, { method: 'POST' });
}

async function getApiStudentQr(studentId) {
  const response = await requestApi(`/qr-attendance/students/${Number(studentId)}/qr`);
  return response || null;
}

async function regenerateApiStudentQr(studentId) {
  const response = await requestApi(`/qr-attendance/students/${Number(studentId)}/qr/regenerate`, { method: 'POST' });
  return response || null;
}

const API_NOTIFICATION_PAGE_BY_TYPE = {
  announcement: 'announcements',
  assignment: 'assignments',
  grade: 'grades',
  attendance: 'attendance',
  report: 'reports',
  journal: 'journal',
  task: 'dashboard'
};

function formatApiAnnouncementTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function normalizeApiAnnouncement(record) {
  if (!record) return null;
  const audiences = Array.isArray(record.audiences) ? record.audiences : [];
  const audienceKeys = audiences.map(audience => {
    if (audience.type === 'school_admin') return 'admins';
    if (audience.type === 'teacher') return 'teachers';
    if (audience.type === 'student') return 'students';
    if (audience.type === 'parent') return 'parents';
    if (audience.type === 'section') return 'section';
    return 'all';
  });
  const primaryAudience = audienceKeys.includes('all') ? 'all' : audienceKeys[0] || 'all';
  const audienceMeta = {
    all: { label: 'All Users', className: 'aud-all', icon: 'users' },
    admins: { label: 'School Admins', className: 'aud-all', icon: 'shield-check' },
    teachers: { label: 'Teachers', className: 'aud-teacher', icon: 'book-open' },
    students: { label: 'Students', className: 'aud-student', icon: 'graduation-cap' },
    parents: { label: 'Parents', className: 'aud-parent', icon: 'heart-handshake' },
    section: { label: 'Assigned section', className: 'aud-all', icon: 'school' }
  }[primaryAudience];
  const priority = ['normal', 'high', 'event'].includes(record.priority) ? record.priority : 'normal';
  const publishedAt = record.publishedAt || record.createdAt;

  return {
    id: String(record.id),
    apiId: Number(record.id),
    schoolId: Number(record.schoolId) === 1 ? 'scc' : String(record.schoolId || ''),
    title: String(record.title || ''),
    body: String(record.body || ''),
    priority,
    status: record.status,
    draft: record.status !== 'published',
    audienceKeys,
    audienceKey: audienceKeys.join('-'),
    audience: audiences.map(audience => {
      if (audience.type === 'section') return 'Assigned section';
      const key = audience.type === 'school_admin' ? 'admins'
        : audience.type === 'teacher' ? 'teachers'
          : audience.type === 'student' ? 'students'
            : audience.type === 'parent' ? 'parents' : 'all';
      return ({
        all: 'All Users',
        admins: 'School Admins',
        teachers: 'Teachers',
        students: 'Students',
        parents: 'Parents'
      })[key];
    }).join(' & ') || audienceMeta.label,
    audienceClass: audienceMeta.className,
    audienceIcon: audienceMeta.icon,
    author: record.authorName || '',
    authorId: record.authorUserId ? String(record.authorUserId) : null,
    time: formatApiAnnouncementTime(publishedAt),
    tag: priority === 'high' ? 'Urgent' : priority === 'event' ? 'Event' : 'Normal',
    tagClass: priority === 'high' ? 'badge-red' : priority === 'event' ? 'badge-gold' : 'badge-blue',
    seen: record.status !== 'published' ? 'Not yet published' : 'Not yet viewed',
    read: Boolean(record.isRead),
    pinned: record.pinned === true,
    icon: priority === 'high' ? 'alert-triangle' : priority === 'event' ? 'calendar-days' : 'megaphone',
    iconClass: priority === 'high' ? 'icon-high' : priority === 'event' ? 'icon-event' : 'icon-normal',
    imageUrl: record.imageUrl ? new URL(record.imageUrl, EDUGNAY_API_BASE_URL).href : null,
    scheduledAt: record.scheduledAt || null,
    createdAt: record.createdAt,
    publishedAt: record.publishedAt || null,
    access: null
  };
}

async function getApiAnnouncements() {
  const response = await requestApi('/announcements');
  return (response?.announcements || []).map(normalizeApiAnnouncement).filter(Boolean);
}

async function createApiAnnouncement(values = {}) {
  const fields = {
    title: values.title, body: values.body, priority: values.priority || 'normal',
    status: values.status || 'published', audiences: values.audiences || values.audience || ['all'],
    scheduledAt: values.scheduledAt || null
  };
  const form = values.image instanceof File ? new FormData() : null;
  if (form) {
    Object.entries(fields).forEach(([key, value]) => { if (value !== null) form.append(key, Array.isArray(value) ? JSON.stringify(value) : value); });
    form.append('image', values.image);
  }
  const response = await requestApi('/announcements', { method: 'POST', body: form || JSON.stringify(fields) });
  return normalizeApiAnnouncement(response?.announcement);
}

async function updateApiAnnouncement(announcementId, values = {}) {
  const fields = {
    title: values.title, body: values.body, priority: values.priority,
    status: values.status, audiences: values.audiences || values.audience,
    scheduledAt: values.scheduledAt || null, removeImage: values.removeImage === true
  };
  const form = values.image instanceof File ? new FormData() : null;
  if (form) {
    Object.entries(fields).forEach(([key, value]) => { if (value !== undefined && value !== null) form.append(key, Array.isArray(value) ? JSON.stringify(value) : value); });
    form.append('image', values.image);
  }
  const response = await requestApi(`/announcements/${Number(announcementId)}`, { method: 'PATCH', body: form || JSON.stringify(fields) });
  return normalizeApiAnnouncement(response?.announcement);
}

async function setApiAnnouncementPinned(announcementId, pinned) {
  const response = await requestApi(`/announcements/${Number(announcementId)}/pin`, {
    method: 'PATCH', body: JSON.stringify({ pinned })
  });
  return response?.announcement;
}

async function deleteApiAnnouncement(announcementId) {
  const id = Number(announcementId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid announcement ID.');
  return requestApi(`/announcements/${id}`, { method: 'DELETE' });
}

async function markApiAnnouncementRead(announcementId) {
  return requestApi(`/announcements/${Number(announcementId)}/read`, { method: 'POST' });
}

function normalizeApiNotification(record) {
  if (!record) return null;
  const type = String(record.type || 'notification').toLowerCase();
  const page = API_NOTIFICATION_PAGE_BY_TYPE[type] || 'notifications';
  let link = { page };
  if (type === 'grading_period_reopen') {
    try {
      const target = new URL(String(record.targetPath || ''), window.location.origin);
      const sectionId = target.searchParams.get('sectionId') || '';
      const subjectId = target.searchParams.get('subjectId') || '';
      if (target.origin === window.location.origin
        && target.pathname === '/views/teacher/edugnay-teacher-sections.html'
        && /^\d+$/.test(sectionId)
        && /^\d+$/.test(subjectId)
        && target.searchParams.get('tab') === 'scores') {
        link = { page: 'section', section: sectionId, subjectId, tab: 'scores' };
      }
    } catch {
      link = { page: 'notifications' };
    }
  }
  const visual = {
    school_account: { icon: 'building-2', tone: 'blue', label: 'School account' },
    announcement: { icon: 'megaphone', tone: 'gold', label: 'Announcement' },
    assignment: { icon: 'clipboard-list', tone: 'blue', label: 'Assignment' },
    grade: { icon: 'clipboard-pen', tone: 'orange', label: 'Grades' },
    attendance: { icon: 'user-check', tone: 'red', label: 'Attendance' },
    report: { icon: 'file-text', tone: 'orange', label: 'Report' },
    journal: { icon: 'notebook-pen', tone: 'purple', label: 'Journal' },
    task: { icon: 'list-checks', tone: 'blue', label: 'Task' },
    grading_period_reopen: { icon: 'clipboard-check', tone: 'blue', label: 'Grade access' }
  }[type] || { icon: 'bell', tone: 'gray', label: 'Notification' };
  return {
    id: String(record.id),
    apiId: Number(record.id),
    icon: visual.icon,
    tone: visual.tone,
    type: visual.label,
    read: Boolean(record.isRead),
    title: String(record.title || ''),
    message: String(record.message || ''),
    link,
    createdAt: record.createdAt
  };
}

async function getApiNotifications(limit = 50) {
  const response = await requestApi(`/notifications?limit=${Number(limit) || 50}`);
  return (response?.notifications || []).map(normalizeApiNotification).filter(Boolean);
}

async function markApiNotificationRead(notificationId) {
  return requestApi(`/notifications/${Number(notificationId)}/read`, { method: 'POST' });
}

async function markAllApiNotificationsRead() {
  return requestApi('/notifications/read-all', { method: 'POST' });
}

function normalizeApiTask(record) {
  if (!record) return null;
  const dueDate = typeof record.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.dueDate)
    ? record.dueDate
    : null;
  return {
    id: String(record.id),
    apiId: Number(record.id),
    title: String(record.title || ''),
    dueDate,
    status: record.status === 'completed' ? 'completed' : 'pending',
    completedAt: record.completedAt || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null
  };
}

async function getApiTasks() {
  const response = await requestApi('/tasks');
  return (response?.tasks || []).map(normalizeApiTask).filter(Boolean);
}

async function createApiTask(values = {}) {
  const response = await requestApi('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: values.title, dueDate: values.dueDate || null, status: values.status || 'pending' })
  });
  return normalizeApiTask(response?.task);
}

async function updateApiTask(taskId, values = {}) {
  const response = await requestApi(`/tasks/${Number(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: values.title,
      dueDate: values.dueDate === undefined ? undefined : (values.dueDate || null),
      status: values.status
    })
  });
  return normalizeApiTask(response?.task);
}

async function deleteApiTask(taskId) {
  return requestApi(`/tasks/${Number(taskId)}`, { method: 'DELETE' });
}

async function loadApiCommunication(role) {
  if (!EDUGNAY_API_BASE_URL) return { backend: false, notifications: [], announcements: [], tasks: [] };
  const [notifications, tasks, announcements] = await Promise.all([
    getApiNotifications(),
    getApiTasks(),
    role === 'platform_admin' ? Promise.resolve([]) : getApiAnnouncements()
  ]);
  return { backend: true, notifications, announcements, tasks };
}

async function getApiPlatformSchools() {
  const response = await requestApi('/platform/schools');
  return Array.isArray(response?.schools)
    ? response.schools.map(school => ({ ...school, logoUrl: resolveApiSchoolLogo(school.logoUrl) })) : [];
}

async function getApiPlatformSchool(schoolId) {
  const response = await requestApi(`/platform/schools/${Number(schoolId)}`);
  return { ...response, school: { ...response.school, logoUrl: resolveApiSchoolLogo(response.school?.logoUrl) } };
}

async function changeApiPlatformSchool(schoolId, action, reason) {
  if (!['approve', 'reject', 'suspend', 'reactivate'].includes(action)) throw new Error('School action is invalid.');
  return requestApi(`/platform/schools/${Number(schoolId)}/${action}`, {
    method: 'POST', body: JSON.stringify(reason ? { reason } : {})
  });
}

async function getApiPlatformActivityPage(filters = {}) {
  const params = new URLSearchParams();
  ['limit', 'category', 'date', 'search', 'cursor'].forEach(key => {
    if (filters[key] !== undefined && filters[key] !== null && String(filters[key]).trim()) params.set(key, String(filters[key]).trim());
  });
  return requestApi(`/platform/activity?${params.toString()}`);
}

async function getApiSchoolActivityPage(filters = {}) {
  const params = new URLSearchParams();
  ['limit', 'category', 'date', 'search', 'cursor'].forEach(key => {
    if (filters[key] !== undefined && filters[key] !== null && String(filters[key]).trim()) {
      params.set(key, String(filters[key]).trim());
    }
  });
  return requestApi(`/school/activity?${params.toString()}`);
}

async function getApiDashboardActivity(scope) {
  const response = scope === 'platform'
    ? await getApiPlatformActivityPage({ limit: 4 })
    : await getApiSchoolActivityPage({ limit: 4 });
  return Array.isArray(response?.activities) ? response.activities : [];
}

function setApiSchoolContext(school, features = null) {
  window.EDUGNAY_API_SCHOOL_CONTEXT = school || null;
  window.EDUGNAY_API_PORTAL_FEATURES = features || null;
}

function setApiPortalFeatures(features) {
  window.EDUGNAY_API_PORTAL_FEATURES = features || null;
}

window.EDUGNAY_API = {
  request: requestApi,
  requestFile: requestApiFile,
  requestMultipart: requestApiMultipart,
  isBackendAvailable: Boolean(EDUGNAY_API_BASE_URL),
  normalizeUser: normalizeApiUser,
  getUsers: getApiUsers,
  getAllUsers: getAllApiUsers,
  getUser: getApiUser,
  createUser: createApiUser,
  updateUser: updateApiUser,
  deleteUser: deleteApiUser,
  setUserStatus: setApiUserStatus,
  getSchoolSettings: getApiSchoolSettings,
  getParentNotificationTriggers: getApiParentNotificationTriggers,
  updateParentNotificationTriggers: updateApiParentNotificationTriggers,
  updateSchoolSettings: updateApiSchoolSettings,
  updateSchoolLogo: updateApiSchoolLogo,
  registerSchool: registerApiSchool,
  getPortalFeatures: getApiPortalFeatures,
  updatePortalFeatures: updateApiPortalFeatures,
  getAcademicStructure: getApiAcademicStructure,
  updateAcademicStructure: updateApiAcademicStructure,
  getAcademicYears: getApiAcademicYears,
  getAcademicTerms: getApiAcademicTerms,
  createAcademicYear: createApiAcademicYear,
  updateAcademicYear: updateApiAcademicYear,
  createAcademicTerm: createApiAcademicTerm,
  updateAcademicTerm: updateApiAcademicTerm,
  activateAcademicTerm: activateApiAcademicTerm,
  completeAcademicTerm: completeApiAcademicTerm,
  extendAcademicTerm: extendApiAcademicTerm,
  getAssignments: getApiAssignments,
  getParentAssignmentActivity: getApiParentAssignmentActivity,
  getJournalSubjects: getApiJournalSubjects,
  getJournalSections: getApiJournalSections,
  getJournalPrompts: getApiJournalPrompts,
  getJournalHistory: getApiJournalHistory,
  deleteJournalPrompt: deleteApiJournalPrompt,
  createJournalPrompt: createApiJournalPrompt,
  updateJournalPrompt: updateApiJournalPrompt,
  getJournalEntries: getApiJournalEntries,
  submitJournalEntry: submitApiJournalEntry,
  reviewJournalEntry: reviewApiJournalEntry,
  createAssignment: createApiAssignment,
  updateAssignment: updateApiAssignment,
  updateAssignmentStudentStatus: updateApiAssignmentStudentStatus,
  deleteAssignment: deleteApiAssignment,
  getGradingItems: getApiGradingItems,
  createGradingItem: createApiGradingItem,
  updateGradingItem: updateApiGradingItem,
  deleteGradingItem: deleteApiGradingItem,
  getStudentScores: getApiStudentScores,
  saveStudentScore: saveApiStudentScore,
  getGradingPeriodReopenRequests: getApiGradingPeriodReopenRequests,
  getGradeEditAccess: getApiGradeEditAccess,
  createGradingPeriodReopenRequest: createApiGradingPeriodReopenRequest,
  decideGradingPeriodReopenRequest: decideApiGradingPeriodReopenRequest,
  getFinalGradePreview: getApiFinalGradePreview,
  publishFinalGrades: publishApiFinalGrades,
  getFinalGrades: getApiFinalGrades,
  getFinalGradesOverview: getApiFinalGradesOverview,
  getAssignmentSubmissions: getApiAssignmentSubmissions,
  getAssignmentSubmissionDownloadUrl: getApiAssignmentSubmissionDownloadUrl,
  getAssignmentSubmissionPreview: getApiAssignmentSubmissionPreview,
  submitAssignment: submitApiAssignment,
  getGradingCategories: getApiGradingCategories,
  updateGradingCategories: updateApiGradingCategories,
  getSectionAttendance: getApiSectionAttendance,
  getSectionAttendanceHistory: getApiSectionAttendanceHistory,
  saveSectionAttendance: saveApiSectionAttendance,
  getQrAttendance: getApiQrAttendance,
  startQrAttendance: startApiQrAttendance,
  scanQrAttendance: scanApiQrAttendance,
  confirmQrAttendance: confirmApiQrAttendance,
  getParentAttendance: getApiParentAttendance,
  getParentChildren: getApiParentChildren,
  getStudentParents: getApiStudentParents,
  getArchive: getApiArchive,
  getArchivedYear: getApiArchivedYear,
  archiveAcademicYear: archiveApiAcademicYear,
  getSchoolAttendanceSummary: getApiSchoolAttendanceSummary,
  getSchoolGradeSummary: getApiSchoolGradeSummary,
  getStudentQr: getApiStudentQr,
  regenerateStudentQr: regenerateApiStudentQr,
  getAnnouncements: getApiAnnouncements,
  createAnnouncement: createApiAnnouncement,
  updateAnnouncement: updateApiAnnouncement,
  setAnnouncementPinned: setApiAnnouncementPinned,
  deleteAnnouncement: deleteApiAnnouncement,
  markAnnouncementRead: markApiAnnouncementRead,
  getNotifications: getApiNotifications,
  markNotificationRead: markApiNotificationRead,
  markAllNotificationsRead: markAllApiNotificationsRead,
  getTasks: getApiTasks,
  createTask: createApiTask,
  updateTask: updateApiTask,
  deleteTask: deleteApiTask,
  getPlatformSchools: getApiPlatformSchools,
  getPlatformSchool: getApiPlatformSchool,
  changePlatformSchool: changeApiPlatformSchool,
  getPlatformActivityPage: getApiPlatformActivityPage,
  getDashboardActivity: getApiDashboardActivity,
  getSchoolActivityPage: getApiSchoolActivityPage,
  loadCommunication: loadApiCommunication,
  setSchoolContext: setApiSchoolContext,
  setPortalFeatures: setApiPortalFeatures
};

function readFrontendSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(EDUGNAY_SESSION_STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : null;
  } catch {
    return null;
  }
}

window.EDUGNAY_SESSION = window.EDUGNAY_SESSION || readFrontendSession();

function saveFrontendSession(session) {
  window.EDUGNAY_SESSION = session;
  try {
    sessionStorage.setItem(EDUGNAY_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // The backend cookie remains the source of authentication when storage is unavailable.
  }
}

async function getCurrentUser() {
  if (!EDUGNAY_API_BASE_URL) return window.EDUGNAY_SESSION;

  const response = await requestApi('/auth/me');
  const user = response?.user;
  if (!user?.id || !user.role) throw new Error('The session response is invalid.');
  const existing = readFrontendSession() || {};
  const session = {
    ...existing,
    apiUserId: user.id,
    apiSchoolId: user.schoolId,
    userId: existing.userId || String(user.id),
    schoolId: Number(user.schoolId) === 1 ? 'scc' : String(user.schoolId || existing.schoolId || ''),
    role: user.role,
    schoolEmail: user.schoolEmail,
    personalEmail: user.personalEmail,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    initials: user.initials,
    accountStatus: user.accountStatus,
    setupCompletedAt: user.setupCompletedAt
  };
  saveFrontendSession(session);
  return session;
}

function applyCurrentUserToShell(session) {
  if (!session) return;
  const roleLabels = {
    platform_admin: 'Platform Administrator',
    school_admin: 'Administrator',
    teacher: 'Faculty',
    student: 'Student',
    parent: 'Parent'
  };
  const roleLabel = roleLabels[session.role] || '';
  document.querySelectorAll('[data-current-user-name]').forEach(element => {
    element.textContent = session.displayName || '';
  });
  document.querySelectorAll('[data-current-user-initials]').forEach(element => {
    element.textContent = session.initials || '';
  });
  document.querySelectorAll('[data-current-user-role]').forEach(element => {
    element.textContent = roleLabel;
  });
  document.querySelectorAll('.tb-profile-name').forEach(element => {
    element.textContent = session.displayName || element.textContent;
  });
  document.querySelectorAll('.tb-profile-role').forEach(element => {
    element.textContent = roleLabel || element.textContent;
  });
  document.querySelectorAll('.tb-avatar').forEach(element => {
    element.textContent = session.initials || element.textContent;
  });
}

window.EDUGNAY_API.getCurrentUser = getCurrentUser;

async function enforceBackendProfileSetup(profilePage, expectedRole) {
  if (!EDUGNAY_API_BASE_URL) return false;

  try {
    const [session, response] = await Promise.all([
      getCurrentUser(),
      requestApi('/account-setup/status')
    ]);
    const setup = response?.setup;
    if (session?.role !== expectedRole || !setup?.required || setup.complete) return false;

    const currentPage = window.location.pathname.split('/').pop().toLowerCase();
    const targetPage = String(profilePage || '').split('/').pop().toLowerCase();
    if (targetPage && currentPage !== targetPage) {
      window.location.replace(`./${targetPage}?setup=required`);
      return true;
    }
  } catch (error) {
    console.warn('Unable to verify backend account setup status.', error.message);
  }

  return false;
}

window.EDUGNAY_API.enforceProfileSetup = enforceBackendProfileSetup;

/* Small rendering helpers shared by pages that build HTML from local records. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function isRecorded(score) {
  return score !== null && score !== undefined && score !== '' && Number.isFinite(Number(score));
}

function getInitials(name) {
  const value = String(name || '').trim();
  if (!value) return '';
  if (value.includes(',')) {
    const [last, first] = value.split(',', 2).map(part => part.trim());
    return `${first?.[0] || ''}${last?.[0] || ''}`.toUpperCase();
  }
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/* Small notification helpers shared by every portal shell and notification page. */
function getNotificationReadIds(storageKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(stored) ? [...new Set(stored.map(String))] : [];
  } catch {
    return [];
  }
}

function saveNotificationReadIds(storageKey, ids) {
  const values = Array.isArray(ids) ? ids : [];
  const uniqueIds = [...new Set(values.map(String))];
  localStorage.setItem(storageKey, JSON.stringify(uniqueIds));
  return uniqueIds;
}

function applyNotificationReadState(records, storageKey) {
  const readIds = new Set(getNotificationReadIds(storageKey));
  const values = Array.isArray(records) ? records : [];
  values.forEach(record => {
    record.read = Boolean(record.read || readIds.has(String(record.id)));
  });
  return values;
}

function markNotificationRead(storageKey, id, records = []) {
  const notificationId = String(id);
  const readIds = getNotificationReadIds(storageKey);
  if (!readIds.includes(notificationId)) readIds.push(notificationId);
  saveNotificationReadIds(storageKey, readIds);
  const record = (Array.isArray(records) ? records : [])
    .find(item => String(item.id) === notificationId);
  if (record) record.read = true;
  return record || null;
}

function markAllNotificationsRead(storageKey, records = []) {
  const values = Array.isArray(records) ? records : [];
  const readIds = new Set(getNotificationReadIds(storageKey));
  values.forEach(record => {
    readIds.add(String(record.id));
    record.read = true;
  });
  saveNotificationReadIds(storageKey, [...readIds]);
  return values;
}

async function markCurrentNotificationRead(id) {
  const context = window.EDUGNAY_NOTIFICATION_CONTEXT;
  if (!context) return null;
  const items = typeof context.getItems === 'function'
    ? context.getItems()
    : (Array.isArray(context.records) ? context.records : []);
  const record = items.find(item => String(item.id) === String(id)) || null;

  if (window.EDUGNAY_COMMUNICATION?.backend) {
    const apiNotificationId = Number(id);
    if (!Number.isSafeInteger(apiNotificationId) || apiNotificationId < 1 || !window.EDUGNAY_API?.markNotificationRead) return null;
    try {
      await window.EDUGNAY_API.markNotificationRead(apiNotificationId);
      if (record) record.read = true;
      return record;
    } catch (error) {
      window.alert(error?.message || 'The notification could not be marked as read.');
      return null;
    }
  }

  return markNotificationRead(context.storageKey, id, items);
}

async function markCurrentNotificationsRead() {
  const context = window.EDUGNAY_NOTIFICATION_CONTEXT;
  if (!context) return [];
  const items = typeof context.getItems === 'function'
    ? context.getItems()
    : (Array.isArray(context.records) ? context.records : []);

  if (window.EDUGNAY_COMMUNICATION?.backend) {
    if (!window.EDUGNAY_API?.markAllNotificationsRead) return items;
    try {
      await window.EDUGNAY_API.markAllNotificationsRead();
      items.forEach(item => { item.read = true; });
    } catch (error) {
      window.alert(error?.message || 'Notifications could not be marked as read.');
    }
    return items;
  }

  return markAllNotificationsRead(context.storageKey, items);
}

function formatDateGroup(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const startOfDay = value => new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function formatTime(dateValue) {
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatRelativeTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffHours = Math.floor((now - date) / 3600000);
  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  const group = formatDateGroup(date);
  if (group === 'Yesterday') return `Yesterday, ${formatTime(date)}`;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${formatTime(date)}`;
}

function applyCurrentDateToGradingBanners() {
  const currentDateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());

  document.querySelectorAll('.grading-banner [data-current-date]').forEach(element => {
    element.textContent = `${currentDateLabel}.`;
  });
}

/*
 * Frontend configuration store.
 * Replace the localStorage reads/writes with API calls during backend integration.
 */
(function initializeEdUgnayConfig() {
  const STORAGE_KEYS = {
    schools: 'edugnay_schools',
    activeSchool: 'edugnay_active_school',
    holidays: 'edugnay_holidays',
    users: 'edugnay_users',
    subjectAssignments: 'edugnay_subject_assignments',
    parentStudentLinks: 'edugnay_parent_student_links',
    attendance: 'edugnay_attendance',
    assignments: 'edugnay_assignments',
    assignmentStatuses: 'edugnay_assignment_statuses',
    assignmentSubmissions: 'edugnay_assignment_submissions',
    materials: 'edugnay_learning_materials',
    announcements: 'edugnay_announcements',
    reports: 'edugnay_reports',
    userProfiles: 'edugnay_user_profiles',
    userProfileSeedVersion: 'edugnay_user_profile_seed_version',
    schoolSeedVersion: 'edugnay_school_seed_version',
    userSeedVersion: 'edugnay_user_seed_version',
    parentStudentLinkSeedVersion: 'edugnay_parent_student_link_seed_version'
  };

  // Canonical values used by frontend records and future API responses.
  const RECORD_VALUES = {
    roles: {
      PLATFORM_ADMIN: 'platform_admin',
      SCHOOL_ADMIN: 'school_admin',
      TEACHER: 'teacher',
      STUDENT: 'student',
      PARENT: 'parent'
    },
    statuses: {
      ACTIVE: 'active',
      DRAFT: 'draft',
      INACTIVE: 'inactive',
      PENDING: 'pending',
      REJECTED: 'rejected',
      SUSPENDED: 'suspended'
    }
  };

  const PARENT_RELATIONSHIPS = ['mother', 'father', 'guardian'];
  const LRN_PATTERN = /^\d{12}$/;

  const GRADE_CATALOG = [
    {
      key: 'elementary',
      label: 'Elementary',
      grades: ['Kindergarten', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6']
    },
    {
      key: 'jhs',
      label: 'Junior High School',
      grades: ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10']
    },
    {
      key: 'shs',
      label: 'Senior High School',
      grades: ['Grade 11', 'Grade 12'],
      tracks: ['Academic', 'Technical-Vocational-Livelihood', 'Arts and Design', 'Sports'],
      strands: ['STEM', 'HUMSS', 'ABM', 'GAS', 'TVL']
    }
  ];

  const SUBJECT_CATALOG = [
    { id: 'filipino', name: 'Filipino', code: 'FIL', levels: ['elementary'] },
    { id: 'english', name: 'English', code: 'ENG', levels: ['elementary'] },
    { id: 'mathematics', name: 'Mathematics', code: 'MAT', levels: ['elementary', 'jhs', 'shs'] },
    { id: 'science', name: 'Science', code: 'SCI', levels: ['elementary', 'jhs', 'shs'] },
    { id: 'values-education', name: 'Values Education', code: 'VE', levels: ['elementary', 'jhs', 'shs'] },
    { id: 'araling-panlipunan', name: 'Araling Panlipunan', code: 'AP', levels: ['elementary', 'jhs'] },
    { id: 'mapeh', name: 'MAPEH', code: 'MAPEH', levels: ['elementary', 'jhs'] },
    { id: 'tle', name: 'Technology and Livelihood Education', code: 'TLE', levels: ['jhs'] },
    { id: 'esp', name: 'Edukasyon sa Pagpapakatao', code: 'ESP', levels: ['elementary', 'jhs'] },
    { id: 'pe-health', name: 'Physical Education and Health', code: 'PEH', levels: ['shs'] },
    { id: 'empowerment-technologies', name: 'Empowerment Technologies', code: 'E-TECH', levels: ['shs'] },
    { id: 'practical-research', name: 'Practical Research', code: 'PR', levels: ['shs'] }
  ];

  const ACADEMIC_PERIOD_TYPES = {
    quarterly: {
      id: 'quarterly',
      label: 'Quarterly',
      periodNames: ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'],
      idPrefix: 'q'
    },
    three_term: {
      id: 'three_term',
      label: 'Three-term',
      periodNames: ['Term 1', 'Term 2', 'Term 3'],
      idPrefix: 'term'
    },
    semester: {
      id: 'semester',
      label: 'Semestral',
      periodNames: ['Semester 1', 'Semester 2'],
      idPrefix: 'sem'
    }
  };

  const ACADEMIC_PERIOD_STATUSES = {
    UPCOMING: 'upcoming',
    ACTIVE: 'active',
    CLOSED: 'closed'
  };

  function getDefaultPeriodType(level) {
    return level === 'shs' ? 'semester' : 'quarterly';
  }

  function getPeriodType(type) {
    return ACADEMIC_PERIOD_TYPES[type] || ACADEMIC_PERIOD_TYPES.quarterly;
  }

  function createAcademicPeriods(type, periods = [], idContext = '') {
    const definition = getPeriodType(type);
    return definition.periodNames.map((defaultName, index) => {
      const values = periods[index] || {};
      const number = index + 1;
      return {
        id: idContext ? `${idContext}-${definition.idPrefix}${number}` : values.id || `${definition.idPrefix}${number}`,
        name: String(values.name || defaultName).trim(),
        sequence: number,
        status: Object.values(ACADEMIC_PERIOD_STATUSES).includes(values.status)
          ? values.status
          : ACADEMIC_PERIOD_STATUSES.UPCOMING,
        plannedStartDate: values.plannedStartDate || null,
        plannedEndDate: values.plannedEndDate || null,
        startedAt: values.startedAt || null,
        closedAt: values.closedAt || null
      };
    });
  }

  const DEFAULT_ATTENDANCE_CODES = [
    { id: 'present', name: 'Present', description: 'Student attended class', key: 'P', tone: 'present' },
    { id: 'absent', name: 'Absent', description: 'Student did not attend', key: 'A', tone: 'absent' },
    { id: 'late', name: 'Late / Tardy', description: 'Student arrived after roll call', key: 'L', tone: 'late' },
    { id: 'excused', name: 'Excused', description: 'Absence with a valid reason', key: 'E', tone: 'excused' }
  ];

  function makeAttendanceRules(values = {}) {
    return {
      statusCodes: Array.isArray(values.statusCodes) && values.statusCodes.length
        ? values.statusCodes.map(code => ({ ...code }))
        : DEFAULT_ATTENDANCE_CODES.map(code => ({ ...code })),
      maxUnexcusedAbsences: Number.isFinite(Number(values.maxUnexcusedAbsences)) ? Number(values.maxUnexcusedAbsences) : 5,
      consecutiveAbsencesAlert: Number.isFinite(Number(values.consecutiveAbsencesAlert)) ? Number(values.consecutiveAbsencesAlert) : 3,
      lateCountAsAbsence: Number.isFinite(Number(values.lateCountAsAbsence)) ? Number(values.lateCountAsAbsence) : 3,
      countExcusedAbsences: Boolean(values.countExcusedAbsences),
      allowEditPastAttendance: values.allowEditPastAttendance !== false
    };
  }

  function createDivision(level, values = {}) {
    const catalog = GRADE_CATALOG.find(item => item.key === level);
    const defaultRules = level === 'shs'
      ? [
        { id: 'performance', label: 'Written and Performance Work', weight: 60 },
        { id: 'assessment', label: 'Quarterly Assessment', weight: 40 }
      ]
      : [
        { id: 'ww', label: 'Written Work', weight: 30 },
        { id: 'pt', label: 'Performance Task', weight: level === 'elementary' ? 40 : 50 },
        { id: 'qa', label: 'Quarterly Assessment', weight: level === 'elementary' ? 30 : 20 }
      ];

    const gradingPeriodType = ACADEMIC_PERIOD_TYPES[values.gradingPeriodType]
      ? values.gradingPeriodType
      : getDefaultPeriodType(level);
    const academicPeriods = createAcademicPeriods(
      gradingPeriodType,
      values.academicPeriods,
      values.periodIdContext
    );
    const legacyActivePeriod = academicPeriods.find(period => period.name === values.academicPeriod);
    const requestedActivePeriodId = values.activeAcademicPeriodId || legacyActivePeriod?.id || null;
    const activePeriod = academicPeriods.find(period => period.id === requestedActivePeriodId)
      || academicPeriods.find(period => period.status === ACADEMIC_PERIOD_STATUSES.ACTIVE)
      || null;
    const activeAcademicPeriodId = activePeriod?.id || null;

    if (activeAcademicPeriodId) {
      academicPeriods.forEach(period => {
        if (period.id === activeAcademicPeriodId) period.status = ACADEMIC_PERIOD_STATUSES.ACTIVE;
        else if (period.status === ACADEMIC_PERIOD_STATUSES.ACTIVE) period.status = ACADEMIC_PERIOD_STATUSES.UPCOMING;
        if (period.sequence < activePeriod.sequence) period.status = ACADEMIC_PERIOD_STATUSES.CLOSED;
      });
    }

    return {
      key: level,
      label: catalog?.label || level,
      gradingPeriodType,
      activeAcademicPeriodId,
      academicPeriods,
      enabledGrades: values.enabledGrades || [...(catalog?.grades || [])],
      tracks: values.tracks || [...(catalog?.tracks || [])],
      strands: values.strands || [...(catalog?.strands || [])],
      sections: values.sections || [],
      gradingRules: values.gradingRules || defaultRules,
      passingGradeThreshold: Number.isFinite(Number(values.passingGradeThreshold)) ? Number(values.passingGradeThreshold) : 75,
      gradeRounding: values.gradeRounding || 'round'
    };
  }

  function getSchoolLevelLabel(level) {
    return GRADE_CATALOG.find(item => item.key === level)?.label || level;
  }

  function getSchoolTypeInfo(levels) {
    const selected = GRADE_CATALOG
      .map(item => item.key)
      .filter(level => Array.isArray(levels) && levels.includes(level));

    if (selected.length === 1) {
      return { value: selected[0], label: getSchoolLevelLabel(selected[0]) };
    }

    if (selected.length === GRADE_CATALOG.length) {
      return { value: 'k12', label: 'K-12 School' };
    }

    return {
      value: 'multi-level',
      label: selected.length ? selected.map(getSchoolLevelLabel).join(' + ') : 'School'
    };
  }

  const DEFAULT_SCHOOLS = [
    {
      id: 'scc',
      name: "Saint Columban's College",
      shortName: "SAINT COLUMBAN'S COLLEGE",
      schoolType: 'k12',
      typeLabel: 'K-12 School',
      schoolId: '400168',
      regionName: 'Region I',
      divisionName: 'Pangasinan I, Lingayen',
      districtName: 'Lingayen I',
      address: 'Avenida Rizal, Lingayen, Pangasinan, Philippines',
      phone: '(049) 123 4567',
      email: 'info@stcolumban.edu.ph',
      website: 'stcolumban.edu.ph',
      logoUrl: '../../assets/images/st-columban-logo.png',
      schoolYear: '2025-2026',
      schoolYearStartDate: '2025-03-03',
      schoolYearEndDate: '2025-12-05',
      platformStatus: RECORD_VALUES.statuses.ACTIVE,
      submittedAt: null,
      notificationEmail: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      // School-wide portal policy. Replace this local setting with the
      // authenticated school's settings response during backend integration.
      gradesPageEnabled: true,
      // AI-assisted narrative reports are a school-wide portal policy. Replace
      // this local setting with the authenticated school's settings response
      // during backend integration.
      narrativeReportsEnabled: true,
      journalsEnabled: true,
      journalSubjectId: 'values-education',
      attendanceRules: makeAttendanceRules(),
      activeDivision: 'jhs',
      schoolLevels: ['elementary', 'jhs', 'shs'],
      divisions: {
        elementary: createDivision('elementary', {
          activeAcademicPeriodId: 'q2',
          academicPeriods: [
            { plannedStartDate: '2025-03-03', plannedEndDate: '2025-05-02' },
            { plannedStartDate: '2025-05-05', plannedEndDate: '2025-07-18' },
            { plannedStartDate: '2025-07-21', plannedEndDate: '2025-09-26' },
            { plannedStartDate: '2025-09-29', plannedEndDate: '2025-12-05' }
          ],
          sections: [
            { id: 'elem-grade4-luke', name: 'St. Luke', grade: 'Grade 4', capacity: 40, enrolled: 32 },
            { id: 'elem-grade5-mark', name: 'St. Mark', grade: 'Grade 5', capacity: 40, enrolled: 35 }
          ],
          gradingRules: [
            { id: 'ww', label: 'Written Work', weight: 30 },
            { id: 'pt', label: 'Performance Task', weight: 40 },
            { id: 'qa', label: 'Quarterly Assessment', weight: 30 }
          ]
        }),
        jhs: createDivision('jhs', {
          activeAcademicPeriodId: 'q2',
          academicPeriods: [
            { plannedStartDate: '2025-03-03', plannedEndDate: '2025-05-02' },
            { plannedStartDate: '2025-05-05', plannedEndDate: '2025-07-18' },
            { plannedStartDate: '2025-07-21', plannedEndDate: '2025-09-26' },
            { plannedStartDate: '2025-09-29', plannedEndDate: '2025-12-05' }
          ],
          sections: [
            { id: 'jhs-grade7-matthew', name: 'St. Matthew', grade: 'Grade 7', capacity: 40, enrolled: 38, adviserId: 'teacher-2' },
            { id: 'jhs-grade7-mark', name: 'St. Mark', grade: 'Grade 7', capacity: 40, enrolled: 34, adviserId: 'teacher-carla-dizon' },
            { id: 'jhs-grade8-luke', name: 'St. Luke', grade: 'Grade 8', capacity: 40, enrolled: 36, adviserId: 'teacher-9' },
            { id: 'jhs-grade8-john', name: 'St. John', grade: 'Grade 8', capacity: 40, enrolled: 34 },
            { id: 'jhs-grade9-peter', name: 'St. Peter', grade: 'Grade 9', capacity: 40, enrolled: 37, adviserId: 'teacher-rico-santos' },
            { id: 'jhs-grade9-paul', name: 'St. Paul', grade: 'Grade 9', capacity: 40, enrolled: 37, adviserId: 'teacher-jana-mendez' },
            { id: 'jhs-grade10-james', name: 'St. James', grade: 'Grade 10', capacity: 40, enrolled: 35, adviserId: 'teacher-3' },
            { id: 'jhs-grade10-thomas', name: 'St. Thomas', grade: 'Grade 10', capacity: 40, enrolled: 33, adviserId: 'teacher-ana-garcia' }
          ],
          gradingRules: [
            { id: 'ww', label: 'Written Work', weight: 30 },
            { id: 'pt', label: 'Performance Task', weight: 50 },
            { id: 'qa', label: 'Quarterly Assessment', weight: 20 }
          ]
        }),
        shs: createDivision('shs', {
          activeAcademicPeriodId: 'sem1',
          academicPeriods: [
            { plannedStartDate: '2025-03-03', plannedEndDate: '2025-07-18' },
            { plannedStartDate: '2025-07-21', plannedEndDate: '2025-12-05' }
          ],
          sections: [
            { id: 'shs-grade11-stem-a', name: 'STEM A', grade: 'Grade 11', strand: 'STEM', capacity: 40, enrolled: 28 },
            { id: 'shs-grade11-humss-a', name: 'HUMSS A', grade: 'Grade 11', strand: 'HUMSS', capacity: 40, enrolled: 26 },
            { id: 'shs-grade12-abm-a', name: 'ABM A', grade: 'Grade 12', strand: 'ABM', capacity: 40, enrolled: 31 },
            { id: 'shs-grade12-tvl-a', name: 'TVL A', grade: 'Grade 12', strand: 'TVL', capacity: 40, enrolled: 29 }
          ]
        })
      },
      initialAdministrator: {
        schoolId: 'scc',
        name: 'Sr. Admin',
        schoolEmail: 'admin.adm@stcolumban.edu.ph'
      }
    },
    {
      id: 'manghi',
      name: 'Mangaldan National High School',
      shortName: 'MANGHI',
      schoolType: 'multi-level',
      typeLabel: 'Junior High School + Senior High School',
      schoolId: null,
      regionName: null,
      divisionName: null,
      districtName: null,
      address: null,
      phone: null,
      email: null,
      website: null,
      logoUrl: '../../assets/images/manghi-logo.jpg',
      schoolYear: '2025-2026',
      schoolYearStartDate: null,
      schoolYearEndDate: null,
      platformStatus: RECORD_VALUES.statuses.PENDING,
      submittedAt: '2026-08-30T09:00:00.000Z',
      notificationEmail: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      gradesPageEnabled: false,
      narrativeReportsEnabled: false,
      journalsEnabled: false,
      journalSubjectId: null,
      attendanceRules: makeAttendanceRules(),
      activeDivision: 'jhs',
      schoolLevels: ['jhs', 'shs'],
      divisions: {
        jhs: createDivision('jhs'),
        shs: createDivision('shs')
      },
      initialAdministrator: {
        schoolId: 'manghi',
        name: 'Pending administrator',
        schoolEmail: null
      }
    }
  ];

  const DEFAULT_HOLIDAYS = [
    {
      id: 'demo-foundation-day',
      schoolId: 'scc',
      date: '2026-08-17',
      title: 'School Foundation Day',
      detail: 'No classes and no office transactions today.',
      type: 'holiday',
      appliesTo: 'all'
    },
    {
      id: 'national-heroes-day',
      schoolId: 'scc',
      date: '2026-08-31',
      title: 'National Heroes Day',
      detail: 'Regular classes resume on the next school day.',
      type: 'holiday',
      appliesTo: 'all'
    }
  ];

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clone(value) {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function normalizeDivisionRecord(level, division = {}, school = {}) {
    const legacyName = String(division.academicPeriod || '');
    const gradingPeriodType = ACADEMIC_PERIOD_TYPES[division.gradingPeriodType]
      ? division.gradingPeriodType
      : (legacyName.toLowerCase().includes('semester') ? 'semester' : getDefaultPeriodType(level));
    let periods = Array.isArray(division.academicPeriods) ? division.academicPeriods : [];

    if (!periods.length) {
      periods = createAcademicPeriods(gradingPeriodType).map(period => ({
        ...period,
        plannedStartDate: period.name === legacyName ? division.periodStartDate || null : null,
        plannedEndDate: period.name === legacyName ? division.periodEndDate || null : null
      }));
    }

    const canHaveActivePeriod = school.platformStatus === RECORD_VALUES.statuses.ACTIVE;
    const legacyActive = canHaveActivePeriod
      ? periods.find(period => period.name === legacyName)?.id || null
      : null;
    const normalized = createDivision(level, {
      ...division,
      gradingPeriodType,
      academicPeriods: periods,
      activeAcademicPeriodId: canHaveActivePeriod
        ? division.activeAcademicPeriodId || legacyActive
        : null
    });

    if (!canHaveActivePeriod) {
      normalized.academicPeriods.forEach(period => {
        period.status = ACADEMIC_PERIOD_STATUSES.UPCOMING;
        period.startedAt = null;
        period.closedAt = null;
      });
    }

    return normalized;
  }

  function normalizeSchoolRecord(school = {}) {
    const normalizedSchool = { ...school };
    delete normalizedSchool.schoolHeadName;
    const validStatuses = [
      RECORD_VALUES.statuses.ACTIVE,
      RECORD_VALUES.statuses.PENDING,
      RECORD_VALUES.statuses.REJECTED,
      RECORD_VALUES.statuses.SUSPENDED
    ];
    const administrator = school.initialAdministrator;
    const normalizedAdministrator = administrator ? { ...administrator } : null;
    if (normalizedAdministrator) {
      normalizedAdministrator.schoolEmail = normalizedAdministrator.schoolEmail || normalizedAdministrator.email
        ? String(normalizedAdministrator.schoolEmail || normalizedAdministrator.email).trim().toLowerCase()
        : null;
      delete normalizedAdministrator.email;
    }
    const platformStatus = validStatuses.includes(school.platformStatus)
      ? school.platformStatus
      : RECORD_VALUES.statuses.PENDING;
    const registrationPending = platformStatus === RECORD_VALUES.statuses.PENDING;

    const schoolLevels = Array.isArray(school.schoolLevels) && school.schoolLevels.length
      ? school.schoolLevels
      : (school.schoolType === 'k12' ? GRADE_CATALOG.map(level => level.key) : [school.schoolType || 'jhs']);
    const divisions = Object.fromEntries(schoolLevels.map(level => [
      level,
      normalizeDivisionRecord(level, school.divisions?.[level], school)
    ]));

    return {
      ...normalizedSchool,
      schoolYear: school.schoolYear || null,
      schoolYearStartDate: school.schoolYearStartDate || null,
      schoolYearEndDate: school.schoolYearEndDate || null,
      regionName: school.regionName ? String(school.regionName).trim() : null,
      divisionName: school.divisionName ? String(school.divisionName).trim() : null,
      districtName: school.districtName ? String(school.districtName).trim() : null,
      gradesPageEnabled: registrationPending ? false : school.gradesPageEnabled === true,
      narrativeReportsEnabled: registrationPending ? false : school.narrativeReportsEnabled === true,
      journalsEnabled: registrationPending ? false : school.journalsEnabled === true,
      journalSubjectId: school.journalSubjectId || null,
      schoolLevels,
      divisions,
      academicPeriodAudit: Array.isArray(school.academicPeriodAudit)
        ? school.academicPeriodAudit.map(entry => ({ ...entry }))
        : [],
      email: school.email ? String(school.email).trim().toLowerCase() : null,
      notificationEmail: school.notificationEmail
        ? String(school.notificationEmail).trim().toLowerCase()
        : null,
      platformStatus,
      submittedAt: school.submittedAt || null,
      approvedAt: school.approvedAt || null,
      rejectedAt: school.rejectedAt || null,
      rejectionReason: school.rejectionReason
        ? String(school.rejectionReason).trim()
        : null,
      initialAdministrator: normalizedAdministrator
    };
  }

  function getSchools() {
    const saved = readJson(STORAGE_KEYS.schools, null);
    const hasSavedSchools = Array.isArray(saved) && saved.length;
    const schools = hasSavedSchools ? saved : clone(DEFAULT_SCHOOLS);
    const normalizedSchools = schools.map(normalizeSchoolRecord);
    const savedSchoolSeedVersion = Number(readJson(STORAGE_KEYS.schoolSeedVersion, 0));

    if (hasSavedSchools && savedSchoolSeedVersion < 4) {
      const defaultSchoolsById = new Map(DEFAULT_SCHOOLS.map(school => [school.id, school]));
      normalizedSchools.forEach(school => {
        const defaultSchool = defaultSchoolsById.get(school.id);
        ['regionName', 'divisionName', 'districtName'].forEach(field => {
          if (!school[field] && defaultSchool?.[field]) {
            school[field] = defaultSchool[field];
          }
        });
        if (school.id === 'scc' && defaultSchool) {
          school.name = defaultSchool.name;
          school.shortName = defaultSchool.shortName;
          school.schoolId = defaultSchool.schoolId;
          school.regionName = defaultSchool.regionName;
          school.divisionName = defaultSchool.divisionName;
          school.districtName = defaultSchool.districtName;
          school.address = defaultSchool.address;
        }
      });
      writeJson(STORAGE_KEYS.schools, normalizedSchools);
      writeJson(STORAGE_KEYS.schoolSeedVersion, 4);
    }

    return normalizedSchools;
  }

  function saveSchools(schools) {
    const normalizedSchools = Array.isArray(schools)
      ? schools.map(normalizeSchoolRecord)
      : [];
    writeJson(STORAGE_KEYS.schools, normalizedSchools);
    return normalizedSchools;
  }

  // Replace this localStorage implementation with PATCH /api/schools/:id.
  function updateSchool(schoolId, updates = {}) {
    const schools = getSchools();
    const index = schools.findIndex(school => school.id === schoolId);
    if (index < 0) return null;

    schools[index] = { ...schools[index], ...updates };
    return saveSchools(schools)[index] || null;
  }

  function getActiveSchool() {
    const schools = getSchools();
    const activeId = localStorage.getItem(STORAGE_KEYS.activeSchool) || schools[0]?.id;
    return schools.find(school => school.id === activeId) || schools[0];
  }

  function getActiveSchoolId() {
    return getActiveSchool()?.id || null;
  }

  function getAcademicPeriods(schoolId = getActiveSchoolId(), schoolLevel) {
    const school = getSchools().find(record => record.id === schoolId);
    const level = schoolLevel || school?.activeDivision || school?.schoolLevels?.[0];
    return clone(school?.divisions?.[level]?.academicPeriods || []);
  }

  function getCurrentAcademicPeriod(schoolId = getActiveSchoolId(), schoolLevel) {
    const school = getSchools().find(record => record.id === schoolId);
    const level = schoolLevel || school?.activeDivision || school?.schoolLevels?.[0];
    const division = school?.divisions?.[level];
    return clone(division?.academicPeriods?.find(period => period.id === division.activeAcademicPeriodId) || null);
  }

  // Local fallback only. The API-backed settings page reads /api/academic-terms.
  async function getAcademicTermConfig(schoolId, schoolLevel) {
    const school = getSchools().find(record => record.id === schoolId);
    const division = school?.divisions?.[schoolLevel];
    if (!school || !division) return null;
    return clone({
      schoolId,
      schoolLevel,
      schoolYear: school.schoolYear,
      schoolYearStartDate: school.schoolYearStartDate,
      schoolYearEndDate: school.schoolYearEndDate,
      gradingPeriodType: division.gradingPeriodType,
      activeAcademicPeriodId: division.activeAcademicPeriodId,
      academicPeriods: division.academicPeriods
    });
  }

  function isValidDateValue(value) {
    const dateValue = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return false;
    const date = new Date(`${dateValue}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateValue;
  }

  function validateAcademicTermConfig(values = {}) {
    const errors = [];
    const definition = ACADEMIC_PERIOD_TYPES[values.gradingPeriodType];
    const periods = Array.isArray(values.academicPeriods) ? values.academicPeriods : [];
    const schoolYearStartDate = values.schoolYearStartDate || null;
    const schoolYearEndDate = values.schoolYearEndDate || null;

    const schoolYear = String(values.schoolYear || '').trim();
    const schoolYearMatch = schoolYear.match(/^(\d{4})-(\d{4})$/);
    if (!schoolYear) errors.push('Enter the school year.');
    else if (!schoolYearMatch || Number(schoolYearMatch[2]) !== Number(schoolYearMatch[1]) + 1) {
      errors.push('Use a consecutive school year such as 2026-2027.');
    }
    if (!schoolYearStartDate || !schoolYearEndDate) errors.push('Enter the school-year start and end dates.');
    else if (!isValidDateValue(schoolYearStartDate) || !isValidDateValue(schoolYearEndDate)) errors.push('Enter valid school-year dates.');
    else if (schoolYearEndDate <= schoolYearStartDate) errors.push('The school-year end date must be after its start date.');
    if (!definition) errors.push('Select a valid grading-period structure.');
    if (definition && periods.length !== definition.periodNames.length) {
      errors.push(`${definition.label} requires ${definition.periodNames.length} grading periods.`);
    }

    periods.forEach((period, index) => {
      const name = String(period.name || '').trim() || `Period ${index + 1}`;
      const start = period.plannedStartDate;
      const end = period.plannedEndDate;
      if (!start || !end) errors.push(`Enter both dates for ${name}.`);
      else if (!isValidDateValue(start) || !isValidDateValue(end)) errors.push(`Enter valid dates for ${name}.`);
      else {
        if (end <= start) errors.push(`${name} must end after it starts.`);
        if (schoolYearStartDate && start < schoolYearStartDate) errors.push(`${name} starts before the school year.`);
        if (schoolYearEndDate && end > schoolYearEndDate) errors.push(`${name} ends after the school year.`);
      }
      const previousEnd = periods[index - 1]?.plannedEndDate;
      if (isValidDateValue(start) && isValidDateValue(previousEnd) && start <= previousEnd) errors.push(`${name} overlaps the previous grading period.`);
    });

    return [...new Set(errors)];
  }

  // Local fallback only. API-backed settings save through /api/academic-terms.
  async function saveAcademicTermConfig(schoolId, values = {}) {
    const schools = getSchools();
    const schoolIndex = schools.findIndex(record => record.id === schoolId);
    if (schoolIndex < 0) throw new Error('School not found.');

    const school = schools[schoolIndex];
    const level = values.schoolLevel;
    const division = school.divisions?.[level];
    if (!division) throw new Error('School level not found.');

    const errors = validateAcademicTermConfig(values);
    if (errors.length) throw new Error(errors[0]);

    const divisionHasStarted = division.academicPeriods.some(period => period.status !== ACADEMIC_PERIOD_STATUSES.UPCOMING);
    const schoolYearHasStarted = Object.values(school.divisions || {}).some(item =>
      item.academicPeriods?.some(period => period.status !== ACADEMIC_PERIOD_STATUSES.UPCOMING)
    );
    if (schoolYearHasStarted && (
      String(values.schoolYear).trim() !== school.schoolYear
      || values.schoolYearStartDate !== school.schoolYearStartDate
      || values.schoolYearEndDate !== school.schoolYearEndDate
    )) {
      throw new Error('The school year cannot change after a grading period has started in any school level.');
    }
    if (divisionHasStarted && values.gradingPeriodType !== division.gradingPeriodType) {
      throw new Error('This school level\'s period structure cannot change after a grading period has started.');
    }

    const definition = getPeriodType(values.gradingPeriodType);
    const sameStructure = values.gradingPeriodType === division.gradingPeriodType;
    const idContext = `${schoolId}-${level}-${String(values.schoolYear).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const periods = definition.periodNames.map((defaultName, index) => {
      const submitted = values.academicPeriods[index] || {};
      const existing = sameStructure ? division.academicPeriods.find(period => period.sequence === index + 1) : null;
      const isLocked = existing && existing.status !== ACADEMIC_PERIOD_STATUSES.UPCOMING;
      return {
        id: existing?.id || `${idContext}-${definition.idPrefix}${index + 1}`,
        name: isLocked ? existing.name : String(submitted.name || defaultName).trim(),
        sequence: index + 1,
        status: existing?.status || ACADEMIC_PERIOD_STATUSES.UPCOMING,
        plannedStartDate: isLocked ? existing.plannedStartDate : submitted.plannedStartDate,
        plannedEndDate: isLocked ? existing.plannedEndDate : submitted.plannedEndDate,
        startedAt: existing?.startedAt || null,
        closedAt: existing?.closedAt || null
      };
    });

    school.schoolYear = String(values.schoolYear).trim();
    school.schoolYearStartDate = values.schoolYearStartDate;
    school.schoolYearEndDate = values.schoolYearEndDate;
    division.gradingPeriodType = values.gradingPeriodType;
    division.academicPeriods = periods;
    division.activeAcademicPeriodId = periods.find(period => period.status === ACADEMIC_PERIOD_STATUSES.ACTIVE)?.id || null;
    saveSchools(schools);
    return getAcademicTermConfig(schoolId, level);
  }

  function addAcademicPeriodAudit(school, schoolLevel, period, action, details = {}) {
    school.academicPeriodAudit ||= [];
    school.academicPeriodAudit.push({
      id: `academic-period-audit-${Date.now()}`,
      schoolId: school.id,
      schoolLevel,
      academicPeriodId: period.id,
      action,
      ...details,
      createdAt: new Date().toISOString()
    });
  }

  // Local fallback only. API-backed pages start terms through POST /api/academic-terms/:termId/activate.
  async function startAcademicPeriod(schoolId, schoolLevel, periodId) {
    const schools = getSchools();
    const school = schools.find(record => record.id === schoolId);
    const division = school?.divisions?.[schoolLevel];
    if (!school || !division) throw new Error('Academic-term configuration not found.');
    if (school.platformStatus !== RECORD_VALUES.statuses.ACTIVE) {
      throw new Error('The school registration must be approved before a grading period can start.');
    }
    if (division.activeAcademicPeriodId) throw new Error('Close the active grading period before starting another one.');

    const periods = division.academicPeriods;
    const period = periods.find(item => item.id === periodId);
    const firstUpcoming = periods.find(item => item.status === ACADEMIC_PERIOD_STATUSES.UPCOMING);
    if (!period || period.status !== ACADEMIC_PERIOD_STATUSES.UPCOMING) throw new Error('This grading period cannot be started.');
    if (firstUpcoming?.id !== period.id) throw new Error('Grading periods must be started in order.');
    if (!period.plannedStartDate || !period.plannedEndDate) throw new Error('Complete the grading-period schedule before starting it.');

    period.status = ACADEMIC_PERIOD_STATUSES.ACTIVE;
    period.startedAt = new Date().toISOString();
    division.activeAcademicPeriodId = period.id;
    addAcademicPeriodAudit(school, schoolLevel, period, 'started');
    saveSchools(schools);
    return getAcademicTermConfig(schoolId, schoolLevel);
  }

  // API-backed close validation is performed by POST /api/academic-terms/:termId/complete.
  async function getAcademicPeriodCloseReadiness(schoolId, schoolLevel, periodId) {
    const school = getSchools().find(record => record.id === schoolId);
    const division = school?.divisions?.[schoolLevel];
    const period = division?.academicPeriods?.find(item => item.id === periodId);
    if (!period) throw new Error('Academic period not found.');

    return {
      academicPeriodId: periodId,
      canClose: true,
      blockingIssues: [],
      warnings: []
    };
  }

  // Local fallback only. API-backed pages close terms through POST /api/academic-terms/:termId/complete.
  async function closeAcademicPeriod(schoolId, schoolLevel, periodId) {
    const readiness = await getAcademicPeriodCloseReadiness(schoolId, schoolLevel, periodId);
    if (!readiness.canClose) throw new Error(readiness.blockingIssues[0]);

    const schools = getSchools();
    const school = schools.find(record => record.id === schoolId);
    const division = school?.divisions?.[schoolLevel];
    const period = division?.academicPeriods?.find(item => item.id === periodId);
    if (!period || period.status !== ACADEMIC_PERIOD_STATUSES.ACTIVE) throw new Error('Only the active grading period can be closed.');

    period.status = ACADEMIC_PERIOD_STATUSES.CLOSED;
    period.closedAt = new Date().toISOString();
    division.activeAcademicPeriodId = null;
    addAcademicPeriodAudit(school, schoolLevel, period, 'closed');
    saveSchools(schools);
    return getAcademicTermConfig(schoolId, schoolLevel);
  }

  // Local fallback only. API-backed pages extend terms through POST /api/academic-terms/:termId/extend.
  async function extendAcademicPeriod(schoolId, schoolLevel, periodId, values = {}) {
    const schools = getSchools();
    const school = schools.find(record => record.id === schoolId);
    const division = school?.divisions?.[schoolLevel];
    const period = division?.academicPeriods?.find(item => item.id === periodId);
    if (!period || period.status !== ACADEMIC_PERIOD_STATUSES.ACTIVE) throw new Error('Only the active grading period can be extended.');

    const newEndDate = values.plannedEndDate;
    const reason = String(values.reason || '').trim();
    const nextPeriod = division.academicPeriods.find(item => item.sequence === period.sequence + 1);
    if (!isValidDateValue(newEndDate)) throw new Error('Choose a valid new end date.');
    if (newEndDate <= period.plannedEndDate) throw new Error('Choose an end date after the current end date.');
    if (school.schoolYearEndDate && newEndDate > school.schoolYearEndDate) throw new Error('The new end date must remain inside the school year.');
    if (nextPeriod?.plannedStartDate && newEndDate >= nextPeriod.plannedStartDate) throw new Error('The extension overlaps the next grading period. Adjust its dates first.');
    if (!reason) throw new Error('Enter a reason for the extension.');

    const previousEndDate = period.plannedEndDate;
    period.plannedEndDate = newEndDate;
    addAcademicPeriodAudit(school, schoolLevel, period, 'extended', { previousEndDate, newEndDate, reason });
    saveSchools(schools);
    return getAcademicTermConfig(schoolId, schoolLevel);
  }

  function getAcademicPeriodReminder(period, date = new Date()) {
    if (!period?.plannedEndDate || period.status !== ACADEMIC_PERIOD_STATUSES.ACTIVE) return null;
    const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(`${period.plannedEndDate}T00:00:00`);
    const daysRemaining = Math.ceil((end - today) / 86400000);
    if (daysRemaining < 0) return { tone: 'danger', label: 'Review overdue', daysRemaining };
    if (daysRemaining === 0) return { tone: 'warning', label: 'Ends today', daysRemaining };
    if (daysRemaining <= 7) return { tone: 'warning', label: `Ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`, daysRemaining };
    return null;
  }

  function scopeToActiveSchool(records, schoolId = getActiveSchoolId()) {
    return Array.isArray(records)
      ? records.filter(record => record.schoolId === schoolId)
      : [];
  }

  function withActiveSchool(records, ownerSchoolId = 'scc') {
    if (!Array.isArray(records)) return [];
    const ownedRecords = records.map(record => ({
      ...record,
      schoolId: record.schoolId || ownerSchoolId
    }));
    return scopeToActiveSchool(ownedRecords);
  }

  function schoolStorageKey(key, schoolId = getActiveSchoolId()) {
    return `${key}:${schoolId}`;
  }

  function isGradesPageEnabled(school = getActiveSchool()) {
    if (window.EDUGNAY_API_PORTAL_FEATURES && Object.hasOwn(window.EDUGNAY_API_PORTAL_FEATURES, 'gradesEnabled')) {
      return Boolean(window.EDUGNAY_API_PORTAL_FEATURES.gradesEnabled);
    }
    return Boolean(school?.gradesPageEnabled);
  }

  function isNarrativeReportsEnabled(school = getActiveSchool()) {
    if (window.EDUGNAY_API_PORTAL_FEATURES && Object.hasOwn(window.EDUGNAY_API_PORTAL_FEATURES, 'narrativeReportsEnabled')) {
      return Boolean(window.EDUGNAY_API_PORTAL_FEATURES.narrativeReportsEnabled);
    }
    return Boolean(school?.narrativeReportsEnabled);
  }

  function getSubjectAssignments() {
    return SUBJECT_ASSIGNMENTS;
  }

  function saveSubjectAssignments() {
    writeJson(STORAGE_KEYS.subjectAssignments, SUBJECT_ASSIGNMENTS);
  }

  function getConfiguredSubjects(school = getActiveSchool()) {
    return SUBJECT_CATALOG.filter(subject => getSubjectAssignments().some(record =>
      record.schoolId === school?.id &&
      record.subjectId === subject.id &&
      subject.levels?.includes(record.schoolLevel)
    ));
  }

  function getJournalSubject(school = getActiveSchool()) {
    if (window.EDUGNAY_API_PORTAL_FEATURES) {
      const features = window.EDUGNAY_API_PORTAL_FEATURES;
      return features.journalSubjectId && features.journalSubjectName
        ? { id: String(features.journalSubjectId), name: features.journalSubjectName } : null;
    }
    return getConfiguredSubjects(school).find(subject => subject.id === school?.journalSubjectId) || null;
  }

  function isJournalsEnabled(school = getActiveSchool()) {
    if (window.EDUGNAY_API?.isBackendAvailable) {
      return Boolean(window.EDUGNAY_API_PORTAL_FEATURES?.journalsEnabled && getJournalSubject(school));
    }
    return Boolean(school?.journalsEnabled && getJournalSubject(school));
  }

  function getAssignmentSections(school = getActiveSchool()) {
    return (school?.schoolLevels || []).flatMap(level =>
      (school.divisions?.[level]?.sections || []).map(section => ({
        ...section,
        schoolId: school.id,
        level
      }))
    );
  }

  function normalizeApiSection(record) {
    return {
      ...record,
      id: String(record.id),
      schoolId: Number(record.schoolId) === 1 ? 'scc' : String(record.schoolId || ''),
      level: record.schoolLevelCode,
      grade: record.gradeLevelName,
      academicYear: record.academicYearLabel || '',
      academicYearStatus: record.academicYearStatus || '',
      adviserId: record.adviserUserId ? String(record.adviserUserId) : null,
      adviserName: record.adviserName || '',
      strand: record.strandName || '',
      teacherAssignments: Array.isArray(record.teacherAssignments) ? record.teacherAssignments : [],
      subjectAssignments: Array.isArray(record.subjectAssignments)
        ? record.subjectAssignments.map(assignment => ({
          ...assignment,
          subjectId: String(assignment.subjectId)
        }))
        : []
    };
  }

  async function getApiSections(filters = {}) {
    const query = filters.scope ? `?scope=${encodeURIComponent(filters.scope)}` : '';
    const response = await requestApi(`/sections${query}`);
    return (response.sections || []).map(normalizeApiSection);
  }

  function normalizeApiSectionStudent(record) {
    return record ? {
      ...record,
      id: String(record.id),
      apiId: Number(record.id),
      displayName: record.displayName || `${record.firstName || ''} ${record.lastName || ''}`.trim(),
      initials: record.initials || '',
      schoolEmail: record.schoolEmail || '',
      lrn: record.lrn || null
    } : null;
  }

  function normalizeApiSectionTeacher(record) {
    return record ? {
      ...record,
      assignmentId: String(record.assignmentId),
      teacherId: String(record.teacherId),
      teacherName: record.teacherName || '',
      teacherEmail: record.teacherEmail || '',
      subjectId: String(record.subjectId),
      subjectCode: record.subjectCode || '',
      subjectName: record.subjectName || ''
    } : null;
  }

  function normalizeApiSubject(record) {
    return record ? {
      ...record,
      id: String(record.id),
      apiId: Number(record.id),
      schoolId: Number(record.schoolId) === 1 ? 'scc' : String(record.schoolId || ''),
      code: record.subjectCode || '',
      name: record.name || '',
      schoolLevelCode: record.schoolLevelCode || '',
      gradeCode: record.gradeCode || '',
      isActive: record.isActive !== false
    } : null;
  }

  async function getApiSectionStudents(sectionId) {
    const response = await requestApi(`/sections/${Number(sectionId)}/students`);
    return {
      section: normalizeApiSection(response?.section),
      students: (response?.students || []).map(normalizeApiSectionStudent).filter(Boolean)
    };
  }

  async function getApiSectionStudentDetails(sectionId, studentId) {
    const response = await requestApi(`/sections/${Number(sectionId)}/students/${Number(studentId)}`);
    return {
      student: response?.student || null,
      parents: Array.isArray(response?.parents) ? response.parents : []
    };
  }

  async function getApiSectionTeachers(sectionId) {
    const response = await requestApi(`/sections/${Number(sectionId)}/teachers`);
    return {
      section: normalizeApiSection(response?.section),
      teachers: (response?.teachers || []).map(normalizeApiSectionTeacher).filter(Boolean)
    };
  }

  async function getApiSubjects(filters = {}) {
    const params = new URLSearchParams();
    if (filters.schoolLevelId) params.set('schoolLevelId', String(filters.schoolLevelId));
    const query = params.toString();
    const response = await requestApi(`/subjects${query ? `?${query}` : ''}`);
    return (response?.subjects || []).map(normalizeApiSubject).filter(Boolean);
  }

  async function createApiSection(values = {}) {
    const response = await requestApi('/sections', { method: 'POST', body: JSON.stringify(values) });
    return normalizeApiSection(response?.section);
  }

  async function updateApiSection(sectionId, values = {}) {
    const response = await requestApi(`/sections/${Number(sectionId)}`, { method: 'PATCH', body: JSON.stringify(values) });
    return normalizeApiSection(response?.section);
  }

  async function deleteApiSection(sectionId) {
    const numericId = Number(sectionId);
    if (!Number.isSafeInteger(numericId) || numericId < 1) throw new Error('The section ID is invalid.');
    await requestApi(`/sections/${numericId}`, { method: 'DELETE' });
    return true;
  }

  async function createApiSubject(values = {}) {
    const response = await requestApi('/subjects', { method: 'POST', body: JSON.stringify(values) });
    return normalizeApiSubject(response?.subject);
  }

  async function updateApiSubject(subjectId, values = {}) {
    const response = await requestApi(`/subjects/${Number(subjectId)}`, { method: 'PATCH', body: JSON.stringify(values) });
    return normalizeApiSubject(response?.subject);
  }

  async function deleteApiSubject(subjectId) {
    const numericId = Number(subjectId);
    if (!Number.isSafeInteger(numericId) || numericId < 1) throw new Error('The subject ID is invalid.');
    const response = await requestApi(`/subjects/${numericId}`, { method: 'DELETE' });
    return { deleted: response?.deleted !== false };
  }

  async function enrollApiStudent(sectionId, studentId) {
    return requestApi(`/sections/${Number(sectionId)}/students`, {
      method: 'POST',
      body: JSON.stringify({ studentId: Number(studentId) })
    });
  }

  async function moveApiStudent(sectionId, studentId, targetSectionId) {
    return requestApi(`/sections/${Number(sectionId)}/students/${Number(studentId)}/move`, {
      method: 'POST',
      body: JSON.stringify({ targetSectionId: Number(targetSectionId) })
    });
  }

  async function withdrawApiStudent(sectionId, studentId) {
    await requestApi(`/sections/${Number(sectionId)}/students/${Number(studentId)}`, { method: 'DELETE' });
    return true;
  }

  async function assignApiTeacher(sectionId, teacherId, subjectId) {
    return requestApi(`/sections/${Number(sectionId)}/teachers`, {
      method: 'POST',
      body: JSON.stringify({ teacherId: Number(teacherId), subjectId: Number(subjectId) })
    });
  }

  async function removeApiTeacherAssignment(sectionId, assignmentId) {
    await requestApi(`/sections/${Number(sectionId)}/teachers/${Number(assignmentId)}`, { method: 'DELETE' });
    return true;
  }

  async function updateApiTeacherAssignment(sectionId, assignmentId, teacherId) {
    return requestApi(`/sections/${Number(sectionId)}/teachers/${Number(assignmentId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ teacherId: Number(teacherId) })
    });
  }

  // Local compatibility fallback for pages that have not migrated to the API yet.
  async function getSections() {
    return getAssignmentSections();
  }

  // Local compatibility fallback for pages that have not migrated to the API yet.
  async function updateSection(sectionId, values = {}) {
    const school = getActiveSchool();
    if (!school?.id || !sectionId) return null;

    const divisions = school.divisions || {};
    let sourceLevel = '';
    let sourceIndex = -1;
    Object.entries(divisions).some(([level, division]) => {
      const index = (division.sections || []).findIndex(section => section.id === String(sectionId));
      if (index < 0) return false;
      sourceLevel = level;
      sourceIndex = index;
      return true;
    });
    if (sourceIndex < 0) return null;

    const name = String(values.name || '').trim();
    const level = String(values.level || '').trim();
    const grade = String(values.grade || '').trim();
    const capacity = Number(values.capacity);
    if (!name || !level || !grade || !Number.isFinite(capacity) || capacity <= 0) return null;

    const sourceDivision = divisions[sourceLevel];
    const currentSection = sourceDivision.sections[sourceIndex];
    const targetDivision = divisions[level] || createDivision(level);
    targetDivision.sections = Array.isArray(targetDivision.sections) ? targetDivision.sections : [];
    const updatedSection = {
      ...currentSection,
      id: currentSection.id,
      schoolId: school.id,
      name,
      level,
      grade,
      strand: level === 'shs' ? String(values.strand || '').trim() || null : null,
      capacity,
      adviserId: values.adviserId ? String(values.adviserId).trim() || null : null
    };

    sourceDivision.sections.splice(sourceIndex, 1);
    if (sourceLevel === level) targetDivision.sections.splice(sourceIndex, 0, updatedSection);
    else targetDivision.sections.push(updatedSection);

    divisions[level] = targetDivision;
    school.schoolLevels = Array.isArray(school.schoolLevels) ? school.schoolLevels : [];
    if (!school.schoolLevels.includes(level)) school.schoolLevels.push(level);
    const savedSchool = updateSchool(school.id, {
      divisions,
      schoolLevels: school.schoolLevels,
      activeDivision: level
    });
    if (!savedSchool) return null;
    return getAssignmentSections(savedSchool).find(section => section.id === updatedSection.id) || null;
  }

  async function getMyTeachingSections() {
    if (EDUGNAY_API_BASE_URL) return getApiSections({ scope: 'teaching' });

    const teacherId = window.EDUGNAY_TEACHER_ACCESS?.teacherId;
    if (!teacherId) return [];

    const sectionIds = new Set(
      ASSIGNMENT_DIRECTORY
        .filter(record => record.schoolId === getActiveSchoolId() && record.teacherId === teacherId)
        .map(record => record.sectionId)
    );

    return getAssignmentSections().filter(section => {
      const isSubjectTeacher = (section.teacherAssignments || [])
        .some(record => record.teacherId === teacherId);
      return isSubjectTeacher || sectionIds.has(section.id);
    });
  }

  async function getMyAdvisorySections() {
    if (EDUGNAY_API_BASE_URL) {
      const session = await getCurrentUser();
      const teacherId = String(session?.apiUserId || '');
      return (await getApiSections()).filter(section =>
        section.adviserId === teacherId && section.status === 'active' && section.academicYearStatus === 'active'
      );
    }

    const teacherId = window.EDUGNAY_TEACHER_ACCESS?.teacherId;
    if (!teacherId) return [];
    return getAssignmentSections().filter(section => section.adviserId === teacherId && section.status !== 'archived');
  }

  async function getApiMaterials(filters = {}) {
    const params = new URLSearchParams();
    if (filters.sectionId) params.set('sectionId', filters.sectionId);
    if (filters.subjectId) params.set('subjectId', filters.subjectId);
    const response = await requestApi(`/materials${params.size ? `?${params}` : ''}`);
    return response.materials || [];
  }

  async function uploadApiMaterial(sectionId, subjectId, values) {
    const form = new FormData();
    form.set('file', values.file);
    form.set('title', values.title);
    form.set('status', values.status);
    const response = await requestApiMultipart(`/materials/sections/${encodeURIComponent(sectionId)}/subjects/${encodeURIComponent(subjectId)}`, form);
    return response.material;
  }

  async function updateApiMaterial(materialId, status) {
    const response = await requestApi(`/materials/${encodeURIComponent(materialId)}`, {
      method: 'PATCH', body: JSON.stringify({ status })
    });
    return response.material;
  }

  async function deleteApiMaterial(materialId) {
    return requestApi(`/materials/${encodeURIComponent(materialId)}`, { method: 'DELETE' });
  }

  function apiMaterialFileUrl(materialId) {
    return `${EDUGNAY_API_BASE_URL}/materials/${encodeURIComponent(materialId)}/file`;
  }

  // Replace this fixed list with GET /api/teacher/sf-templates.
  const OFFICIAL_SF_TEMPLATES = Object.freeze([
    {
      id: 'sf1-school-register-v1',
      formCode: 'SF1',
      formName: 'School Register',
      version: '1.0',
      schoolLevels: ['elementary', 'jhs', 'shs'],
      source: 'official',
      status: RECORD_VALUES.statuses.ACTIVE,
      mappingStatus: 'ready',
      fileName: 'SF1.xlsx',
      templateFileUrl: '../../assets/templates/school-forms/sf1.xlsx',
      sheetName: 'School Form 1 (SF1)',
      requiresAcademicPeriod: false,
      sheets: [{ name: 'School Form 1 (SF1)', hidden: false }],
      updatedAt: null,
      updatedBy: null
    },
    {
      id: 'sf2-daily-attendance-v1', formCode: 'SF2', formName: 'Daily Attendance Report of Learners',
      version: '1.0', schoolLevels: ['elementary', 'jhs', 'shs'], source: 'official',
      status: RECORD_VALUES.statuses.ACTIVE, mappingStatus: 'ready', fileName: 'SF2.xlsx',
      templateFileUrl: '../../assets/templates/school-forms/sf2.xlsx',
      sheetName: 'School Form 2 (SF2)', requiresAcademicPeriod: false,
      sheets: [{ name: 'School Form 2 (SF2)', hidden: false }], updatedAt: null, updatedBy: null
    }
  ]);

  async function getSfTemplates() {
    if (EDUGNAY_API_BASE_URL) {
      const response = await requestApi('/sf-templates');
      return (response.templates || []).map(record => ({
        id: record.formCode === 'SF1' ? 'sf1-school-register-v1'
          : record.formCode === 'SF2' ? 'sf2-daily-attendance-v1' : `sf-${record.id}`,
        apiId: String(record.id),
        formCode: record.formCode,
        formName: record.formName,
        version: record.version,
        schoolLevels: ['elementary', 'jhs', 'shs'],
        source: 'official',
        status: record.mappingStatus === 'ready' ? RECORD_VALUES.statuses.ACTIVE : 'draft',
        mappingStatus: record.mappingStatus,
        fileName: `${record.formCode}.xlsx`,
        templateFileUrl: `../../assets/templates/school-forms/${record.formCode.toLowerCase()}.xlsx`,
        sheetName: record.sheetName,
        requiresAcademicPeriod: Boolean(record.requiresAcademicTerm),
        sheets: [{ name: record.sheetName, hidden: false }],
        updatedAt: null,
        updatedBy: null
      }));
    }

    return OFFICIAL_SF_TEMPLATES
      .filter(record => record.source === 'official' && record.status === RECORD_VALUES.statuses.ACTIVE)
      .map(record => ({ ...record, schoolLevels: [...record.schoolLevels], sheets: record.sheets.map(sheet => ({ ...sheet })) }));
  }

  async function getSfTemplatePreview(templateId, sheetName = '') {
    const template = (await getSfTemplates()).find(record => record.id === String(templateId));
    if (!template) throw new Error('The selected template could not be found.');
    if (EDUGNAY_API_BASE_URL) await requestApi(`/sf-templates/${template.apiId}`);
    const preview = await window.EDUGNAY_SF_WORKBOOK.getFilePreview(
      template.templateFileUrl,
      sheetName || template.sheetName,
      template
    );
    return {
      template: { ...template },
      preview
    };
  }

  async function downloadSfTemplate(templateId) {
    const template = (await getSfTemplates()).find(record => record.id === String(templateId));
    if (!template || template.source !== 'official' || template.status !== RECORD_VALUES.statuses.ACTIVE) {
      throw new Error('The selected official template is unavailable.');
    }
    const buffer = await window.EDUGNAY_SF_WORKBOOK.getOfficialTemplateFile(template);
    return { buffer, fileName: `${template.formCode}-blank-template.xlsx` };
  }

  async function downloadBlankCombinedSfTemplates(templateIds) {
    const selectedIds = Array.isArray(templateIds) ? [...new Set(templateIds.map(String))] : [];
    const templates = (await getSfTemplates()).filter(template => selectedIds.includes(template.id));
    const formCodes = templates.map(template => template.formCode).sort().join(',');
    if (selectedIds.length !== 2 || templates.length !== 2 || formCodes !== 'SF1,SF2'
      || templates.some(template => template.source !== 'official'
        || template.status !== RECORD_VALUES.statuses.ACTIVE || template.mappingStatus !== 'ready')) {
      throw new Error('Select the active, verified SF1 and SF2 templates to download a blank combined workbook.');
    }

    const buffer = await window.EDUGNAY_SF_WORKBOOK.getOfficialCombinedTemplateFile(templates);
    return { buffer, fileName: 'SF1_SF2_blank.xlsx' };
  }

  function formatSfDateValue(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
    return match ? `${match[2]}/${match[3]}/${match[1]}` : '';
  }

  function formatSfPersonName(user, profile = {}, lastName = user?.lastName) {
    if (!user) return '';
    const middleName = profile.hasNoMiddleName ? '' : profile.middleName;
    return [lastName, user.firstName, middleName]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  function sfDataIssue(code, severity, field, message) {
    return {
      code,
      severity,
      sheetName: null,
      cellAddress: null,
      field,
      message
    };
  }

  function firstFridayOfJune(schoolYear) {
    const year = Number(String(schoolYear || '').slice(0, 4));
    if (!Number.isInteger(year)) return null;
    const date = new Date(Date.UTC(year, 5, 1));
    date.setUTCDate(1 + ((5 - date.getUTCDay() + 7) % 7));
    return date;
  }

  function ageOnDate(birthDate, referenceDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate || '').trim());
    if (!match || !referenceDate) return null;
    const birth = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    let age = referenceDate.getUTCFullYear() - birth.getUTCFullYear();
    const birthdayPassed = referenceDate.getUTCMonth() > birth.getUTCMonth()
      || (referenceDate.getUTCMonth() === birth.getUTCMonth() && referenceDate.getUTCDate() >= birth.getUTCDate());
    if (!birthdayPassed) age -= 1;
    return age >= 0 ? age : null;
  }

  function buildSf1Context(school, section, students, schoolYear) {
    const issues = [];
    const referenceDate = firstFridayOfJune(schoolYear);
    const links = getParentStudentLinks();
    const usedLrns = new Set();
    const learners = students
      .slice()
      .sort((left, right) => [left.lastName, left.firstName, left.id].join('|').localeCompare([right.lastName, right.firstName, right.id].join('|')))
      .map((student, index) => {
        const profile = getUserProfile(student.id) || {};
        const studentName = formatSfPersonName(student, profile);
        const studentLinks = links.filter(link => link.studentId === student.id);
        const findParent = relationship => {
          const matches = studentLinks
            .filter(link => link.relationship === relationship)
            .map(link => getUserById(link.parentId))
            .filter(Boolean);
          if (matches.length > 1) {
            issues.push(sfDataIssue(
              'duplicate_parent_relationship',
              'warning',
              `${student.id}.${relationship}`,
              `${studentName || 'This learner'} has more than one linked ${relationship}; review the SF1 value.`
            ));
            return null;
          }
          return matches[0] || null;
        };

        const mother = findParent('mother');
        const father = findParent('father');
        const guardian = findParent('guardian');
        const motherProfile = mother ? getUserProfile(mother.id) || {} : {};
        const fatherProfile = father ? getUserProfile(father.id) || {} : {};
        const guardianProfile = guardian ? getUserProfile(guardian.id) || {} : {};
        const contactSource = [
          [guardian, guardianProfile],
          [mother, motherProfile],
          [father, fatherProfile]
        ].find(([parent, parentProfile]) => parent && parentProfile.contactNumber);
        const lrn = String(student.lrn || '').trim();
        const learner = {
          rowNumber: index + 1,
          lrn,
          name: studentName,
          sex: profile.sex ? String(profile.sex).slice(0, 1).toUpperCase() : '',
          birthDate: formatSfDateValue(profile.birthDate),
          age: ageOnDate(profile.birthDate, referenceDate),
          birthPlaceProvince: [profile.birthPlace || profile.birthPlaceProvince, profile.birthPlaceRegion, profile.birthCountry].filter(Boolean).join(', '),
          motherTongue: profile.motherTongue || '',
          indigenousGroup: profile.indigenousGroup || '',
          religion: profile.religion || '',
          houseStreet: profile.houseStreet || '',
          barangay: profile.barangay || '',
          cityMunicipality: profile.cityMunicipality || '',
          province: profile.province || '',
          fatherName: formatSfPersonName(father, fatherProfile),
          motherMaidenName: mother
            ? formatSfPersonName(mother, motherProfile, motherProfile.hasNoMaidenName ? mother.lastName : (motherProfile.maidenLastName || mother.lastName))
            : '',
          guardianName: formatSfPersonName(guardian, guardianProfile),
          guardianRelationship: guardian ? 'Guardian' : '',
          contactNumber: contactSource?.[1]?.contactNumber || '',
          remarks: ''
        };

        if (!lrn) issues.push(sfDataIssue('missing_lrn', 'warning', `${student.id}.lrn`, `${studentName || 'A learner'} has no LRN.`));
        else if (!LRN_PATTERN.test(lrn)) issues.push(sfDataIssue('invalid_lrn', 'error', `${student.id}.lrn`, `${studentName || 'A learner'} has an invalid LRN.`));
        else if (usedLrns.has(lrn)) issues.push(sfDataIssue('duplicate_lrn', 'error', `${student.id}.lrn`, `LRN ${lrn} appears more than once in this section.`));
        else usedLrns.add(lrn);

        [
          ['sex', 'sex'],
          ['birthDate', 'birth date'],
          ['birthPlaceProvince', 'birthplace'],
          ['motherTongue', 'mother tongue'],
          ['religion', 'religion']
        ].forEach(([field, label]) => {
          if (!learner[field]) issues.push(sfDataIssue('missing_learner_field', 'warning', `${student.id}.${field}`, `${studentName || 'A learner'} is missing ${label}.`));
        });
        if (!learner.contactNumber) issues.push(sfDataIssue('missing_parent_contact', 'warning', `${student.id}.contactNumber`, `${studentName || 'A learner'} has no parent or guardian contact number.`));
        if (student.status !== RECORD_VALUES.statuses.ACTIVE) issues.push(sfDataIssue('inactive_learner', 'warning', `${student.id}.status`, `${studentName || 'A learner'} is marked inactive; review the remarks column.`));
        return learner;
      });

    const regionName = String(school.regionName || '').trim();
    const header = {
      schoolId: school.schoolId || '',
      region: regionName ? (/^region\b/i.test(regionName) ? regionName : `Region ${regionName}`) : '',
      division: school.divisionName || '',
      district: school.districtName || '',
      schoolName: school.name || '',
      schoolYear,
      gradeLevel: section.grade || '',
      section: section.name || ''
    };
    [
      ['schoolId', 'school ID'],
      ['region', 'region'],
      ['division', 'division'],
      ['district', 'district'],
      ['schoolName', 'school name'],
      ['schoolYear', 'school year'],
      ['gradeLevel', 'grade level'],
      ['section', 'section']
    ].forEach(([field, label]) => {
      if (!header[field]) issues.push(sfDataIssue('missing_header_field', 'warning', `header.${field}`, `The ${label} is not configured.`));
    });

    return { header, learners, issues };
  }

  async function generateSfForm(values = {}) {
    const template = (await getSfTemplates()).find(record => record.id === String(values.templateId));
    if (!template || template.status !== RECORD_VALUES.statuses.ACTIVE || template.mappingStatus !== 'ready') {
      throw new Error('Select an active template with a verified mapping.');
    }

    const section = (await getMyAdvisorySections()).find(record => record.id === String(values.sectionId));
    if (!section) throw new Error('You do not have access to the selected class.');

    const schoolYear = String(values.schoolYear || '').trim();
    if (!schoolYear) throw new Error('Select a school year.');

    if (EDUGNAY_API_BASE_URL) {
      const monthQuery = template.formCode === 'SF2' ? `&month=${encodeURIComponent(values.month || '')}` : '';
      const response = await requestApi(`/sf-templates/${template.apiId}/preview?sectionId=${encodeURIComponent(section.id)}${monthQuery}`);
      const generated = await window.EDUGNAY_SF_WORKBOOK.generatePreviewFromMappedCells(
        template,
        response.mappedCells || [],
        []
      );
      return {
        templateId: template.id,
        apiTemplateId: template.apiId,
        sectionId: section.id,
        month: template.formCode === 'SF2' ? values.month : null,
        pages: response.pages || [response.mappedCells || []],
        schoolYear,
        fileName: `${template.formCode}_${section.grade}-${section.name}_${template.formCode === 'SF2' ? `${values.month}_` : ''}${schoolYear}.xlsx`
          .replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-'),
        issues: response.issues || [],
        previewFingerprint: response.previewFingerprint,
        hasBlockingIssues: (response.issues || []).some(issue => issue.severity === 'error'),
        exportId: null,
        ...generated
      };
    }

    if (template.formCode === 'SF2') throw new Error('SF2 generation requires the live school database. The demo has no verified attendance roster.');
    const school = getActiveSchool();
    const teacher = getUserById(window.EDUGNAY_TEACHER_ACCESS?.teacherId);
    if (!school || !teacher) throw new Error('The school or teacher account could not be found.');
    const students = getStudents().filter(student => student.schoolId === school.id && student.sectionId === section.id);
    if (students.length > 49) throw new Error('This section has more than the 49 learner rows available in SF1.');
    const context = buildSf1Context(school, section, students, schoolYear);
    const blockingIssue = context.issues.find(record => record.severity === 'error');
    if (blockingIssue) throw new Error(blockingIssue.message);

    const generated = await window.EDUGNAY_SF_WORKBOOK.generatePreview(template, context);
    const fileName = `${template.formCode}_${section.grade}-${section.name}_${schoolYear}.xlsx`
      .replace(/[<>:"/\\|?*]+/g, '-')
      .replace(/\s+/g, '-');
    return {
      templateId: template.id,
      sectionId: section.id,
      schoolYear,
      fileName,
      issues: context.issues,
      ...generated
    };
  }

  async function generateCombinedSfForms(values = {}) {
    if (!EDUGNAY_API_BASE_URL) throw new Error('Combined SF1 and SF2 generation requires the live school database.');
    const templateIds = [...new Set((Array.isArray(values.templateIds) ? values.templateIds : []).map(String))];
    const templates = (await getSfTemplates()).filter(template => templateIds.includes(template.id));
    if (templates.length !== 2 || templates.some(template => template.status !== RECORD_VALUES.statuses.ACTIVE
      || template.mappingStatus !== 'ready') || templates.map(template => template.formCode).sort().join(',') !== 'SF1,SF2') {
      throw new Error('Select the active, verified SF1 and SF2 templates to create one combined workbook.');
    }

    const section = (await getMyAdvisorySections()).find(record => record.id === String(values.sectionId));
    if (!section) throw new Error('You do not have access to the selected class.');
    const schoolYear = String(values.schoolYear || section.academicYear || '').trim();
    if (!schoolYear) throw new Error('Select a school year.');
    const preview = await requestApi('/sf-templates/combined/preview', {
      method: 'POST',
      body: JSON.stringify({
        templateIds: templates.map(template => Number(template.apiId)),
        sectionId: Number(section.id),
        month: values.month || ''
      })
    });
    const forms = await Promise.all((preview.forms || []).map(async form => {
      const template = templates.find(record => record.apiId === String(form.templateId));
      if (!template) throw new Error('The generated preview did not match the selected SF templates.');
      const previewTemplate = {
        ...template,
        templateFileUrl: '../../assets/templates/school-forms/sf1-sf2.xlsx'
      };
      const generated = await window.EDUGNAY_SF_WORKBOOK.generatePreviewFromMappedCells(
        previewTemplate,
        form.mappedCells || [],
        []
      );
      return {
        templateId: template.id,
        apiTemplateId: template.apiId,
        formCode: template.formCode,
        sectionId: section.id,
        month: template.formCode === 'SF2' ? values.month : null,
        schoolYear,
        pages: form.pages?.length ? form.pages : [form.mappedCells || []],
        issues: form.issues || [],
        hasBlockingIssues: (form.issues || []).some(issue => issue.severity === 'error'),
        selectedPage: 0,
        exportId: null,
        ...generated
      };
    }));
    forms.sort((left, right) => left.formCode.localeCompare(right.formCode));
    return {
      templateIds: templates.map(template => template.id),
      sectionId: section.id,
      month: values.month || null,
      schoolYear,
      previewFingerprint: preview.previewFingerprint,
      fileName: `SF1_SF2_${section.grade}-${section.name}_${values.month || schoolYear}.xlsx`
        .replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-'),
      hasBlockingIssues: forms.some(form => form.hasBlockingIssues),
      forms
    };
  }

  async function exportCombinedSfForms(values = {}) {
    if (!EDUGNAY_API_BASE_URL) throw new Error('Combined SF1 and SF2 downloads require the live school database.');
    const templates = await getSfTemplates();
    const apiTemplateIds = (values.templateIds || []).map(id => {
      const template = templates.find(record => record.id === String(id));
      if (!template?.apiId) throw new Error('A selected SF template is no longer available. Generate a new preview.');
      return Number(template.apiId);
    });
    const response = await requestApiFile('/sf-templates/combined/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateIds: apiTemplateIds,
        sectionId: Number(values.sectionId),
        month: values.month || '',
        previewFingerprint: values.previewFingerprint,
        forms: (values.forms || []).map(form => ({
          templateId: Number(form.apiTemplateId),
          edits: Array.isArray(form.edits) ? form.edits : []
        }))
      })
    });
    return { buffer: response.buffer, fileName: response.fileName || values.fileName };
  }

  async function exportSfForm(values = {}) {
    const template = (await getSfTemplates()).find(record => record.id === String(values.templateId));
    if (!template || template.status !== RECORD_VALUES.statuses.ACTIVE || template.mappingStatus !== 'ready') {
      throw new Error('The selected SF template is not available for download.');
    }
    const section = (await getMyAdvisorySections()).find(record => record.id === String(values.sectionId));
    if (!section) throw new Error('You do not have access to the selected class.');
    if (EDUGNAY_API_BASE_URL) {
      let exportId = values.exportId;
      if (!exportId) {
        const response = await requestApi(`/sf-templates/${template.apiId}/generate`, {
          method: 'POST',
          body: JSON.stringify({
            sectionId: Number(section.id),
            month: template.formCode === 'SF2' ? values.month : undefined,
            previewFingerprint: values.previewFingerprint,
            edits: Array.isArray(values.edits) ? values.edits : []
          })
        });
        exportId = response.export.id;
      }
      let file;
      try {
        file = await requestApiFile(`/sf-exports/${encodeURIComponent(exportId)}/download`);
      } catch (error) {
        error.exportId = exportId;
        throw error;
      }
      return { buffer: file.buffer, fileName: file.fileName || String(values.fileName || template.fileName), exportId };
    }

    const buffer = await window.EDUGNAY_SF_WORKBOOK.exportWorkbook(
      template,
      Array.isArray(values.mappedCells) ? values.mappedCells : [],
      Array.isArray(values.edits) ? values.edits : []
    );
    return {
      buffer,
      fileName: String(values.fileName || template.fileName)
    };
  }

  function assignmentWithLabels(record, studentId = null) {
    const subject = SUBJECT_CATALOG.find(item => item.id === record.subjectId);
    const teacher = getUserById(record.teacherId);
    const statusRecord = studentId == null
      ? null
      : ASSIGNMENT_STATUS_RECORDS.find(item =>
        item.assignmentId === record.id && item.studentId === String(studentId)
      );
    return {
      ...record,
      subject: subject?.name || '',
      subjectName: subject?.name || '',
      teacher: teacher?.displayName || '',
      status: statusRecord?.status || 'pending'
    };
  }

  function getAssignments() {
    return ASSIGNMENT_DIRECTORY;
  }

  function getAssignmentsForSection(sectionId) {
    return ASSIGNMENT_DIRECTORY
      .filter(record => record.schoolId === getActiveSchoolId() && record.sectionId === String(sectionId))
      .map(record => assignmentWithLabels(record));
  }

  function getAssignmentsForStudent(studentId) {
    const student = getUserById(studentId);
    if (!student || student.role !== RECORD_VALUES.roles.STUDENT) return [];
    return ASSIGNMENT_DIRECTORY
      .filter(record => record.schoolId === getActiveSchoolId() && record.sectionId === student.sectionId)
      .map(record => assignmentWithLabels(record, student.id));
  }

  function saveAssignments(records = ASSIGNMENT_DIRECTORY) {
    const values = Array.isArray(records) ? records : [];
    writeJson(schoolStorageKey(STORAGE_KEYS.assignments), values);
  }

  function createAssignment(values = {}) {
    const categoryId = String(values.categoryId || '').trim().toLowerCase() || null;
    const maxScore = Number(values.maxScore);
    const assignment = {
      id: String(values.id || `assignment-${Date.now()}`),
      schoolId: values.schoolId || getActiveSchoolId(),
      sectionId: values.sectionId || null,
      subjectId: values.subjectId || null,
      teacherId: values.teacherId || null,
      academicPeriodId: values.academicPeriodId || null,
      title: String(values.title || '').trim(),
      instructions: String(values.instructions || '').trim() || null,
      assignedDate: values.assignedDate || values.dueDate || null,
      dueDate: values.dueDate || null,
      onlineSubmissionEnabled: values.onlineSubmissionEnabled === true,
      categoryId: categoryId && maxScore > 0 ? categoryId : null,
      maxScore: categoryId && maxScore > 0 ? maxScore : null
    };
    ASSIGNMENT_DIRECTORY.push(assignment);
    saveAssignments();
    return assignment;
  }

  function updateAssignment(assignmentId, values = {}) {
    const assignment = ASSIGNMENT_DIRECTORY.find(record =>
      record.id === String(assignmentId) && record.schoolId === getActiveSchoolId()
    );
    if (!assignment) return null;

    let nextCategoryId = assignment.categoryId;
    let nextMaxScore = assignment.maxScore;
    if (values.categoryId !== undefined || values.maxScore !== undefined) {
      const categoryValue = values.categoryId !== undefined ? values.categoryId : assignment.categoryId;
      const maxScoreValue = values.maxScore !== undefined ? values.maxScore : assignment.maxScore;
      const categoryId = String(categoryValue || '').trim().toLowerCase() || null;
      const maxScore = Number(maxScoreValue);
      const gradingRemoved = !categoryId || !(maxScore > 0);

      nextCategoryId = gradingRemoved ? null : categoryId;
      nextMaxScore = gradingRemoved ? null : maxScore;
    }

    if (values.title !== undefined) {
      assignment.title = String(values.title || '').trim();
    }

    if (values.instructions !== undefined) {
      assignment.instructions = String(values.instructions || '').trim() || null;
    }

    if (values.dueDate !== undefined) {
      assignment.dueDate = values.dueDate ? String(values.dueDate) : null;
    }

    if (values.onlineSubmissionEnabled !== undefined) {
      assignment.onlineSubmissionEnabled = values.onlineSubmissionEnabled === true;
    }

    if (values.academicPeriodId !== undefined) {
      assignment.academicPeriodId = values.academicPeriodId || null;
    }

    if (values.categoryId !== undefined || values.maxScore !== undefined) {
      assignment.categoryId = nextCategoryId;
      assignment.maxScore = nextMaxScore;
    }

    saveAssignments();
    return assignment;
  }

  function getAssignmentStatuses(assignmentId = null) {
    return ASSIGNMENT_STATUS_RECORDS.filter(record =>
      record.schoolId === getActiveSchoolId() &&
      (!assignmentId || record.assignmentId === String(assignmentId))
    );
  }

  function saveAssignmentStatuses() {
    writeJson(schoolStorageKey(STORAGE_KEYS.assignmentStatuses), ASSIGNMENT_STATUS_RECORDS);
  }

  function setAssignmentStatus(assignmentId, studentId, status) {
    const validStatuses = ['pending', 'submitted', 'not_submitted'];
    const schoolId = getActiveSchoolId();
    const assignment = ASSIGNMENT_DIRECTORY.find(record =>
      record.id === String(assignmentId) && record.schoolId === schoolId
    );
    const student = getUserById(studentId);
    if (!assignment || !student || student.schoolId !== schoolId || !validStatuses.includes(status)) return null;

    let record = ASSIGNMENT_STATUS_RECORDS.find(item =>
      item.assignmentId === String(assignmentId) && item.studentId === String(studentId)
    );
    if (record) {
      record.status = status;
      record.updatedAt = new Date().toISOString();
    } else {
      record = {
        id: `assignment-status-${assignmentId}-${studentId}`,
        schoolId,
        assignmentId: String(assignmentId),
        studentId: String(studentId),
        status,
        updatedAt: new Date().toISOString()
      };
      ASSIGNMENT_STATUS_RECORDS.push(record);
    }
    saveAssignmentStatuses();
    return record;
  }

  function learningMaterialWithLabels(record) {
    const subject = SUBJECT_CATALOG.find(item => item.id === record.subjectId);
    const teacher = getUserById(record.teacherId);
    return {
      ...record,
      subjectName: subject?.name || '',
      teacherName: teacher?.displayName || ''
    };
  }

  function getLearningMaterials(filters = {}) {
    if (EDUGNAY_API_BASE_URL) return [];
    return LEARNING_MATERIAL_DIRECTORY
      .filter(record => record.schoolId === getActiveSchoolId())
      .filter(record => !filters.sectionId || record.sectionId === String(filters.sectionId))
      .filter(record => !filters.subjectId || record.subjectId === String(filters.subjectId))
      .filter(record => !filters.teacherId || record.teacherId === String(filters.teacherId))
      .filter(record => !filters.status || record.status === String(filters.status))
      .filter(record => filters.visibleToStudents === undefined || record.visibleToStudents === Boolean(filters.visibleToStudents))
      .map(learningMaterialWithLabels);
  }

  function getLearningMaterialsForSection(sectionId, subjectId = null) {
    return getLearningMaterials({ sectionId, ...(subjectId ? { subjectId } : {}) });
  }

  function getLearningMaterialsForStudent(studentId, subjectId = null) {
    const student = getUserById(studentId);
    if (!student || student.role !== RECORD_VALUES.roles.STUDENT || !student.sectionId) return [];
    return getLearningMaterials({
      sectionId: student.sectionId,
      ...(subjectId ? { subjectId } : {}),
      status: 'published',
      visibleToStudents: true
    });
  }

  function saveLearningMaterials(records = LEARNING_MATERIAL_DIRECTORY) {
    if (EDUGNAY_API_BASE_URL) throw new Error('Learning materials must be saved through the API.');
    writeJson(schoolStorageKey(STORAGE_KEYS.materials), Array.isArray(records) ? records : []);
  }

  function createLearningMaterial(values = {}) {
    if (EDUGNAY_API_BASE_URL) throw new Error('Learning materials must be uploaded through the API.');
    const material = {
      id: String(values.id || `material-${Date.now()}`),
      schoolId: values.schoolId || getActiveSchoolId(),
      sectionId: values.sectionId ? String(values.sectionId) : null,
      subjectId: values.subjectId ? String(values.subjectId) : null,
      teacherId: values.teacherId ? String(values.teacherId) : null,
      title: String(values.title || '').trim(),
      type: String(values.type || 'file'),
      schoolYear: values.schoolYear || '2025-2026',
      academicPeriodId: values.academicPeriodId || null,
      postedAt: values.postedAt || null,
      fileSize: values.fileSize || null,
      fileUrl: values.fileUrl || null,
      status: values.status || 'draft',
      visibleToStudents: values.visibleToStudents === true,
      views: Number(values.views) || 0
    };
    LEARNING_MATERIAL_DIRECTORY.push(material);
    saveLearningMaterials();
    return material;
  }

  const ANNOUNCEMENT_AUDIENCE_META = {
    all: { label: 'All Users', className: 'aud-all', icon: 'users' },
    teachers: { label: 'Teachers', className: 'aud-teacher', icon: 'book-open' },
    students: { label: 'Students', className: 'aud-student', icon: 'graduation-cap' },
    parents: { label: 'Parents', className: 'aud-parent', icon: 'heart-handshake' }
  };

  function formatAnnouncementTime(createdAt) {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
      date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function announcementView(record) {
    const audienceKeys = Array.isArray(record.audience) ? record.audience : ['all'];
    const primaryAudience = audienceKeys.includes('all') ? 'all' : audienceKeys[0];
    const audienceMeta = ANNOUNCEMENT_AUDIENCE_META[primaryAudience] || ANNOUNCEMENT_AUDIENCE_META.all;
    return {
      ...record,
      audienceKeys,
      audienceKey: audienceKeys.join('-'),
      audience: audienceKeys.map(key => ANNOUNCEMENT_AUDIENCE_META[key]?.label || key).join(' & '),
      audienceClass: audienceMeta.className,
      audienceIcon: audienceMeta.icon,
      author: record.authorName || record.author || '',
      time: record.time || formatAnnouncementTime(record.createdAt),
      tagClass: record.tagClass || (record.priority === 'high' ? 'badge-red' : record.priority === 'event' ? 'badge-gold' : 'badge-blue'),
      status: record.status === 'draft' ? 'Draft' : 'Active',
      draft: record.status === 'draft',
      seen: record.seenCount ? `Seen by ${record.seenCount} users` : (record.status === 'draft' ? 'Not yet published' : 'Not yet viewed')
    };
  }

  function getAnnouncements(audience) {
    const key = String(audience || '').toLowerCase();
    const schoolId = getActiveSchoolId();
    const records = ANNOUNCEMENT_DIRECTORY
      .filter(record => record.schoolId === schoolId && record.status !== 'draft');
    const noClassDay = getNoClassDay();

    if (noClassDay) {
      records.push({
        id: `calendar-${noClassDay.id}`,
        schoolId,
        title: noClassDay.title || 'No classes today',
        body: noClassDay.detail || 'Classes are suspended today.',
        priority: 'event',
        audience: ['all'],
        authorId: null,
        authorName: 'School calendar',
        createdAt: new Date(`${noClassDay.date}T00:00:00`).toISOString(),
        status: 'published',
        pinned: false,
        icon: 'calendar-off',
        iconClass: 'icon-event',
        tag: 'Calendar',
        read: false,
        seenCount: 0,
        imageUrl: null,
        access: null
      });
    }

    return records
      .filter(record => !key || (Array.isArray(record.audience) && (record.audience.includes('all') || record.audience.includes(key))))
      .map(announcementView);
  }

  function getAllAnnouncements() {
    return ANNOUNCEMENT_DIRECTORY
      .filter(record => record.schoolId === getActiveSchoolId())
      .map(announcementView);
  }

  function saveAnnouncements(records = ANNOUNCEMENT_DIRECTORY) {
    const values = Array.isArray(records) ? records : [];
    writeJson(schoolStorageKey(STORAGE_KEYS.announcements), values);
  }

  function createAnnouncement(values = {}) {
    const audiences = Array.isArray(values.audience)
      ? values.audience
      : [values.audience || 'all'];
    const announcement = {
      id: String(values.id || `announcement-${Date.now()}`),
      schoolId: values.schoolId || getActiveSchoolId(),
      title: String(values.title || '').trim(),
      body: String(values.body || values.content || '').trim(),
      priority: values.priority || 'normal',
      audience: audiences,
      authorId: values.authorId || null,
      authorName: values.authorName || '',
      createdAt: values.createdAt || new Date().toISOString(),
      status: values.status || 'published',
      pinned: Boolean(values.pinned),
      icon: values.icon || 'megaphone',
      iconClass: values.iconClass || 'icon-normal',
      tag: values.tag || 'Normal',
      read: false,
      seenCount: 0,
      imageUrl: values.imageUrl || null,
      access: values.access || null
    };
    ANNOUNCEMENT_DIRECTORY.push(announcement);
    saveAnnouncements();
    return announcement;
  }

  function updateAnnouncement(announcementId, values = {}) {
    const announcement = ANNOUNCEMENT_DIRECTORY.find(record => record.id === String(announcementId));
    if (!announcement) return null;
    Object.assign(announcement, values);
    saveAnnouncements();
    return announcement;
  }

  function deleteAnnouncement(announcementId) {
    const index = ANNOUNCEMENT_DIRECTORY.findIndex(record => record.id === String(announcementId));
    if (index < 0) return null;
    const [announcement] = ANNOUNCEMENT_DIRECTORY.splice(index, 1);
    saveAnnouncements();
    return announcement;
  }

  // One direct user source for every school administrator, teacher, student, and parent.
  // Replace this local array with the users API response during backend integration.
  const DEFAULT_USERS = [
    { id: "admin-1", schoolId: "scc", role: "school_admin", schoolEmail: "admin.adm@stcolumban.edu.ph", status: "active", createdAt: "2025-01-06T00:00:00.000Z", honorific: null, firstName: "Sr.", lastName: "Admin", displayName: "Sr. Admin", initials: "SA", employeeNo: "ADM-2016-0001", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-2", schoolId: "scc", role: "teacher", schoolEmail: "m.reyes.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Ms.", firstName: "Maria", lastName: "Reyes", displayName: "Ms. Maria Reyes", initials: "MR", employeeNo: "FAC-2019-0042", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-3", schoolId: "scc", role: "teacher", schoolEmail: "p.tan.fac@stcolumban.edu.ph", status: "active", createdAt: "2025-05-20T00:00:00.000Z", honorific: "Mr.", firstName: "Paolo", lastName: "Tan", displayName: "Mr. Paolo Tan", initials: "PT", employeeNo: "FAC-2021-0017", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-carla-dizon", schoolId: "scc", role: "teacher", schoolEmail: "c.dizon.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Ms.", firstName: "Carla", lastName: "Dizon", displayName: "Ms. Carla Dizon", initials: "CD", employeeNo: "FAC-2020-0028", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-rico-santos", schoolId: "scc", role: "teacher", schoolEmail: "r.santos.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Mr.", firstName: "Rico", lastName: "Santos", displayName: "Mr. Rico Santos", initials: "RS", employeeNo: "FAC-2019-0064", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-jana-mendez", schoolId: "scc", role: "teacher", schoolEmail: "j.mendez.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Ms.", firstName: "Jana", lastName: "Mendez", displayName: "Ms. Jana Mendez", initials: "JM", employeeNo: "FAC-2022-0013", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-ana-garcia", schoolId: "scc", role: "teacher", schoolEmail: "a.garcia.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Ms.", firstName: "Ana", lastName: "Garcia", displayName: "Ms. Ana Garcia", initials: "AG", employeeNo: "FAC-2021-0049", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "parent-7", schoolId: "scc", role: "parent", schoolEmail: "r.lim.parents@stcolumban.edu.ph", status: "active", createdAt: "2024-06-05T00:00:00.000Z", honorific: null, firstName: "Rosa", lastName: "Lim", displayName: "Rosa Lim", initials: "RL", employeeNo: null, lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "parent-8", schoolId: "scc", role: "parent", schoolEmail: "e.cruz.parents@stcolumban.edu.ph", status: "inactive", createdAt: "2025-05-24T00:00:00.000Z", honorific: null, firstName: "Elena", lastName: "Cruz", displayName: "Elena Cruz", initials: "EC", employeeNo: null, lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "parent-sf1-cm-001", schoolId: "scc", role: "parent", schoolEmail: "m.mendoza.parents@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Maria", lastName: "Mendoza", displayName: "Maria Mendoza", initials: "MM", employeeNo: null, lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "parent-sf1-lr-002", schoolId: "scc", role: "parent", schoolEmail: "p.reyes.parents@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Pedro", lastName: "Reyes", displayName: "Pedro Reyes", initials: "PR", employeeNo: null, lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "parent-sf1-sc-013", schoolId: "scc", role: "parent", schoolEmail: "a.cruz.parents@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ana", lastName: "Cruz", displayName: "Ana Cruz", initials: "AC", employeeNo: null, lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "parent-sf1-gb-014", schoolId: "scc", role: "parent", schoolEmail: "r.bautista.parents@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Roberto", lastName: "Bautista", displayName: "Roberto Bautista", initials: "RB", employeeNo: null, lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "parent-sf1-na-015", schoolId: "scc", role: "parent", schoolEmail: "e.aquino.parents@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Elena", lastName: "Aquino", displayName: "Elena Aquino", initials: "EA", employeeNo: null, lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-9", schoolId: "scc", role: "teacher", schoolEmail: "l.villanueva.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Ms.", firstName: "Lara", lastName: "Villanueva", displayName: "Ms. Lara Villanueva", initials: "LV", employeeNo: "FAC-2018-0031", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "cm-001", schoolId: "scc", role: "student", schoolEmail: "c.mendoza.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Carlo", lastName: "Mendoza", displayName: "Carlo Mendoza", initials: "CM", employeeNo: null, lrn: "100201000003", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "lr-002", schoolId: "scc", role: "student", schoolEmail: "l.reyes.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Liza", lastName: "Reyes", displayName: "Liza Reyes", initials: "LR", employeeNo: null, lrn: "100201000004", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "rc-003", schoolId: "scc", role: "student", schoolEmail: "r.cruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Rico", lastName: "Cruz", displayName: "Rico Cruz", initials: "RC", employeeNo: null, lrn: "100201000005", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "jd-004", schoolId: "scc", role: "student", schoolEmail: "j.delacruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: null, firstName: "Juan", lastName: "Dela Cruz", displayName: "Juan Dela Cruz", initials: "JC", employeeNo: null, lrn: "100201000001", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "et-005", schoolId: "scc", role: "student", schoolEmail: "e.tan.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ella", lastName: "Tan", displayName: "Ella Tan", initials: "ET", employeeNo: null, lrn: "100201000006", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "ml-006", schoolId: "scc", role: "student", schoolEmail: "m.lopez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Maria", lastName: "Lopez", displayName: "Maria Lopez", initials: "ML", employeeNo: null, lrn: "100201000007", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "bg-007", schoolId: "scc", role: "student", schoolEmail: "b.garcia.stud@stcolumban.edu.ph", status: "inactive", createdAt: "2024-06-03T00:00:00.000Z", honorific: null, firstName: "Ben", lastName: "Garcia", displayName: "Ben Garcia", initials: "BG", employeeNo: null, lrn: "100201000008", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "as-008", schoolId: "scc", role: "student", schoolEmail: "a.santos.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-05-26T00:00:00.000Z", honorific: null, firstName: "Ana", lastName: "Santos", displayName: "Ana Santos", initials: "AS", employeeNo: null, lrn: "100201000009", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "ks-009", schoolId: "scc", role: "student", schoolEmail: "k.santiago.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Karl", lastName: "Santiago", displayName: "Karl Santiago", initials: "KS", employeeNo: null, lrn: "100201000010", schoolLevel: "jhs", gradeLevel: null, strand: null, sectionId: null },
    { id: "pn-010", schoolId: "scc", role: "student", schoolEmail: "p.nieves.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Paula", lastName: "Nieves", displayName: "Paula Nieves", initials: "PN", employeeNo: null, lrn: "100201000011", schoolLevel: "jhs", gradeLevel: null, strand: null, sectionId: null },
    { id: "do-011", schoolId: "scc", role: "student", schoolEmail: "d.ocampo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Dan", lastName: "Ocampo", displayName: "Dan Ocampo", initials: "DO", employeeNo: null, lrn: "100201000012", schoolLevel: "jhs", gradeLevel: null, strand: null, sectionId: null },
    { id: "mt-012", schoolId: "scc", role: "student", schoolEmail: "m.torres.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Maya", lastName: "Torres", displayName: "Maya Torres", initials: "MT", employeeNo: null, lrn: "100201000002", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "sc-013", schoolId: "scc", role: "student", schoolEmail: "s.cruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Sofia", lastName: "Cruz", displayName: "Sofia Cruz", initials: "SC", employeeNo: null, lrn: "100201000013", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "gb-014", schoolId: "scc", role: "student", schoolEmail: "g.bautista.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Gabriel", lastName: "Bautista", displayName: "Gabriel Bautista", initials: "GB", employeeNo: null, lrn: "100201000014", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "na-015", schoolId: "scc", role: "student", schoolEmail: "n.aquino.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Nicole", lastName: "Aquino", displayName: "Nicole Aquino", initials: "NA", employeeNo: null, lrn: "100201000015", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "pr-016", schoolId: "scc", role: "student", schoolEmail: "p.rivera.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Paolo", lastName: "Rivera", displayName: "Paolo Rivera", initials: "PR", employeeNo: null, lrn: "100201000016", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "av-017", schoolId: "scc", role: "student", schoolEmail: "a.villanueva.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Aira", lastName: "Villanueva", displayName: "Aira Villanueva", initials: "AV", employeeNo: null, lrn: "100201000017", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "ld-018", schoolId: "scc", role: "student", schoolEmail: "l.dizon.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Lucas", lastName: "Dizon", displayName: "Lucas Dizon", initials: "LD", employeeNo: null, lrn: "100201000018", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "br-019", schoolId: "scc", role: "student", schoolEmail: "b.ramos.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Beatrice", lastName: "Ramos", displayName: "Beatrice Ramos", initials: "BR", employeeNo: null, lrn: "100201000019", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "mg-020", schoolId: "scc", role: "student", schoolEmail: "m.garcia.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Miguel", lastName: "Garcia", displayName: "Miguel Garcia", initials: "MG", employeeNo: null, lrn: "100201000020", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "ac-021", schoolId: "scc", role: "student", schoolEmail: "a.castillo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Andrea", lastName: "Castillo", displayName: "Andrea Castillo", initials: "AC", employeeNo: null, lrn: "100201000021", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "eb-022", schoolId: "scc", role: "student", schoolEmail: "e.bernardo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ethan", lastName: "Bernardo", displayName: "Ethan Bernardo", initials: "EB", employeeNo: null, lrn: "100201000022", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "ch-023", schoolId: "scc", role: "student", schoolEmail: "c.hernandez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Chloe", lastName: "Hernandez", displayName: "Chloe Hernandez", initials: "CH", employeeNo: null, lrn: "100201000023", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "nr-024", schoolId: "scc", role: "student", schoolEmail: "n.reyes.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Nathan", lastName: "Reyes", displayName: "Nathan Reyes", initials: "NR", employeeNo: null, lrn: "100201000024", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "is-025", schoolId: "scc", role: "student", schoolEmail: "i.santos.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Isabella", lastName: "Santos", displayName: "Isabella Santos", initials: "IS", employeeNo: null, lrn: "100201000025", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "lm-026", schoolId: "scc", role: "student", schoolEmail: "l.mercado.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Liam", lastName: "Mercado", displayName: "Liam Mercado", initials: "LM", employeeNo: null, lrn: "100201000026", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "gr-027", schoolId: "scc", role: "student", schoolEmail: "g.rivera.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Grace", lastName: "Rivera", displayName: "Grace Rivera", initials: "GR", employeeNo: null, lrn: "100201000027", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "ds-028", schoolId: "scc", role: "student", schoolEmail: "d.salazar.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Daniel", lastName: "Salazar", displayName: "Daniel Salazar", initials: "DS", employeeNo: null, lrn: "100201000028", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "cb-029", schoolId: "scc", role: "student", schoolEmail: "c.bautista.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Camille", lastName: "Bautista", displayName: "Camille Bautista", initials: "CB", employeeNo: null, lrn: "100201000029", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "jr-030", schoolId: "scc", role: "student", schoolEmail: "j.ramos2.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Joshua", lastName: "Ramos", displayName: "Joshua Ramos", initials: "JR", employeeNo: null, lrn: "100201000030", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "rr-031", schoolId: "scc", role: "student", schoolEmail: "r.robles.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Reina", lastName: "Robles", displayName: "Reina Robles", initials: "RR", employeeNo: null, lrn: "100201000031", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "mp-032", schoolId: "scc", role: "student", schoolEmail: "m.perez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Marcus", lastName: "Perez", displayName: "Marcus Perez", initials: "MP", employeeNo: null, lrn: "100201000032", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "al-033", schoolId: "scc", role: "student", schoolEmail: "a.lim.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Alyssa", lastName: "Lim", displayName: "Alyssa Lim", initials: "AL", employeeNo: null, lrn: "100201000033", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "ad-034", schoolId: "scc", role: "student", schoolEmail: "a.domingo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Adrian", lastName: "Domingo", displayName: "Adrian Domingo", initials: "AD", employeeNo: null, lrn: "100201000034", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "td-035", schoolId: "scc", role: "student", schoolEmail: "t.david.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Trisha", lastName: "David", displayName: "Trisha David", initials: "TD", employeeNo: null, lrn: "100201000035", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "vp-036", schoolId: "scc", role: "student", schoolEmail: "v.padilla.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Vincent", lastName: "Padilla", displayName: "Vincent Padilla", initials: "VP", employeeNo: null, lrn: "100201000036", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "hc-037", schoolId: "scc", role: "student", schoolEmail: "h.cruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Helena", lastName: "Cruz", displayName: "Helena Cruz", initials: "HC", employeeNo: null, lrn: "100201000037", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "sa-038", schoolId: "scc", role: "student", schoolEmail: "s.aquino.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Samuel", lastName: "Aquino", displayName: "Samuel Aquino", initials: "SA", employeeNo: null, lrn: "100201000038", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "pm-039", schoolId: "scc", role: "student", schoolEmail: "p.mendoza.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Patricia", lastName: "Mendoza", displayName: "Patricia Mendoza", initials: "PM", employeeNo: null, lrn: "100201000039", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "ov-040", schoolId: "scc", role: "student", schoolEmail: "o.valdez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Oliver", lastName: "Valdez", displayName: "Oliver Valdez", initials: "OV", employeeNo: null, lrn: "100201000040", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "bb-041", schoolId: "scc", role: "student", schoolEmail: "b.bautista.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Bianca", lastName: "Bautista", displayName: "Bianca Bautista", initials: "BB", employeeNo: null, lrn: "100201000041", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "mm-042", schoolId: "scc", role: "student", schoolEmail: "m.morales.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Matteo", lastName: "Morales", displayName: "Matteo Morales", initials: "MM", employeeNo: null, lrn: "100201000042", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "cc-043", schoolId: "scc", role: "student", schoolEmail: "c.castillo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Clarisse", lastName: "Castillo", displayName: "Clarisse Castillo", initials: "CC", employeeNo: null, lrn: "100201000043", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "em-044", schoolId: "scc", role: "student", schoolEmail: "e.manalo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Elijah", lastName: "Manalo", displayName: "Elijah Manalo", initials: "EM", employeeNo: null, lrn: "100201000044", schoolLevel: "elementary", gradeLevel: "Grade 4", strand: null, sectionId: "elem-grade4-luke" },
    { id: "rs-045", schoolId: "scc", role: "student", schoolEmail: "r.soriano.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Rina", lastName: "Soriano", displayName: "Rina Soriano", initials: "RS", employeeNo: null, lrn: "100201000045", schoolLevel: "elementary", gradeLevel: "Grade 4", strand: null, sectionId: "elem-grade4-luke" },
    { id: "ja-046", schoolId: "scc", role: "student", schoolEmail: "j.aquino.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Janelle", lastName: "Aquino", displayName: "Janelle Aquino", initials: "JA", employeeNo: null, lrn: "100201000046", schoolLevel: "elementary", gradeLevel: "Grade 5", strand: null, sectionId: "elem-grade5-mark" },
    { id: "cp-047", schoolId: "scc", role: "student", schoolEmail: "c.pascual.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Caleb", lastName: "Pascual", displayName: "Caleb Pascual", initials: "CP", employeeNo: null, lrn: "100201000047", schoolLevel: "elementary", gradeLevel: "Grade 5", strand: null, sectionId: "elem-grade5-mark" },
    { id: "ls-048", schoolId: "scc", role: "student", schoolEmail: "l.santiago.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Lara", lastName: "Santiago", displayName: "Lara Santiago", initials: "LS", employeeNo: null, lrn: "100201000048", schoolLevel: "shs", gradeLevel: "Grade 11", strand: "STEM", sectionId: "shs-grade11-stem-a" },
    { id: "km-049", schoolId: "scc", role: "student", schoolEmail: "k.mendoza.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Kyle", lastName: "Mendoza", displayName: "Kyle Mendoza", initials: "KM", employeeNo: null, lrn: "100201000049", schoolLevel: "shs", gradeLevel: "Grade 11", strand: "STEM", sectionId: "shs-grade11-stem-a" },
    { id: "hc-050", schoolId: "scc", role: "student", schoolEmail: "h.cabrera.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Hannah", lastName: "Cabrera", displayName: "Hannah Cabrera", initials: "HC", employeeNo: null, lrn: "100201000050", schoolLevel: "shs", gradeLevel: "Grade 11", strand: "HUMSS", sectionId: "shs-grade11-humss-a" },
    { id: "dv-051", schoolId: "scc", role: "student", schoolEmail: "d.villarama.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Diego", lastName: "Villarama", displayName: "Diego Villarama", initials: "DV", employeeNo: null, lrn: "100201000051", schoolLevel: "shs", gradeLevel: "Grade 11", strand: "HUMSS", sectionId: "shs-grade11-humss-a" },
    { id: "ab-052", schoolId: "scc", role: "student", schoolEmail: "a.bautista2.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Amara", lastName: "Bautista", displayName: "Amara Bautista", initials: "AB", employeeNo: null, lrn: "100201000052", schoolLevel: "shs", gradeLevel: "Grade 12", strand: "ABM", sectionId: "shs-grade12-abm-a" },
    { id: "rg-053", schoolId: "scc", role: "student", schoolEmail: "r.garcia.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Rafael", lastName: "Garcia", displayName: "Rafael Garcia", initials: "RG", employeeNo: null, lrn: "100201000053", schoolLevel: "shs", gradeLevel: "Grade 12", strand: "ABM", sectionId: "shs-grade12-abm-a" },
    { id: "tm-054", schoolId: "scc", role: "student", schoolEmail: "t.mercado.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Talia", lastName: "Mercado", displayName: "Talia Mercado", initials: "TM", employeeNo: null, lrn: "100201000054", schoolLevel: "shs", gradeLevel: "Grade 12", strand: "TVL", sectionId: "shs-grade12-tvl-a" },
    { id: "jn-055", schoolId: "scc", role: "student", schoolEmail: "j.navarro.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Jonas", lastName: "Navarro", displayName: "Jonas Navarro", initials: "JN", employeeNo: null, lrn: "100201000055", schoolLevel: "shs", gradeLevel: "Grade 12", strand: "TVL", sectionId: "shs-grade12-tvl-a" },
    { id: "ar-056", schoolId: "scc", role: "student", schoolEmail: "a.ramos.kinder@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Arielle", lastName: "Ramos", displayName: "Arielle Ramos", initials: "AR", employeeNo: null, lrn: "100201000056", schoolLevel: "elementary", gradeLevel: "Kindergarten", strand: null, sectionId: null },
    { id: "dm-057", schoolId: "scc", role: "student", schoolEmail: "d.morales.kinder@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Daniel", lastName: "Morales", displayName: "Daniel Morales", initials: "DM", employeeNo: null, lrn: "100201000057", schoolLevel: "elementary", gradeLevel: "Kindergarten", strand: null, sectionId: null },
    { id: "cv-058", schoolId: "scc", role: "student", schoolEmail: "c.villanueva.g1@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Chloe", lastName: "Villanueva", displayName: "Chloe Villanueva", initials: "CV", employeeNo: null, lrn: "100201000058", schoolLevel: "elementary", gradeLevel: "Grade 1", strand: null, sectionId: null },
    { id: "er-059", schoolId: "scc", role: "student", schoolEmail: "e.reyes.g1@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ethan", lastName: "Reyes", displayName: "Ethan Reyes", initials: "ER", employeeNo: null, lrn: "100201000059", schoolLevel: "elementary", gradeLevel: "Grade 1", strand: null, sectionId: null },
    { id: "bs-060", schoolId: "scc", role: "student", schoolEmail: "b.santos.g2@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Bea", lastName: "Santos", displayName: "Bea Santos", initials: "BS", employeeNo: null, lrn: "100201000060", schoolLevel: "elementary", gradeLevel: "Grade 2", strand: null, sectionId: null },
    { id: "lc-061", schoolId: "scc", role: "student", schoolEmail: "l.cruz.g2@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Lorenzo", lastName: "Cruz", displayName: "Lorenzo Cruz", initials: "LC", employeeNo: null, lrn: "100201000061", schoolLevel: "elementary", gradeLevel: "Grade 2", strand: null, sectionId: null },
    { id: "fg-062", schoolId: "scc", role: "student", schoolEmail: "f.garcia.g3@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Faith", lastName: "Garcia", displayName: "Faith Garcia", initials: "FG", employeeNo: null, lrn: "100201000062", schoolLevel: "elementary", gradeLevel: "Grade 3", strand: null, sectionId: null },
    { id: "nb-063", schoolId: "scc", role: "student", schoolEmail: "n.bautista.g3@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Noah", lastName: "Bautista", displayName: "Noah Bautista", initials: "NB", employeeNo: null, lrn: "100201000063", schoolLevel: "elementary", gradeLevel: "Grade 3", strand: null, sectionId: null },
    { id: "im-064", schoolId: "scc", role: "student", schoolEmail: "i.mercado.g6@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ivy", lastName: "Mercado", displayName: "Ivy Mercado", initials: "IM", employeeNo: null, lrn: "100201000064", schoolLevel: "elementary", gradeLevel: "Grade 6", strand: null, sectionId: null },
    { id: "mf-065", schoolId: "scc", role: "student", schoolEmail: "m.flores.g6@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Mateo", lastName: "Flores", displayName: "Mateo Flores", initials: "MF", employeeNo: null, lrn: "100201000065", schoolLevel: "elementary", gradeLevel: "Grade 6", strand: null, sectionId: null },
  // Stable demo tokens allow the same seeded student QR to work across browsers.
  // The backend will replace these with server-managed opaque tokens.
  ].map(user => ({
    ...user,
    attendanceQrToken: user.role === 'student'
      ? `edugnay-demo-${user.schoolId}-${user.id}-v1`
      : null
  }));

  // Frontend-only profile seed data. Replace this with profile API responses later.
  const DEFAULT_USER_PROFILES = [
    ...DEFAULT_USERS
      .filter(user => user.schoolId === 'scc' && user.role === RECORD_VALUES.roles.STUDENT)
      .map((user, index) => {
        const gradeNumber = Number(String(user.gradeLevel || '').replace('Grade ', '')) || 0;
        const birthYear = gradeNumber ? 2020 - gradeNumber : 2019;
        const birthMonth = String((index % 12) + 1).padStart(2, '0');
        const birthDay = String((index % 24) + 1).padStart(2, '0');
        return {
          userId: user.id,
          schoolId: user.schoolId,
          middleName: index % 2 ? 'Jose' : 'Marie',
          hasNoMiddleName: false,
          contactNumber: null,
          sex: index % 2 ? 'male' : 'female',
          birthDate: `${birthYear}-${birthMonth}-${birthDay}`,
          birthPlaceProvince: 'Pangasinan',
          motherTongue: 'Pangasinense',
          indigenousGroup: 'Not applicable',
          religion: 'Catholic',
          houseStreet: `${index + 1} Rizal Street`,
          barangay: index % 2 ? 'San Isidro' : 'Poblacion',
          cityMunicipality: 'Dagupan City',
          province: 'Pangasinan',
          maidenLastName: null,
          hasNoMaidenName: false,
          profileCompletedAt: '2025-06-10T00:00:00.000Z',
          updatedAt: '2025-06-10T00:00:00.000Z'
        };
      }),
    {
      userId: 'parent-7',
      schoolId: 'scc',
      middleName: 'Santos',
      hasNoMiddleName: false,
      contactNumber: '09171234567',
      sex: 'female',
      birthDate: null,
      birthPlaceProvince: null,
      motherTongue: null,
      indigenousGroup: null,
      religion: 'Catholic',
      houseStreet: '12 Rizal Street',
      barangay: 'Poblacion',
      cityMunicipality: 'Dagupan City',
      province: 'Pangasinan',
      maidenLastName: 'Santos',
      hasNoMaidenName: false,
      profileCompletedAt: '2025-06-10T00:00:00.000Z',
      updatedAt: '2025-06-10T00:00:00.000Z'
    },
    {
      userId: 'parent-8',
      schoolId: 'scc',
      middleName: 'Garcia',
      hasNoMiddleName: false,
      contactNumber: '09181234567',
      sex: 'female',
      birthDate: null,
      birthPlaceProvince: null,
      motherTongue: null,
      indigenousGroup: null,
      religion: 'Catholic',
      houseStreet: '24 Bonifacio Street',
      barangay: 'San Isidro',
      cityMunicipality: 'Dagupan City',
      province: 'Pangasinan',
      maidenLastName: 'Garcia',
      hasNoMaidenName: false,
      profileCompletedAt: '2025-06-10T00:00:00.000Z',
      updatedAt: '2025-06-10T00:00:00.000Z'
    },
    {
      userId: 'parent-sf1-cm-001',
      schoolId: 'scc',
      middleName: 'Santos',
      hasNoMiddleName: false,
      contactNumber: '09191234567',
      sex: 'female',
      birthDate: null,
      birthPlaceProvince: null,
      motherTongue: null,
      indigenousGroup: null,
      religion: 'Catholic',
      houseStreet: '31 Rizal Street',
      barangay: 'Poblacion',
      cityMunicipality: 'Dagupan City',
      province: 'Pangasinan',
      maidenLastName: 'Mendoza',
      hasNoMaidenName: false,
      profileCompletedAt: '2025-06-10T00:00:00.000Z',
      updatedAt: '2025-06-10T00:00:00.000Z'
    },
    {
      userId: 'parent-sf1-lr-002',
      schoolId: 'scc',
      middleName: 'Garcia',
      hasNoMiddleName: false,
      contactNumber: '09201234567',
      sex: 'male',
      birthDate: null,
      birthPlaceProvince: null,
      motherTongue: null,
      indigenousGroup: null,
      religion: 'Catholic',
      houseStreet: '42 Rizal Street',
      barangay: 'San Isidro',
      cityMunicipality: 'Dagupan City',
      province: 'Pangasinan',
      maidenLastName: null,
      hasNoMaidenName: true,
      profileCompletedAt: '2025-06-10T00:00:00.000Z',
      updatedAt: '2025-06-10T00:00:00.000Z'
    },
    {
      userId: 'parent-sf1-sc-013',
      schoolId: 'scc',
      middleName: 'Santos',
      hasNoMiddleName: false,
      contactNumber: '09211234567',
      sex: 'female',
      birthDate: null,
      birthPlaceProvince: null,
      motherTongue: null,
      indigenousGroup: null,
      religion: 'Catholic',
      houseStreet: '53 Rizal Street',
      barangay: 'Poblacion',
      cityMunicipality: 'Dagupan City',
      province: 'Pangasinan',
      maidenLastName: 'Cruz',
      hasNoMaidenName: false,
      profileCompletedAt: '2025-06-10T00:00:00.000Z',
      updatedAt: '2025-06-10T00:00:00.000Z'
    },
    {
      userId: 'parent-sf1-gb-014',
      schoolId: 'scc',
      middleName: 'Dela Cruz',
      hasNoMiddleName: false,
      contactNumber: '09221234567',
      sex: 'male',
      birthDate: null,
      birthPlaceProvince: null,
      motherTongue: null,
      indigenousGroup: null,
      religion: 'Catholic',
      houseStreet: '64 Rizal Street',
      barangay: 'San Isidro',
      cityMunicipality: 'Dagupan City',
      province: 'Pangasinan',
      maidenLastName: null,
      hasNoMaidenName: true,
      profileCompletedAt: '2025-06-10T00:00:00.000Z',
      updatedAt: '2025-06-10T00:00:00.000Z'
    },
    {
      userId: 'parent-sf1-na-015',
      schoolId: 'scc',
      middleName: 'Reyes',
      hasNoMiddleName: false,
      contactNumber: '09231234567',
      sex: 'female',
      birthDate: null,
      birthPlaceProvince: null,
      motherTongue: null,
      indigenousGroup: null,
      religion: 'Catholic',
      houseStreet: '75 Rizal Street',
      barangay: 'Poblacion',
      cityMunicipality: 'Dagupan City',
      province: 'Pangasinan',
      maidenLastName: 'Aquino',
      hasNoMaidenName: false,
      profileCompletedAt: '2025-06-10T00:00:00.000Z',
      updatedAt: '2025-06-10T00:00:00.000Z'
    }
  ];

  const ACTIVE_SCHOOL_ID = getActiveSchoolId();

  // One record per school, subject, and grade. This is the source used by
  // Class Management to decide where a subject is available.
  const DEFAULT_SUBJECT_ASSIGNMENTS = [
    { id: 'scc-elementary-filipino-kindergarten', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-filipino-grade1', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-filipino-grade2', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-filipino-grade3', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-filipino-grade4', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-filipino-grade5', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-filipino-grade6', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-english-kindergarten', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-english-grade1', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-english-grade2', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-english-grade3', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-english-grade4', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-english-grade5', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-english-grade6', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-mathematics-kindergarten', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-mathematics-grade1', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-mathematics-grade2', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-mathematics-grade3', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-mathematics-grade4', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-mathematics-grade5', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-mathematics-grade6', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-science-kindergarten', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-science-grade1', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-science-grade2', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-science-grade3', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-science-grade4', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-science-grade5', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-science-grade6', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-values-education-kindergarten', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-values-education-grade1', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-values-education-grade2', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-values-education-grade3', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-values-education-grade4', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-values-education-grade5', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-values-education-grade6', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-araling-panlipunan-kindergarten', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade1', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade2', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade3', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade4', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade5', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade6', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-mapeh-kindergarten', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-mapeh-grade1', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-mapeh-grade2', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-mapeh-grade3', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-mapeh-grade4', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-mapeh-grade5', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-mapeh-grade6', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-esp-kindergarten', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-esp-grade1', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-esp-grade2', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-esp-grade3', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-esp-grade4', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-esp-grade5', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-esp-grade6', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-jhs-mathematics-grade7', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-mathematics-grade8', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-mathematics-grade9', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-mathematics-grade10', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-science-grade7', schoolId: 'scc', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-science-grade8', schoolId: 'scc', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-science-grade9', schoolId: 'scc', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-science-grade10', schoolId: 'scc', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-values-education-grade7', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-values-education-grade8', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-values-education-grade9', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-values-education-grade10', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-araling-panlipunan-grade7', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-araling-panlipunan-grade8', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-araling-panlipunan-grade9', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-araling-panlipunan-grade10', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-mapeh-grade7', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-mapeh-grade8', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-mapeh-grade9', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-mapeh-grade10', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-tle-grade7', schoolId: 'scc', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-tle-grade8', schoolId: 'scc', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-tle-grade9', schoolId: 'scc', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-tle-grade10', schoolId: 'scc', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-esp-grade7', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-esp-grade8', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-esp-grade9', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-esp-grade10', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-shs-mathematics-grade11-stem', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-mathematics-grade11-humss', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-mathematics-grade11-abm', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-mathematics-grade11-gas', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-mathematics-grade11-tvl', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-mathematics-grade12-stem', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-mathematics-grade12-humss', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-mathematics-grade12-abm', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-mathematics-grade12-gas', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-mathematics-grade12-tvl', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'scc-shs-science-grade11-stem', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-science-grade11-humss', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-science-grade11-abm', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-science-grade11-gas', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-science-grade11-tvl', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-science-grade12-stem', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-science-grade12-humss', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-science-grade12-abm', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-science-grade12-gas', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-science-grade12-tvl', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'scc-shs-values-education-grade11-stem', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-values-education-grade11-humss', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-values-education-grade11-abm', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-values-education-grade11-gas', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-values-education-grade11-tvl', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-values-education-grade12-stem', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-values-education-grade12-humss', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-values-education-grade12-abm', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-values-education-grade12-gas', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-values-education-grade12-tvl', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'scc-shs-pe-health-grade11-stem', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-pe-health-grade11-humss', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-pe-health-grade11-abm', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-pe-health-grade11-gas', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-pe-health-grade11-tvl', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-pe-health-grade12-stem', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-pe-health-grade12-humss', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-pe-health-grade12-abm', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-pe-health-grade12-gas', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-pe-health-grade12-tvl', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'scc-shs-empowerment-technologies-grade11-stem', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-empowerment-technologies-grade11-humss', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-empowerment-technologies-grade11-abm', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-empowerment-technologies-grade11-gas', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-empowerment-technologies-grade11-tvl', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-empowerment-technologies-grade12-stem', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-empowerment-technologies-grade12-humss', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-empowerment-technologies-grade12-abm', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-empowerment-technologies-grade12-gas', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-empowerment-technologies-grade12-tvl', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'scc-shs-practical-research-grade11-stem', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-practical-research-grade11-humss', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-practical-research-grade11-abm', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-practical-research-grade11-gas', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-practical-research-grade11-tvl', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-practical-research-grade12-stem', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-practical-research-grade12-humss', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-practical-research-grade12-abm', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-practical-research-grade12-gas', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-practical-research-grade12-tvl', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-jhs-mathematics-grade7', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-mathematics-grade8', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-mathematics-grade9', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-mathematics-grade10', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-science-grade7', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-science-grade8', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-science-grade9', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-science-grade10', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-values-education-grade7', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-values-education-grade8', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-values-education-grade9', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-values-education-grade10', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-araling-panlipunan-grade7', schoolId: 'manghi', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-araling-panlipunan-grade8', schoolId: 'manghi', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-araling-panlipunan-grade9', schoolId: 'manghi', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-araling-panlipunan-grade10', schoolId: 'manghi', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-mapeh-grade7', schoolId: 'manghi', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-mapeh-grade8', schoolId: 'manghi', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-mapeh-grade9', schoolId: 'manghi', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-mapeh-grade10', schoolId: 'manghi', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-tle-grade7', schoolId: 'manghi', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-tle-grade8', schoolId: 'manghi', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-tle-grade9', schoolId: 'manghi', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-tle-grade10', schoolId: 'manghi', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-esp-grade7', schoolId: 'manghi', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-esp-grade8', schoolId: 'manghi', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-esp-grade9', schoolId: 'manghi', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-esp-grade10', schoolId: 'manghi', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-shs-mathematics-grade11-stem', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-mathematics-grade11-humss', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-mathematics-grade11-abm', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-mathematics-grade11-gas', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-mathematics-grade11-tvl', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-mathematics-grade12-stem', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-mathematics-grade12-humss', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-mathematics-grade12-abm', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-mathematics-grade12-gas', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-mathematics-grade12-tvl', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-shs-science-grade11-stem', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-science-grade11-humss', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-science-grade11-abm', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-science-grade11-gas', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-science-grade11-tvl', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-science-grade12-stem', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-science-grade12-humss', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-science-grade12-abm', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-science-grade12-gas', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-science-grade12-tvl', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-shs-values-education-grade11-stem', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-values-education-grade11-humss', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-values-education-grade11-abm', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-values-education-grade11-gas', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-values-education-grade11-tvl', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-values-education-grade12-stem', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-values-education-grade12-humss', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-values-education-grade12-abm', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-values-education-grade12-gas', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-values-education-grade12-tvl', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-shs-pe-health-grade11-stem', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-pe-health-grade11-humss', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-pe-health-grade11-abm', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-pe-health-grade11-gas', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-pe-health-grade11-tvl', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-pe-health-grade12-stem', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-pe-health-grade12-humss', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-pe-health-grade12-abm', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-pe-health-grade12-gas', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-pe-health-grade12-tvl', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-shs-empowerment-technologies-grade11-stem', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-empowerment-technologies-grade11-humss', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-empowerment-technologies-grade11-abm', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-empowerment-technologies-grade11-gas', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-empowerment-technologies-grade11-tvl', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-empowerment-technologies-grade12-stem', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-empowerment-technologies-grade12-humss', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-empowerment-technologies-grade12-abm', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-empowerment-technologies-grade12-gas', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-empowerment-technologies-grade12-tvl', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-shs-practical-research-grade11-stem', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-practical-research-grade11-humss', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-practical-research-grade11-abm', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-practical-research-grade11-gas', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-practical-research-grade11-tvl', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-practical-research-grade12-stem', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-practical-research-grade12-humss', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-practical-research-grade12-abm', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-practical-research-grade12-gas', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-practical-research-grade12-tvl', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' }
  ];
  const savedSubjectAssignments = readJson(STORAGE_KEYS.subjectAssignments, null);
  const SUBJECT_ASSIGNMENTS = Array.isArray(savedSubjectAssignments)
    ? savedSubjectAssignments
    : clone(DEFAULT_SUBJECT_ASSIGNMENTS);

  // Shared attendance rows. Each record represents one student's status for
  // one school day, section, and (when available) subject. Replace this local
  // collection with the attendance API response during backend integration.
  const DEFAULT_ATTENDANCE_DIRECTORY = [
    { id: 'attendance-jd-004-2025-06-02-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-02-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-02-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-03-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-03-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-03-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-04-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-04', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-04-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-04', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-04-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-04', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-05-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-05-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-05-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-06-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-06-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-06-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-09-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-09-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-09-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-10-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-10-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-10-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-11-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-11', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-11-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-11', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-11-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-11', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-12-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-12', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-12-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-12', status: 'late', remark: null },
    { id: 'attendance-jd-004-2025-06-12-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-12', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-13-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-13', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-13-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-13', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-13-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-13', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-05-26-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-05-26', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-05-27-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-05-27', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-05-28-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-05-28', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-05-29-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-05-29', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-05-30-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-05-30', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-02-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-03-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-04-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-04', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-05-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-06-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-09-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-10-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-11-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-11', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-12-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-12', status: 'absent', remark: null },
    { id: 'attendance-mt-012-2025-06-13-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-13', status: 'absent', remark: null },
    { id: 'attendance-cm-001-2025-06-02-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-02-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-02-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-02', status: 'absent', remark: null },
    { id: 'attendance-sc-013-2025-06-02-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-02-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-02', status: 'late', remark: null },
    { id: 'attendance-cm-001-2025-06-03-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-03-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-03-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-03', status: 'absent', remark: null },
    { id: 'attendance-sc-013-2025-06-03-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-03', status: 'excused', remark: null },
    { id: 'attendance-gb-014-2025-06-03-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-cm-001-2025-06-04-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-04', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-04-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-04', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-04-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-04', status: 'absent', remark: null },
    { id: 'attendance-sc-013-2025-06-04-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-04', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-04-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-04', status: 'absent', remark: null },
    { id: 'attendance-cm-001-2025-06-05-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-05-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-05-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-sc-013-2025-06-05-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-05-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-cm-001-2025-06-06-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-06-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-06-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-06', status: 'absent', remark: null },
    { id: 'attendance-sc-013-2025-06-06-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-06-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-cm-001-2025-06-09-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-09', status: 'late', remark: null },
    { id: 'attendance-lr-002-2025-06-09-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-09-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-09', status: 'absent', remark: null },
    { id: 'attendance-sc-013-2025-06-09-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-09-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-cm-001-2025-06-10-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-10-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-10-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-10', status: 'absent', remark: '4th consecutive absence' },
    { id: 'attendance-sc-013-2025-06-10-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-10-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-10', status: 'late', remark: 'arrived 15 minutes late' }
  ];
  const savedAttendance = readJson(schoolStorageKey(STORAGE_KEYS.attendance, ACTIVE_SCHOOL_ID), null);
  const attendanceSeed = Array.isArray(savedAttendance)
    ? savedAttendance
    : clone(scopeToActiveSchool(DEFAULT_ATTENDANCE_DIRECTORY, ACTIVE_SCHOOL_ID));
  const ATTENDANCE_DIRECTORY = attendanceSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(record => ({
      ...record,
      schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
      studentId: String(record.studentId || ''),
      sectionId: record.sectionId || null,
      subjectId: record.subjectId || null,
      date: record.date || null,
      status: record.status || 'pending',
      remark: record.remark || null,
      teacherId: record.teacherId || null,
      source: record.source || 'manual',
      scannedAt: record.scannedAt || null,
      recordedAt: record.recordedAt || null
    }));

  function getAttendanceRecords(filters = {}) {
    return ATTENDANCE_DIRECTORY.filter(record =>
      record.schoolId === getActiveSchoolId() &&
      (!filters.studentId || record.studentId === String(filters.studentId)) &&
      (!filters.sectionId || record.sectionId === String(filters.sectionId)) &&
      (!filters.subjectId || record.subjectId === String(filters.subjectId)) &&
      (!filters.date || record.date === String(filters.date))
    );
  }

  function getAttendanceForStudent(studentId) {
    return getAttendanceRecords({ studentId });
  }

  function saveAttendanceRecords(records = ATTENDANCE_DIRECTORY) {
    writeJson(schoolStorageKey(STORAGE_KEYS.attendance), Array.isArray(records) ? records : []);
  }

  function upsertAttendanceRecords(records = []) {
    if (!Array.isArray(records)) return [];
    const validStatuses = ['present', 'absent', 'late', 'excused', 'pending'];
    const validSources = ['manual', 'qr'];
    const savedRecords = records.filter(values =>
      values?.studentId &&
      values?.date &&
      validStatuses.includes(values.status || 'pending') &&
      validSources.includes(values.source || 'manual')
    ).map(values => {
      const record = {
        id: String(values.id || `attendance-${values.studentId}-${values.date}-${values.subjectId || 'all'}`),
        schoolId: values.schoolId || getActiveSchoolId(),
        studentId: String(values.studentId || ''),
        sectionId: values.sectionId || null,
        subjectId: values.subjectId || null,
        date: values.date || null,
        status: values.status || 'pending',
        remark: values.remark || null,
        teacherId: values.teacherId || null,
        source: values.source || 'manual',
        scannedAt: values.scannedAt || null,
        recordedAt: values.recordedAt || null
      };
      const existing = ATTENDANCE_DIRECTORY.find(item =>
        item.schoolId === record.schoolId &&
        item.studentId === record.studentId &&
        item.sectionId === record.sectionId &&
        item.subjectId === record.subjectId &&
        item.date === record.date
      );
      if (existing) Object.assign(existing, record, { id: existing.id });
      else ATTENDANCE_DIRECTORY.push(record);
      return existing || record;
    });

    if (savedRecords.length) saveAttendanceRecords();
    return savedRecords;
  }

  // Shared assignment records for Teacher, Student, and Parent portals.
  // Each status row belongs to one assignment and one student.
  const DEFAULT_ASSIGNMENT_STATUS_RECORDS = [
    { id: 'assignment-status-001', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'cm-001', status: 'submitted', updatedAt: '2025-06-09T00:00:00.000Z' },
    { id: 'assignment-status-002', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'lr-002', status: 'submitted', updatedAt: '2025-06-09T00:00:00.000Z' },
    { id: 'assignment-status-003', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'sc-013', status: 'submitted', updatedAt: '2025-06-09T00:00:00.000Z' },
    { id: 'assignment-status-004', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'gb-014', status: 'submitted', updatedAt: '2025-06-09T00:00:00.000Z' },
    { id: 'assignment-status-005', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'lr-002', status: 'submitted', updatedAt: '2025-06-11T00:00:00.000Z' },
    { id: 'assignment-status-006', schoolId: 'scc', assignmentId: 'assignment-003', studentId: 'cm-001', status: 'submitted', updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-status-007', schoolId: 'scc', assignmentId: 'assignment-003', studentId: 'lr-002', status: 'submitted', updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-status-008', schoolId: 'scc', assignmentId: 'assignment-003', studentId: 'sc-013', status: 'submitted', updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-status-009', schoolId: 'scc', assignmentId: 'assignment-004', studentId: 'jd-004', status: 'submitted', updatedAt: '2025-06-09T00:00:00.000Z' },
    { id: 'assignment-status-010', schoolId: 'scc', assignmentId: 'assignment-006', studentId: 'jd-004', status: 'submitted', updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-status-011', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'cm-001', status: 'submitted', updatedAt: '2025-06-10T00:15:00.000Z' },
    { id: 'assignment-status-012', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'sc-013', status: 'submitted', updatedAt: '2025-06-11T01:10:00.000Z' }
  ];

  const DEFAULT_ASSIGNMENT_DIRECTORY = [
    {
      id: 'assignment-001', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Seatwork 1: Kindness and Respect', instructions: null, assignedDate: '2025-06-09', dueDate: '2025-06-09',
      onlineSubmissionEnabled: false, categoryId: 'ww', maxScore: 20
    },
    {
      id: 'assignment-002', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Quiz 1 Review: Core Values', instructions: null, assignedDate: '2025-06-11', dueDate: '2025-06-11',
      onlineSubmissionEnabled: true, categoryId: 'ww', maxScore: 50
    },
    {
      id: 'assignment-003', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Activity 1: Good Citizenship', instructions: null, assignedDate: '2025-06-13', dueDate: '2025-06-13',
      onlineSubmissionEnabled: false, categoryId: 'ww', maxScore: 30
    },
    {
      id: 'assignment-004', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Seatwork 1: Kindness and Respect', instructions: null, assignedDate: '2025-06-09', dueDate: '2025-06-09',
      onlineSubmissionEnabled: false, categoryId: 'ww', maxScore: 20
    },
    {
      id: 'assignment-005', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Quiz 1 Review: Core Values', instructions: null, assignedDate: '2025-06-11', dueDate: '2025-06-11',
      onlineSubmissionEnabled: true, categoryId: 'ww', maxScore: 50
    },
    {
      id: 'assignment-006', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Activity 1: Good Citizenship', instructions: null, assignedDate: '2025-06-13', dueDate: '2025-06-13',
      onlineSubmissionEnabled: false, categoryId: 'ww', maxScore: 30
    },
    {
      id: 'assignment-007', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-3',
      academicPeriodId: 'q2', title: 'Linear Equations Practice', instructions: null, assignedDate: '2025-06-12', dueDate: '2025-06-12',
      onlineSubmissionEnabled: false, categoryId: null, maxScore: null
    },
    {
      id: 'assignment-008', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Reading Response: Short Stories', instructions: null, assignedDate: '2025-06-10', dueDate: '2025-06-10',
      onlineSubmissionEnabled: false, categoryId: null, maxScore: null
    }
  ];
  const savedAssignments = readJson(schoolStorageKey(STORAGE_KEYS.assignments, ACTIVE_SCHOOL_ID), null);
  const assignmentSeed = Array.isArray(savedAssignments)
    ? savedAssignments
    : clone(scopeToActiveSchool(DEFAULT_ASSIGNMENT_DIRECTORY, ACTIVE_SCHOOL_ID));
  const ASSIGNMENT_DIRECTORY = assignmentSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(({ completion, ...record }) => {
      const defaultRecord = DEFAULT_ASSIGNMENT_DIRECTORY.find(item => item.id === record.id);
      const categoryId = Object.prototype.hasOwnProperty.call(record, 'categoryId')
        ? record.categoryId
        : defaultRecord?.categoryId || null;
      const savedMaxScore = Object.prototype.hasOwnProperty.call(record, 'maxScore')
        ? record.maxScore
        : defaultRecord?.maxScore;
      const maxScore = Number(savedMaxScore);
      return {
        ...record,
        schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
        academicPeriodId: record.academicPeriodId || defaultRecord?.academicPeriodId || null,
        instructions: record.instructions || null,
        onlineSubmissionEnabled: record.onlineSubmissionEnabled === true,
        categoryId: categoryId || null,
        maxScore: categoryId && maxScore > 0 ? maxScore : null
      };
    });

  const savedAssignmentStatuses = readJson(
    schoolStorageKey(STORAGE_KEYS.assignmentStatuses, ACTIVE_SCHOOL_ID),
    null
  );
  const ASSIGNMENT_STATUS_RECORDS = Array.isArray(savedAssignmentStatuses)
    ? savedAssignmentStatuses.filter(record => record.schoolId === ACTIVE_SCHOOL_ID)
    : clone(scopeToActiveSchool(DEFAULT_ASSIGNMENT_STATUS_RECORDS, ACTIVE_SCHOOL_ID));

  // One submission record belongs to one student and one assignment. The file
  // itself will be stored by the backend later; the frontend keeps metadata.
  const DEFAULT_ASSIGNMENT_SUBMISSIONS = [
    {
      id: 'assignment-submission-assignment-002-cm-001', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'cm-001',
      fileName: 'core-values-review-carlo.pdf', type: 'pdf', fileSize: 184320, fileUrl: '/assets/uploads/assignment-submissions/core-values-review-carlo.pdf',
      submittedAt: '2025-06-10T00:15:00.000Z', updatedAt: '2025-06-10T00:15:00.000Z'
    },
    {
      id: 'assignment-submission-assignment-002-lr-002', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'lr-002',
      fileName: 'quiz-1-review-liza.docx', type: 'docx', fileSize: 96256, fileUrl: null,
      submittedAt: '2025-06-11T00:00:00.000Z', updatedAt: '2025-06-11T00:00:00.000Z'
    },
    {
      id: 'assignment-submission-assignment-002-sc-013', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'sc-013',
      fileName: 'core-values-review-sofia.jpg', type: 'jpg', fileSize: 512000, fileUrl: null,
      submittedAt: '2025-06-11T01:10:00.000Z', updatedAt: '2025-06-11T01:10:00.000Z'
    }
  ];
  const savedAssignmentSubmissions = readJson(
    schoolStorageKey(STORAGE_KEYS.assignmentSubmissions, ACTIVE_SCHOOL_ID),
    null
  );
  const ASSIGNMENT_SUBMISSIONS = Array.isArray(savedAssignmentSubmissions)
    ? savedAssignmentSubmissions
    : clone(scopeToActiveSchool(DEFAULT_ASSIGNMENT_SUBMISSIONS, ACTIVE_SCHOOL_ID));

  function getAssignmentSubmissions(assignmentId = null) {
    return ASSIGNMENT_SUBMISSIONS.filter(record =>
      record.schoolId === getActiveSchoolId() &&
      (!assignmentId || record.assignmentId === String(assignmentId))
    );
  }

  function saveAssignmentSubmissions() {
    writeJson(schoolStorageKey(STORAGE_KEYS.assignmentSubmissions), ASSIGNMENT_SUBMISSIONS);
  }

  function submitAssignment(values = {}) {
    const schoolId = getActiveSchoolId();
    const assignmentId = String(values.assignmentId || '');
    const studentId = String(values.studentId || '');
    const assignment = ASSIGNMENT_DIRECTORY.find(record =>
      record.id === assignmentId && record.schoolId === schoolId
    );
    const student = getUserById(studentId);
    const fileName = String(values.fileName || '').trim();
    const type = String(values.type || '').trim();

    if (
      !assignment ||
      !student ||
      student.schoolId !== schoolId ||
      student.sectionId !== assignment.sectionId ||
      assignment.onlineSubmissionEnabled !== true ||
      !fileName ||
      !type
    ) return null;

    const submittedAt = values.submittedAt || new Date().toISOString();
    const record = {
      id: String(values.id || `assignment-submission-${assignmentId}-${studentId}`),
      schoolId,
      assignmentId,
      studentId,
      fileName,
      type,
      fileSize: values.fileSize || null,
      fileUrl: values.fileUrl || null,
      submittedAt,
      updatedAt: values.updatedAt || submittedAt
    };
    const existing = ASSIGNMENT_SUBMISSIONS.find(item =>
      item.schoolId === schoolId &&
      item.assignmentId === assignmentId &&
      item.studentId === studentId
    );

    if (existing) Object.assign(existing, record, { id: existing.id });
    else ASSIGNMENT_SUBMISSIONS.push(record);

    saveAssignmentSubmissions();
    setAssignmentStatus(assignmentId, studentId, 'submitted');
    return existing || record;
  }

  // Shared learning-material records for Teacher and Student portals. Every
  // record uses IDs for school, section, subject, and teacher so this array
  // can later be replaced by a learning-materials API response.
  const DEFAULT_LEARNING_MATERIAL_DIRECTORY = [
    { id: 'material-math-001', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Lesson 1: Algebra Basics', type: 'pdf', academicPeriodId: 'q1', postedAt: '2025-06-09T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-002', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Activity Sheet 1', type: 'docx', academicPeriodId: 'q1', postedAt: '2025-06-09T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-003', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Lesson 2 Slides: Equations', type: 'pptx', academicPeriodId: 'q1', postedAt: '2025-06-10T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-004', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Quiz 1 Answer Key', type: 'pdf', academicPeriodId: 'q1', postedAt: '2025-06-12T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-005', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Solving for X: Video Lesson', type: 'video', academicPeriodId: 'q2', postedAt: '2025-06-12T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-006', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Lesson 3: Linear Inequalities', type: 'pdf', academicPeriodId: 'q2', postedAt: '2025-06-13T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-007', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Seatwork 2: Variables', type: 'docx', academicPeriodId: 'q2', postedAt: '2025-06-14T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-english-001', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-3', title: 'Reading List: Short Stories', type: 'pdf', academicPeriodId: 'q1', postedAt: '2025-06-09T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-english-002', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-3', title: 'Grammar Review Slides', type: 'pptx', academicPeriodId: 'q1', postedAt: '2025-06-11T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-english-003', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-3', title: 'Essay Writing Guide', type: 'docx', academicPeriodId: 'q2', postedAt: '2025-06-13T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-english-004', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-3', title: 'Vocabulary List: Week 3', type: 'pdf', academicPeriodId: 'q2', postedAt: '2025-06-14T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-science-001', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-9', title: 'Cell Structure Diagram', type: 'pdf', academicPeriodId: 'q1', postedAt: '2025-06-09T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-science-002', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-9', title: 'Lab Safety Video', type: 'video', academicPeriodId: 'q1', postedAt: '2025-06-09T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-science-003', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-9', title: 'Lesson 2 Slides: Ecosystems', type: 'pptx', academicPeriodId: 'q2', postedAt: '2025-06-11T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-science-004', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-9', title: 'Worksheet: Food Chains', type: 'docx', academicPeriodId: 'q2', postedAt: '2025-06-12T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-science-005', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-9', title: 'Quiz 1 Review Notes', type: 'pdf', academicPeriodId: 'q2', postedAt: '2025-06-13T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-values-001', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Module 2: Empathy and Respect', type: 'pdf', academicPeriodId: 'q1', postedAt: '2025-06-11T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-values-002', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Reflection Guide', type: 'docx', academicPeriodId: 'q2', postedAt: '2025-06-13T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-section-values-001', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Module 3 - Respect and Kindness.pdf', type: 'pdf', academicPeriodId: 'q2', postedAt: '2025-06-03T00:00:00+08:00', fileSize: '2.4 MB', status: 'published', visibleToStudents: true, views: 32 },
    { id: 'material-section-values-002', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Q2 Lesson 4 - Good Citizenship.pptx', type: 'pptx', academicPeriodId: 'q2', postedAt: '2025-05-28T00:00:00+08:00', fileSize: '5.1 MB', status: 'published', visibleToStudents: true, views: 28 },
    { id: 'material-section-values-003', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Activity Sheet 3 - Reflection Exercises.xlsx', type: 'xlsx', academicPeriodId: 'q2', postedAt: '2025-05-22T00:00:00+08:00', fileSize: '0.8 MB', status: 'published', visibleToStudents: true, views: 25 },
    { id: 'material-section-values-004', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Reference - Values Education Guide.pdf', type: 'pdf', academicPeriodId: 'q2', postedAt: '2025-05-15T00:00:00+08:00', fileSize: '1.2 MB', status: 'published', visibleToStudents: true, views: 38 },
    { id: 'material-section-values-005', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Values Poster Visual Aid.png', type: 'png', academicPeriodId: 'q2', postedAt: '2025-05-10T00:00:00+08:00', fileSize: '0.4 MB', status: 'published', visibleToStudents: true, views: 19 },
    { id: 'material-section-values-006', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Q2 Study Guide.docx', type: 'docx', academicPeriodId: 'q2', postedAt: '2025-06-08T00:00:00+08:00', fileSize: '0.6 MB', status: 'draft', visibleToStudents: false, views: 0 }
  ];
  const savedLearningMaterials = EDUGNAY_API_BASE_URL ? null : readJson(schoolStorageKey(STORAGE_KEYS.materials, ACTIVE_SCHOOL_ID), null);
  const learningMaterialSeed = EDUGNAY_API_BASE_URL ? [] : Array.isArray(savedLearningMaterials)
    ? savedLearningMaterials
    : clone(scopeToActiveSchool(DEFAULT_LEARNING_MATERIAL_DIRECTORY, ACTIVE_SCHOOL_ID));
  const LEARNING_MATERIAL_DIRECTORY = learningMaterialSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(record => ({
      id: String(record.id || `material-${Date.now()}`),
      schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
      sectionId: record.sectionId || null,
      subjectId: record.subjectId || null,
      teacherId: record.teacherId || null,
      title: String(record.title || ''),
      type: String(record.type || 'file'),
      schoolYear: record.schoolYear || '2025-2026',
      academicPeriodId: record.academicPeriodId || null,
      postedAt: record.postedAt || null,
      fileSize: record.fileSize || null,
      fileUrl: record.fileUrl || null,
      status: record.status || 'published',
      visibleToStudents: record.visibleToStudents !== false,
      views: Number(record.views) || 0
    }));

  // Shared published/draft announcement records for every school portal.
  // Optional fields are always present: imageUrl/access use null, pinned uses false.
  // Portal pages read this collection with an audience key; Admin can read
  // all records, including drafts, for management.
  const DEFAULT_ANNOUNCEMENT_DIRECTORY = [
    {
      id: 'ANN-001', schoolId: 'scc', title: 'Q2 Grade Encoding Deadline: June 14',
      body: 'All subject teachers are required to complete encoding of Q2 grades no later than <strong>June 14, 2025</strong>. Please coordinate with your section adviser for any discrepancies before the deadline.',
      priority: 'high', audience: ['all'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-06-14T08:00:00+08:00',
      status: 'published', pinned: true, icon: 'alert-triangle', iconClass: 'icon-high', tag: 'Urgent', read: false, seenCount: 284,
      imageUrl: '../../assets/uploads/announcements/ChatGPT Image Jun 13, 2026, 10_21_57 PM.png', access: null
    },
    {
      id: 'ANN-002', schoolId: 'scc', title: 'Journal Submission Window: This Friday',
      body: 'The weekly journal submission window will open this <strong>Friday, June 7</strong>. Please remind your students to submit their entries before 11:59 PM. Late submissions will not be accepted for this week.',
      priority: 'normal', audience: ['teachers'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-06-13T15:00:00+08:00',
      status: 'published', pinned: false, icon: 'book-open', iconClass: 'icon-normal', tag: 'Normal', read: false, seenCount: 24,
      imageUrl: null, access: 'journals'
    },
    {
      id: 'ANN-003', schoolId: 'scc', title: 'Foundation Day: June 20, 2025',
      body: 'St. Columban\'s College will celebrate its <strong>Foundation Day on June 20, 2025</strong>. Classes will be suspended for the day. All students are encouraged to participate in the school activities.',
      priority: 'event', audience: ['all'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-30T10:00:00+08:00',
      status: 'published', pinned: false, icon: 'calendar', iconClass: 'icon-event', tag: 'Event', read: false, seenCount: 312,
      imageUrl: null, access: null
    },
    {
      id: 'ANN-004', schoolId: 'scc', title: 'Q2 Narrative Reports Now Available',
      body: 'Q2 narrative reports have been confirmed by section teachers and are now available to view in the portal. Please review the summaries for your assigned sections or linked children.',
      priority: 'normal', audience: ['teachers', 'parents'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-28T09:00:00+08:00',
      status: 'published', pinned: false, icon: 'file-text', iconClass: 'icon-normal', tag: 'Normal', read: true, seenCount: 198,
      imageUrl: null, access: 'reports'
    },
    {
      id: 'ANN-005', schoolId: 'scc', title: 'Weekly Journal is Now Open for Submission',
      body: 'This week\'s journal submission is now open. Please write about your week, your experiences, feelings, and anything you want to share. Submissions close <strong>Friday at 11:59 PM</strong>.',
      priority: 'normal', audience: ['students'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-24T07:00:00+08:00',
      status: 'published', pinned: false, icon: 'pencil', iconClass: 'icon-normal', tag: 'Normal', read: true, seenCount: 253,
      imageUrl: null, access: 'journals'
    },
    {
      id: 'ANN-006', schoolId: 'scc', title: 'End of Quarter Reminder: Q2 Closing',
      body: 'This announcement is saved as a draft and is not yet visible to any users. Click Edit to review and publish it.',
      priority: 'low', audience: ['all'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-22T16:30:00+08:00',
      status: 'draft', pinned: false, icon: 'file-edit', iconClass: 'icon-low', tag: 'Draft', read: true, seenCount: 0,
      imageUrl: null, access: null
    },
    {
      id: 'ANN-007', schoolId: 'scc', title: 'Intramurals Sign-up Open',
      body: 'Visit the Student Affairs table during recess this week to join a sports team for the upcoming intramurals. Sign-ups close <strong>Friday</strong>.',
      priority: 'event', audience: ['students'], authorId: 'admin-1', authorName: 'Admin', createdAt: '2025-06-12T13:30:00+08:00',
      status: 'published', pinned: false, icon: 'calendar', iconClass: 'icon-event', tag: 'Event', read: false, seenCount: 0,
      imageUrl: null, access: null
    },
    {
      id: 'ANN-008', schoolId: 'scc', title: 'Library Resources Updated',
      body: 'New reference materials are now available in the student library corner.',
      priority: 'normal', audience: ['students'], authorId: 'admin-1', authorName: 'Library', createdAt: '2025-06-10T10:00:00+08:00',
      status: 'published', pinned: false, icon: 'book-open', iconClass: 'icon-normal', tag: 'Normal', read: true, seenCount: 0,
      imageUrl: null, access: null
    },
    {
      id: 'ANN-009', schoolId: 'scc', title: 'Parent-Teacher Conference Schedule',
      body: 'Parent-Teacher Conferences for Q2 are scheduled for <strong>June 27, 2025</strong>, 8:00 AM to 4:00 PM. Please coordinate with your child\'s adviser for a specific time slot.',
      priority: 'event', audience: ['parents'], authorId: 'admin-1', authorName: 'Admin', createdAt: '2025-06-11T09:00:00+08:00',
      status: 'published', pinned: false, icon: 'calendar', iconClass: 'icon-event', tag: 'Event', read: true, seenCount: 0,
      imageUrl: null, access: null
    }
  ];
  const savedAnnouncements = readJson(schoolStorageKey(STORAGE_KEYS.announcements, ACTIVE_SCHOOL_ID), null);
  const announcementSeed = Array.isArray(savedAnnouncements)
    ? savedAnnouncements
    : clone(scopeToActiveSchool(DEFAULT_ANNOUNCEMENT_DIRECTORY, ACTIVE_SCHOOL_ID));
  const ANNOUNCEMENT_DIRECTORY = announcementSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(record => ({
      ...record,
      schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
      audience: Array.isArray(record.audience) ? record.audience : [record.audience || 'all'],
      status: record.status || 'published',
      pinned: record.pinned === true,
      imageUrl: record.imageUrl || null,
      access: record.access || null
    }));

  // Shared AI report records for Adviser and Parent portals. The text is a
  // mock generated summary; source metrics remain structured fields so a
  // future report-generation endpoint can replace this collection directly.
  function normalizeRecommendedActions(actions) {
    if (!Array.isArray(actions)) return [];
    return actions
      .map(action => String(action || '').trim().slice(0, 250))
      .filter(Boolean)
      .flatMap(action => /^Continue the current study routine and encourage consistent participation in Grade \d+\.$/.test(action)
        ? [
            'Maintain a regular study schedule and review class notes before the next lesson.',
            'Encourage the student to continue participating in class and ask questions when support is needed.'
          ]
        : [action])
      .slice(0, 5);
  }

  // Frontend-only placeholder. The backend will replace this with validated
  // AI output generated from the authenticated school's report data.
  function buildMockRecommendedActions(report) {
    const actions = [];
    const gradeNumber = Number(String(report.gradeLevel || '').match(/\d+/)?.[0] || 0);
    const absenceCount = Array.isArray(report.attendance?.absences)
      ? report.attendance.absences.length
      : 0;
    const missingSubjects = Array.isArray(report.assignments?.missing)
      ? report.assignments.missing.filter(Boolean)
      : [];

    if (absenceCount) {
      actions.push(absenceCount === 1
        ? 'Review the lesson missed during the recent absence and complete any unfinished classwork.'
        : 'Discuss the recent absences and make a simple plan for consistent attendance next week.');
    }
    if (missingSubjects.length) {
      actions.push(`Create a short catch-up schedule for pending work in ${missingSubjects.join(', ')}.`);
    }
    if (report.atRisk) {
      actions.push('Contact the class adviser to agree on the next steps if the concerns continue.');
    }
    if (!actions.length) {
      if (gradeNumber && gradeNumber <= 6) {
        actions.push('Set aside a short daily review period and check that schoolwork is completed.');
      } else if (gradeNumber >= 11) {
        actions.push('Maintain a weekly study schedule and monitor upcoming requirements and deadlines.');
      } else {
        actions.push('Maintain a regular study schedule and review class notes before the next lesson.');
      }
      actions.push('Encourage the student to continue participating in class and ask questions when support is needed.');
    }

    return normalizeRecommendedActions(actions);
  }

  const DEFAULT_REPORT_DIRECTORY = [
    {
      id: 'report-cm-001-2025-w23', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', teacherId: 'teacher-2',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'pending', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      recommendedActions: [
        'Maintain a regular study schedule and review class notes before the next lesson.',
        'Encourage the student to continue participating in class and group activities.'
      ],
      text: 'Carlo had a strong week across all his subjects. He attended all sessions and completed all 4 tracked assignments on time. His journal entry reflected positively on his progress and noted enjoyment in group activities. No concerns to report this week - keep up the encouragement at home.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: null
    },
    {
      id: 'report-lr-002-2025-w23', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', teacherId: 'teacher-2',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'confirmed', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      recommendedActions: [
        'Continue the regular study routine and recognize the student\'s consistent effort.',
        'Review quiz feedback together and encourage questions about difficult topics.'
      ],
      text: 'Liza continues to show consistent effort this week. She was present for all sessions and submitted all assignments on schedule. Her journal entry mentioned feeling more confident after a recent quiz. No concerns at this time.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: '2025-06-14T08:02:00+08:00'
    },
    {
      id: 'report-jd-004-2025-w23', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', teacherId: 'teacher-9',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'confirmed', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      recommendedActions: [
        'Continue regular Algebra practice and review class notes before the next lesson.',
        'Encourage the student to keep participating in group activities and supporting classmates.'
      ],
      text: 'Juan had a strong week across all his subjects. He attended all sessions and completed all 4 tracked assignments on time. His journal entry reflected positively on his progress in Algebra and noted enjoyment in group activities. No concerns to report this week. Keep up the encouragement at home!',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: '2025-06-14T08:02:00+08:00'
    },
    {
      id: 'report-ml-006-2025-w23', schoolId: 'scc', studentId: 'ml-006', sectionId: 'jhs-grade9-peter', teacherId: 'teacher-rico-santos',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'pending', atRisk: true,
      attendance: { total: '12/30', absences: [
        { subject: 'Mathematics', day: 'Tue' }, { subject: 'Mathematics', day: 'Wed' }, { subject: 'Mathematics', day: 'Thu' },
        { subject: 'Science', day: 'Tue' }, { subject: 'Science', day: 'Wed' }, { subject: 'Science', day: 'Thu' },
        { subject: 'English', day: 'Tue' }, { subject: 'English', day: 'Thu' }
      ] }, assignments: { total: '1/4', missing: ['Mathematics', 'Science', 'English'] }, journalEntryCount: 0,
      recommendedActions: [
        'Discuss the recent absences and make a simple plan for consistent attendance next week.',
        'Create a short catch-up schedule for pending work in Mathematics, Science, and English.',
        'Contact the class adviser to agree on the next steps if the concerns continue.'
      ],
      text: 'Maria is flagged as at-risk this week with multiple absences across subjects and only 1 of 4 assignments completed. Academic records show scores trending below the passing threshold. No journal entry was submitted. We strongly recommend reaching out to discuss what may be affecting her attendance and engagement.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: null
    },
    {
      id: 'report-bg-007-2025-w23', schoolId: 'scc', studentId: 'bg-007', sectionId: 'jhs-grade9-paul', teacherId: 'teacher-jana-mendez',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'pending', atRisk: true,
      attendance: { total: '26/30', absences: [{ subject: 'Mathematics', day: 'Wed' }, { subject: 'Science', day: 'Wed' }, { subject: 'English', day: 'Wed' }] },
      assignments: { total: '2/4', missing: ['Mathematics', 'English'] }, journalEntryCount: 1,
      recommendedActions: [
        'Discuss the recent absences and make a simple plan for consistent attendance next week.',
        'Create a short catch-up schedule for pending work in Mathematics and English.',
        'Contact the class adviser to agree on the next steps if the concerns continue.'
      ],
      text: 'Ben is flagged as at-risk this week. He was absent in several subjects on Wednesday and completed only 2 of 4 assignments, continuing a pattern from prior weeks. His journal described feeling overwhelmed. We recommend a supportive conversation at home about pacing.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: null
    },
    {
      id: 'report-as-008-2025-w23', schoolId: 'scc', studentId: 'as-008', sectionId: 'jhs-grade10-james', teacherId: 'teacher-3',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'pending', atRisk: false,
      attendance: { total: '29/30', absences: [{ subject: 'Science', day: 'Mon' }] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      recommendedActions: [
        'Review the Science lesson missed during the recent absence and complete any unfinished classwork.'
      ],
      text: 'Ana had a good week with one absence in Science on Monday but completed all assignments regardless. Her journal entry mentioned working through a difficult topic with help from peers. No concerns at this time.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: null
    },
    {
      id: 'report-mt-012-2025-w23', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', teacherId: 'teacher-2',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'confirmed', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      recommendedActions: [
        'Maintain the habit of completing assignments on or ahead of schedule.',
        'Encourage the student to continue participating in discussions and supporting classmates.'
      ],
      text: 'Maya had a wonderful week. She participated actively in class discussions and completed all her assignments ahead of schedule. Her teacher noted she helped a classmate with a Math problem during group work. It was a lovely display of kindness.',
      generatedAt: '2025-06-14T09:15:00+08:00', confirmedAt: '2025-06-14T09:15:00+08:00'
    },
    {
      id: 'report-jd-004-2025-w22', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', teacherId: 'teacher-9',
      weekId: '2025-W22', weekLabel: 'Week of June 2 to 7, 2025', dateRange: 'Jun 2 to Jun 7', status: 'confirmed', atRisk: true,
      attendance: { total: '28/30', absences: [{ subject: 'All subjects', day: 'Tue' }, { subject: 'All subjects', day: 'Thu' }] }, assignments: { total: '2/4', missing: ['Science', 'Filipino'] }, journalEntryCount: 1,
      recommendedActions: [
        'Discuss the recent absences and make a simple plan for consistent attendance next week.',
        'Create a short catch-up schedule for pending work in Science and Filipino.',
        'Contact the class adviser to agree on the next steps if the concerns continue.'
      ],
      text: 'Juan is flagged as at-risk this week. He was absent on Tuesday and Thursday and completed only 2 of 4 assignments. We recommend a check-in at home regarding his recent attendance and a brief conversation about any challenges he may be facing.',
      generatedAt: '2025-06-07T07:45:00+08:00', confirmedAt: '2025-06-07T07:45:00+08:00'
    },
    {
      id: 'report-jd-004-2025-w21', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', teacherId: 'teacher-9',
      weekId: '2025-W21', weekLabel: 'Week of May 26 to 31, 2025', dateRange: 'May 26 to May 31', status: 'confirmed', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '3/4', missing: ['Science'] }, journalEntryCount: 1,
      recommendedActions: [
        'Create a short catch-up schedule for the pending Science activity.',
        'Review the related Science lesson and ask the teacher about any unclear parts.'
      ],
      text: 'Juan had a solid week overall. He attended every class day and completed 3 of his 4 assignments, with one activity still pending. His journal reflection was thoughtful and showed good self-awareness about managing his time.',
      generatedAt: '2025-05-31T08:10:00+08:00', confirmedAt: '2025-05-31T08:10:00+08:00'
    },
    {
      id: 'report-mt-012-2025-w22', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', teacherId: 'teacher-2',
      weekId: '2025-W22', weekLabel: 'Week of June 2 to 7, 2025', dateRange: 'Jun 2 to Jun 7', status: 'confirmed', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      recommendedActions: [
        'Maintain consistent attendance and submit schoolwork on time.',
        'Encourage the student to set one learning goal for the coming week.'
      ],
      text: 'Maya continues to do well this week. She was present every day and submitted all her work on time. No concerns at this time. She remains one of the more engaged students in class.',
      generatedAt: '2025-06-07T08:30:00+08:00', confirmedAt: '2025-06-07T08:30:00+08:00'
    }
  ];
  const savedReports = readJson(schoolStorageKey(STORAGE_KEYS.reports, ACTIVE_SCHOOL_ID), null);
  const reportSeed = Array.isArray(savedReports)
    ? savedReports
    : clone(scopeToActiveSchool(DEFAULT_REPORT_DIRECTORY, ACTIVE_SCHOOL_ID));
  const REPORT_DIRECTORY = reportSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(record => ({
      ...record,
      schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
      studentId: String(record.studentId || ''),
      status: record.status || 'pending',
      atRisk: Boolean(record.atRisk),
      journalEntryCount: Number(record.journalEntryCount || 0),
      schoolLevel: record.schoolLevel ? String(record.schoolLevel).trim() : null,
      gradeLevel: record.gradeLevel ? String(record.gradeLevel).trim() : null,
      strand: record.strand ? String(record.strand).trim() : null,
      teacherNote: record.teacherNote ? String(record.teacherNote).trim() : null,
      recommendedActions: normalizeRecommendedActions(
        Array.isArray(record.recommendedActions)
          ? record.recommendedActions
          : buildMockRecommendedActions(record)
      ),
      text: String(record.text || ''),
      confirmedAt: record.confirmedAt || null
    }));

  const USER_STORAGE_KEY = schoolStorageKey(STORAGE_KEYS.users, ACTIVE_SCHOOL_ID);
  const savedUsers = readJson(USER_STORAGE_KEY, null);
  const USER_SEED_VERSION = 5;
  const USER_SEED_VERSION_KEY = schoolStorageKey(STORAGE_KEYS.userSeedVersion, ACTIVE_SCHOOL_ID);
  const savedUserSeedVersion = Number(readJson(USER_SEED_VERSION_KEY, 0));
  const USERS = Array.isArray(savedUsers) && savedUsers.length
    ? savedUsers
    : clone(DEFAULT_USERS.filter(user => user.schoolId === ACTIVE_SCHOOL_ID));

  const usedAttendanceQrTokens = new Set();

  // Frontend-only token generation. The backend will generate and validate
  // attendance QR tokens after integration.
  function createAttendanceQrToken() {
    let token;
    do {
      token = globalThis.crypto?.randomUUID?.()
        || `qr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    } while (
      usedAttendanceQrTokens.has(token)
      || USERS.some(user => user.attendanceQrToken === token)
    );
    usedAttendanceQrTokens.add(token);
    return token;
  }

  // Keep older saved records compatible with the canonical user fields.
  let usersChanged = false;
  if (Array.isArray(savedUsers) && savedUsers.length && savedUserSeedVersion < USER_SEED_VERSION) {
    const existingUserIds = new Set(USERS.map(user => user.id));
    const missingSf1Parents = DEFAULT_USERS.filter(user => (
      user.id.startsWith('parent-sf1-') && !existingUserIds.has(user.id)
    ));
    if (missingSf1Parents.length) {
      USERS.push(...clone(missingSf1Parents));
      usersChanged = true;
    }

    const juan = USERS.find(user => user.id === 'jd-004');
    if (juan?.gradeLevel === 'Grade 8' && juan.sectionId === 'jhs-grade8-luke') {
      juan.schoolLevel = 'jhs';
      juan.gradeLevel = 'Grade 7';
      juan.sectionId = 'jhs-grade7-matthew';
      usersChanged = true;
    }

    USERS.forEach(user => {
      const defaultUser = DEFAULT_USERS.find(item => item.id === user.id);
      if (defaultUser?.attendanceQrToken && user.attendanceQrToken !== defaultUser.attendanceQrToken) {
        user.attendanceQrToken = defaultUser.attendanceQrToken;
        usersChanged = true;
      }
    });
  }
  USERS.forEach(user => {
    const defaultUser = DEFAULT_USERS.find(item => item.id === user.id);
    let savedLrn = user.lrn || defaultUser?.lrn || null;
    if (user.role === RECORD_VALUES.roles.STUDENT && savedLrn) {
      const digits = String(savedLrn).replace(/\D/g, '');
      if (digits.length === 10 || digits.length === 11) {
        savedLrn = `${digits.slice(0, 6)}${digits.slice(6).padStart(6, '0')}`;
      } else if (digits.length === 12) {
        savedLrn = digits;
      }
    }
    const hasLegacyEmail = Object.hasOwn(user, 'email');
    const schoolEmail = String(user.schoolEmail || (hasLegacyEmail ? user.email : '') || '').trim().toLowerCase();
    const personalEmail = String(user.personalEmail || '').trim().toLowerCase() || null;
    const isStudent = user.role === RECORD_VALUES.roles.STUDENT;
    let attendanceQrToken = isStudent ? String(user.attendanceQrToken || '').trim() : null;
    if (isStudent && (!attendanceQrToken || usedAttendanceQrTokens.has(attendanceQrToken))) {
      attendanceQrToken = createAttendanceQrToken();
    }
    if (attendanceQrToken) usedAttendanceQrTokens.add(attendanceQrToken);
    if (user.lrn !== savedLrn) {
      user.lrn = savedLrn;
      usersChanged = true;
    }
    if (user.schoolEmail !== schoolEmail) {
      user.schoolEmail = schoolEmail;
      usersChanged = true;
    }
    if (hasLegacyEmail) {
      delete user.email;
      usersChanged = true;
    }
    if (user.personalEmail !== personalEmail) {
      user.personalEmail = personalEmail;
      usersChanged = true;
    }
    if (user.attendanceQrToken !== attendanceQrToken) {
      user.attendanceQrToken = attendanceQrToken;
      usersChanged = true;
    }
  });
  if (usersChanged) {
    writeJson(USER_STORAGE_KEY, USERS);
  }
  if (savedUserSeedVersion < USER_SEED_VERSION) {
    writeJson(USER_SEED_VERSION_KEY, USER_SEED_VERSION);
  }

  const DEFAULT_PARENT_STUDENT_LINKS = [
    { id: 'parent-student-parent-7-jd-004', schoolId: 'scc', parentId: 'parent-7', studentId: 'jd-004', relationship: 'mother' },
    { id: 'parent-student-parent-8-mt-012', schoolId: 'scc', parentId: 'parent-8', studentId: 'mt-012', relationship: 'mother' },
    { id: 'parent-student-parent-sf1-cm-001-cm-001', schoolId: 'scc', parentId: 'parent-sf1-cm-001', studentId: 'cm-001', relationship: 'mother' },
    { id: 'parent-student-parent-sf1-lr-002-lr-002', schoolId: 'scc', parentId: 'parent-sf1-lr-002', studentId: 'lr-002', relationship: 'father' },
    { id: 'parent-student-parent-sf1-sc-013-sc-013', schoolId: 'scc', parentId: 'parent-sf1-sc-013', studentId: 'sc-013', relationship: 'mother' },
    { id: 'parent-student-parent-sf1-gb-014-gb-014', schoolId: 'scc', parentId: 'parent-sf1-gb-014', studentId: 'gb-014', relationship: 'father' },
    { id: 'parent-student-parent-sf1-na-015-na-015', schoolId: 'scc', parentId: 'parent-sf1-na-015', studentId: 'na-015', relationship: 'mother' }
  ];
  const PARENT_STUDENT_LINK_STORAGE_KEY = schoolStorageKey(STORAGE_KEYS.parentStudentLinks, ACTIVE_SCHOOL_ID);
  const savedParentStudentLinks = readJson(PARENT_STUDENT_LINK_STORAGE_KEY, null);
  const PARENT_STUDENT_LINK_SEED_VERSION = 1;
  const PARENT_STUDENT_LINK_SEED_VERSION_KEY = schoolStorageKey(STORAGE_KEYS.parentStudentLinkSeedVersion, ACTIVE_SCHOOL_ID);
  const savedParentStudentLinkSeedVersion = Number(readJson(PARENT_STUDENT_LINK_SEED_VERSION_KEY, 0));
  const parentStudentLinkSeed = Array.isArray(savedParentStudentLinks)
    ? savedParentStudentLinks.slice()
    : clone(DEFAULT_PARENT_STUDENT_LINKS);
  if (Array.isArray(savedParentStudentLinks) && savedParentStudentLinkSeedVersion < PARENT_STUDENT_LINK_SEED_VERSION) {
    const existingLinkIds = new Set(parentStudentLinkSeed.map(link => String(link.id || '')));
    DEFAULT_PARENT_STUDENT_LINKS.forEach(link => {
      if (!existingLinkIds.has(link.id)) parentStudentLinkSeed.push(link);
    });
  }
  const PARENT_STUDENT_LINKS = parentStudentLinkSeed
    .map(link => ({
      id: String(link.id || `parent-student-${link.parentId}-${link.studentId}`),
      schoolId: link.schoolId || ACTIVE_SCHOOL_ID,
      parentId: String(link.parentId || ''),
      studentId: String(link.studentId || ''),
      relationship: PARENT_RELATIONSHIPS.includes(String(link.relationship || '').trim().toLowerCase())
        ? String(link.relationship).trim().toLowerCase()
        : null
    }));
  if (Array.isArray(savedParentStudentLinks)
    && JSON.stringify(savedParentStudentLinks) !== JSON.stringify(PARENT_STUDENT_LINKS)) {
    writeJson(PARENT_STUDENT_LINK_STORAGE_KEY, PARENT_STUDENT_LINKS);
  }
  if (savedParentStudentLinkSeedVersion < PARENT_STUDENT_LINK_SEED_VERSION) {
    writeJson(PARENT_STUDENT_LINK_SEED_VERSION_KEY, PARENT_STUDENT_LINK_SEED_VERSION);
  }

  const USER_PROFILE_STORAGE_KEY = schoolStorageKey(STORAGE_KEYS.userProfiles, ACTIVE_SCHOOL_ID);
  const USER_PROFILE_SEED_VERSION = 2;
  const USER_PROFILE_SEED_VERSION_KEY = schoolStorageKey(STORAGE_KEYS.userProfileSeedVersion, ACTIVE_SCHOOL_ID);
  const savedUserProfiles = readJson(USER_PROFILE_STORAGE_KEY, null);
  const savedUserProfileSeedVersion = Number(readJson(USER_PROFILE_SEED_VERSION_KEY, 0));
  const defaultUserProfiles = DEFAULT_USER_PROFILES
    .filter(profile => (profile.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID);

  function mergeDefaultProfile(defaultProfile, savedProfile) {
    const merged = { ...defaultProfile };
    Object.entries(savedProfile || {}).forEach(([field, value]) => {
      if (field !== 'userId' && field !== 'schoolId' && value !== null && value !== undefined && value !== '') {
        merged[field] = value;
      }
    });
    return merged;
  }

  let userProfilesChanged = false;
  let USER_PROFILES;
  if (!Array.isArray(savedUserProfiles)) {
    USER_PROFILES = defaultUserProfiles.map(profile => normalizeUserProfile(profile.userId, profile));
    userProfilesChanged = true;
  } else if (savedUserProfileSeedVersion < USER_PROFILE_SEED_VERSION) {
    const savedProfilesByUserId = new Map(savedUserProfiles.map(profile => [String(profile.userId || ''), profile]));
    const defaultProfileIds = new Set(defaultUserProfiles.map(profile => profile.userId));
    USER_PROFILES = defaultUserProfiles
      .map(profile => normalizeUserProfile(profile.userId, mergeDefaultProfile(profile, savedProfilesByUserId.get(profile.userId))))
      .concat(savedUserProfiles
        .filter(profile => !defaultProfileIds.has(String(profile.userId || '')))
        .map(profile => normalizeUserProfile(profile.userId, profile)));
    userProfilesChanged = true;
  } else {
    USER_PROFILES = savedUserProfiles
      .filter(profile => (profile.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
      .map(profile => normalizeUserProfile(profile.userId, profile));
  }

  if (userProfilesChanged) writeJson(USER_PROFILE_STORAGE_KEY, USER_PROFILES);
  if (savedUserProfileSeedVersion < USER_PROFILE_SEED_VERSION) {
    writeJson(USER_PROFILE_SEED_VERSION_KEY, USER_PROFILE_SEED_VERSION);
  }

  function normalizeUserProfile(userId, values = {}) {
    const profile = {
      userId: String(userId || values.userId || ''),
      schoolId: values.schoolId || ACTIVE_SCHOOL_ID,
      middleName: values.middleName || null,
      hasNoMiddleName: Boolean(values.hasNoMiddleName),
      contactNumber: values.contactNumber || null,
      sex: values.sex || null,
      birthDate: values.birthDate || null,
      birthPlaceProvince: values.birthPlaceProvince || null,
      birthPlace: values.birthPlace || values.birthPlaceProvince || null,
      birthPlaceRegion: values.birthPlaceRegion || null,
      birthCountry: values.birthCountry || null,
      motherTongue: values.motherTongue || null,
      indigenousGroup: values.indigenousGroup || null,
      religion: values.religion || null,
      houseStreet: values.houseStreet || null,
      barangay: values.barangay || null,
      cityMunicipality: values.cityMunicipality || null,
      province: values.province || null,
      maidenLastName: values.maidenLastName || null,
      hasNoMaidenName: Boolean(values.hasNoMaidenName),
      profileCompletedAt: values.profileCompletedAt || null,
      updatedAt: values.updatedAt || null
    };
    return profile;
  }

  function saveUserProfiles() {
    writeJson(USER_PROFILE_STORAGE_KEY, USER_PROFILES);
  }

  const ROLE_ALIASES = {
    admin: RECORD_VALUES.roles.SCHOOL_ADMIN,
    adm: RECORD_VALUES.roles.SCHOOL_ADMIN,
    fac: RECORD_VALUES.roles.TEACHER,
    stud: RECORD_VALUES.roles.STUDENT,
    par: RECORD_VALUES.roles.PARENT,
    parents: RECORD_VALUES.roles.PARENT
  };

  function getUsers() {
    return USERS;
  }

  function getUsersByRole(role) {
    return USERS.filter(user => user.role === String(role));
  }

  function getStudents() {
    return getUsersByRole(RECORD_VALUES.roles.STUDENT);
  }

  function getUserById(userId) {
    return USERS.find(user => user.id === String(userId)) || null;
  }

  function getStudentByAttendanceQrToken(token) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) return null;
    return USERS.find(user => (
      user.schoolId === getActiveSchoolId()
      && user.role === RECORD_VALUES.roles.STUDENT
      && (
        user.attendanceQrToken === normalizedToken
        || `edugnay-demo-${user.schoolId}-${user.id}-v1` === normalizedToken
      )
    )) || null;
  }

  function saveUsers() {
    writeJson(USER_STORAGE_KEY, USERS);
  }

  function regenerateStudentAttendanceQr(studentId) {
    const student = getUserById(studentId);
    if (!student
      || student.schoolId !== getActiveSchoolId()
      || student.role !== RECORD_VALUES.roles.STUDENT) return null;

    student.attendanceQrToken = createAttendanceQrToken();
    saveUsers();
    return student;
  }

  function createTemporaryPassword() {
    const value = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return `Edu-${value.replace(/-/g, '').slice(0, 8)}!`;
  }

  function prepareCredentialDelivery(userId) {
    const user = getUserById(userId);
    if (!user || user.schoolId !== getActiveSchoolId()) return null;

    return {
      userId: user.id,
      personalEmail: user.personalEmail,
      schoolEmail: user.schoolEmail,
      temporaryPassword: createTemporaryPassword(),
      attendanceQrToken: user.role === RECORD_VALUES.roles.STUDENT
        ? user.attendanceQrToken
        : null
    };
  }

  function getAttendanceQrPayload(token) {
    const normalizedToken = String(token || '').trim();
    return normalizedToken ? `edugnay:attendance:${normalizedToken}` : '';
  }

  function parseAttendanceQrPayload(payload) {
    const value = String(payload || '').trim();
    const prefix = ['edugnay:attendance:', 'academix:attendance:'].find(item => value.startsWith(item));
    if (!prefix) return null;

    const token = value.slice(prefix.length).trim();
    return token && !token.includes(':') ? token : null;
  }

  async function generateAttendanceQrDataUrl(token) {
    const payload = getAttendanceQrPayload(token);
    if (!payload) return null;
    if (!globalThis.QRCode?.toDataURL) throw new Error('QR generation is unavailable.');

    return globalThis.QRCode.toDataURL(payload, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1f3a', light: '#ffffff' }
    });
  }

  function getParentStudentLinks() {
    return PARENT_STUDENT_LINKS.filter(link => link.schoolId === getActiveSchoolId());
  }

  function setParentStudentLinks(parentId, links = []) {
    const parent = getUserById(parentId);
    if (!parent || parent.role !== RECORD_VALUES.roles.PARENT) return [];

    for (let index = PARENT_STUDENT_LINKS.length - 1; index >= 0; index -= 1) {
      if (PARENT_STUDENT_LINKS[index].parentId === parent.id) PARENT_STUDENT_LINKS.splice(index, 1);
    }

    const normalizedLinks = links
      .map(link => ({
        studentId: String(link?.studentId || ''),
        relationship: PARENT_RELATIONSHIPS.includes(String(link?.relationship || '').trim().toLowerCase())
          ? String(link.relationship).trim().toLowerCase()
          : null
      }))
      .filter(link => USERS.some(user => (
        user.id === link.studentId &&
        user.role === RECORD_VALUES.roles.STUDENT &&
        user.schoolId === parent.schoolId
      )))
      .filter((link, index, records) => (
        records.findIndex(record => record.studentId === link.studentId) === index
      ));

    normalizedLinks.forEach(link => PARENT_STUDENT_LINKS.push({
        id: `parent-student-${parent.id}-${link.studentId}`,
        schoolId: parent.schoolId,
        parentId: parent.id,
        studentId: link.studentId,
        relationship: link.relationship
      }));

    writeJson(PARENT_STUDENT_LINK_STORAGE_KEY, PARENT_STUDENT_LINKS);
    return getParentStudentLinks();
  }

  function schoolEmailDomain(school = getActiveSchool()) {
    const schoolEmail = String(school?.email || '').trim().toLowerCase();
    if (schoolEmail.includes('@')) return schoolEmail.split('@').pop();

    const website = String(school?.website || '').trim();
    if (website) {
      try {
        return new URL(website.includes('://') ? website : `https://${website}`).hostname.replace(/^www\./, '');
      } catch {
        return website.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
      }
    }

    return `${school?.id || 'school'}.edugnay.local`;
  }

  function generateSchoolEmail(values = {}) {
    const role = ROLE_ALIASES[values.role] || values.role;
    const roleSuffix = {
      [RECORD_VALUES.roles.SCHOOL_ADMIN]: 'adm',
      [RECORD_VALUES.roles.TEACHER]: 'fac',
      [RECORD_VALUES.roles.STUDENT]: 'stud',
      [RECORD_VALUES.roles.PARENT]: 'parents'
    }[role];
    const firstName = String(values.firstName || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    const lastName = String(values.lastName || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!firstName || !lastName || !roleSuffix) return '';

    const domain = schoolEmailDomain();
    const base = `${firstName.charAt(0)}.${lastName}.${roleSuffix}`;
    const existingEmails = new Set(USERS
      .filter(user => user.id !== String(values.userId || ''))
      .map(user => String(user.schoolEmail || '').trim().toLowerCase())
      .filter(Boolean));

    let localPart = base;
    let candidate = `${localPart}@${domain}`;
    let suffix = 2;
    while (existingEmails.has(candidate)) {
      localPart = `${base}${suffix}`;
      candidate = `${localPart}@${domain}`;
      suffix += 1;
    }
    return candidate;
  }

  function createUser(values = {}) {
    const role = ROLE_ALIASES[values.role] || values.role || RECORD_VALUES.roles.STUDENT;
    const firstName = String(values.firstName || '').trim();
    const lastName = String(values.lastName || '').trim();
    const displayName = String(values.displayName || values.name || [values.honorific, firstName, lastName].filter(Boolean).join(' ')).trim();
    const isStudent = role === RECORD_VALUES.roles.STUDENT;
    const isStaff = role === RECORD_VALUES.roles.SCHOOL_ADMIN || role === RECORD_VALUES.roles.TEACHER;
    const schoolId = values.schoolId || getActiveSchoolId();
    const lrn = isStudent ? String(values.lrn || '').trim() : null;
    const requestedSchoolEmail = String(values.schoolEmail || '').trim().toLowerCase()
      || generateSchoolEmail({ ...values, role });
    const personalEmail = String(values.personalEmail || '').trim().toLowerCase() || null;

    if (requestedSchoolEmail && USERS.some(user => (
      user.schoolId === schoolId
      && String(user.schoolEmail || '').trim().toLowerCase() === requestedSchoolEmail
    ))) {
      throw new Error('That school email is already assigned to another account.');
    }
    if (personalEmail && USERS.some(user => (
      user.schoolId === schoolId
      && String(user.personalEmail || '').trim().toLowerCase() === personalEmail
    ))) {
      throw new Error('That personal email is already assigned to another account.');
    }

    if (isStudent && !LRN_PATTERN.test(lrn)) {
      throw new Error('LRN must contain exactly 12 digits.');
    }
    if (isStudent && USERS.some(user => (
      user.schoolId === schoolId
      && user.role === RECORD_VALUES.roles.STUDENT
      && String(user.lrn || '').trim() === lrn
    ))) {
      throw new Error('That LRN is already assigned to another student account.');
    }

    const user = {
      id: String(values.studentId || values.id || `${role}-${Date.now()}`),
      schoolId,
      role,
      schoolEmail: requestedSchoolEmail,
      personalEmail,
      status: values.status || RECORD_VALUES.statuses.ACTIVE,
      createdAt: values.createdAt || new Date().toISOString(),
      honorific: isStaff ? values.honorific ?? null : null,
      firstName,
      lastName,
      displayName,
      initials: values.initials || getInitials([firstName, lastName].filter(Boolean).join(' ')),
      employeeNo: isStaff
        ? values.employeeNo ?? null
        : null,
      lrn,
      schoolLevel: isStudent ? values.schoolLevel ?? values.level ?? null : null,
      gradeLevel: isStudent ? values.gradeLevel ?? values.grade ?? null : null,
      strand: isStudent ? values.strand ?? null : null,
      sectionId: isStudent ? values.sectionId ?? null : null,
      attendanceQrToken: isStudent ? createAttendanceQrToken() : null
    };

    USERS.push(user);
    saveUsers();
    if (values.profile && typeof values.profile === 'object') updateUserProfile(user.id, values.profile);
    if (role === RECORD_VALUES.roles.PARENT && Array.isArray(values.parentLinks)) {
      setParentStudentLinks(user.id, values.parentLinks);
    }
    return user;
  }

  async function importUsers(accountRecords = []) {
    const allowedRoles = [
      RECORD_VALUES.roles.SCHOOL_ADMIN,
      RECORD_VALUES.roles.TEACHER,
      RECORD_VALUES.roles.STUDENT,
      RECORD_VALUES.roles.PARENT
    ];
    const activeSchoolId = getActiveSchoolId();
    const records = Array.isArray(accountRecords) ? accountRecords : [];

    if (!records.length) throw new Error('There are no accounts ready to import.');

    const existingEmails = new Set(USERS
      .filter(user => user.schoolId === activeSchoolId)
      .map(user => String(user.personalEmail || '').trim().toLowerCase())
      .filter(Boolean));
    const existingEmployeeNumbers = new Set(USERS
      .filter(user => (
        user.schoolId === activeSchoolId
        && [RECORD_VALUES.roles.SCHOOL_ADMIN, RECORD_VALUES.roles.TEACHER].includes(user.role)
      ))
      .map(user => String(user.employeeNo || '').trim().toUpperCase())
      .filter(Boolean));
    const existingLrns = new Set(USERS
      .filter(user => user.schoolId === activeSchoolId && user.role === RECORD_VALUES.roles.STUDENT)
      .map(user => String(user.lrn || '').trim())
      .filter(Boolean));
    const importedEmails = new Set();
    const importedEmployeeNumbers = new Set();
    const importedLrns = new Set();

    const normalizedRecords = records.map((record, index) => {
      const rowNumber = index + 1;
      const role = ROLE_ALIASES[String(record?.role || '').trim()] || String(record?.role || '').trim();
      const firstName = String(record?.firstName || '').trim();
      const lastName = String(record?.lastName || '').trim();
      const personalEmail = String(record?.personalEmail || '').trim().toLowerCase();

      if (!allowedRoles.includes(role)) throw new Error(`Import record ${rowNumber} has an invalid role.`);
      if (!firstName || !lastName) throw new Error(`Import record ${rowNumber} needs a first and last name.`);
      if (!/^\S+@\S+\.\S+$/.test(personalEmail)) {
        throw new Error(`Import record ${rowNumber} needs a valid personal email.`);
      }
      if (existingEmails.has(personalEmail) || importedEmails.has(personalEmail)) {
        throw new Error(`Import record ${rowNumber} uses a personal email that is already assigned.`);
      }
      importedEmails.add(personalEmail);

      const normalized = { firstName, lastName, personalEmail, role };
      const isStaff = [RECORD_VALUES.roles.SCHOOL_ADMIN, RECORD_VALUES.roles.TEACHER].includes(role);

      if (isStaff) {
        const employeeNo = String(record?.employeeNo || '').trim().toUpperCase();
        if (!employeeNo) throw new Error(`Import record ${rowNumber} needs an employee number.`);
        if (existingEmployeeNumbers.has(employeeNo) || importedEmployeeNumbers.has(employeeNo)) {
          throw new Error(`Import record ${rowNumber} uses an employee number that is already assigned.`);
        }
        importedEmployeeNumbers.add(employeeNo);
        normalized.employeeNo = employeeNo;
      }

      if (role === RECORD_VALUES.roles.STUDENT) {
        const lrn = String(record?.lrn || '').trim();
        if (!LRN_PATTERN.test(lrn)) {
          throw new Error(`Import record ${rowNumber} needs an LRN with exactly 12 digits.`);
        }
        if (existingLrns.has(lrn) || importedLrns.has(lrn)) {
          throw new Error(`Import record ${rowNumber} uses an LRN that is already assigned.`);
        }
        importedLrns.add(lrn);
        normalized.lrn = lrn;
      }

      if (role === RECORD_VALUES.roles.PARENT) {
        const links = Array.isArray(record?.parentLinks) ? record.parentLinks : [];
        if (!links.length) throw new Error(`Import record ${rowNumber} needs at least one linked student.`);

        const linkedStudentIds = new Set();
        normalized.parentLinks = links.map(link => {
          const studentId = String(link?.studentId || '').trim();
          const relationship = String(link?.relationship || '').trim().toLowerCase();
          const student = USERS.find(user => (
            user.id === studentId
            && user.schoolId === activeSchoolId
            && user.role === RECORD_VALUES.roles.STUDENT
          ));

          if (!student) throw new Error(`Import record ${rowNumber} references a student that was not found.`);
          if (!PARENT_RELATIONSHIPS.includes(relationship)) {
            throw new Error(`Import record ${rowNumber} has an invalid parent relationship.`);
          }
          if (linkedStudentIds.has(studentId)) {
            throw new Error(`Import record ${rowNumber} links the same student more than once.`);
          }
          linkedStudentIds.add(studentId);
          return { studentId, relationship };
        });
      }

      return normalized;
    });

    const usedIds = new Set(USERS.map(user => String(user.id)));
    const usedSchoolEmails = new Set(USERS
      .map(user => String(user.schoolEmail || '').trim().toLowerCase())
      .filter(Boolean));
    const createdUsers = [];
    const createdLinks = [];
    let idSeed = Date.now();

    normalizedRecords.forEach(record => {
      let id = `${record.role}-${idSeed++}`;
      while (usedIds.has(id)) id = `${record.role}-${idSeed++}`;
      usedIds.add(id);

      let schoolEmail = generateSchoolEmail({
        firstName: record.firstName,
        lastName: record.lastName,
        role: record.role
      });
      const [localPart, domain] = schoolEmail.split('@');
      let emailSuffix = 2;
      while (usedSchoolEmails.has(schoolEmail)) {
        schoolEmail = `${localPart}${emailSuffix}@${domain}`;
        emailSuffix += 1;
      }
      usedSchoolEmails.add(schoolEmail);

      const isStudent = record.role === RECORD_VALUES.roles.STUDENT;
      const isStaff = [RECORD_VALUES.roles.SCHOOL_ADMIN, RECORD_VALUES.roles.TEACHER].includes(record.role);
      const user = {
        id,
        schoolId: activeSchoolId,
        role: record.role,
        schoolEmail,
        personalEmail: record.personalEmail,
        status: RECORD_VALUES.statuses.ACTIVE,
        createdAt: new Date().toISOString(),
        honorific: null,
        firstName: record.firstName,
        lastName: record.lastName,
        displayName: `${record.firstName} ${record.lastName}`.trim(),
        initials: getInitials(`${record.firstName} ${record.lastName}`),
        employeeNo: isStaff ? record.employeeNo : null,
        lrn: isStudent ? record.lrn : null,
        schoolLevel: null,
        gradeLevel: null,
        strand: null,
        sectionId: null,
        attendanceQrToken: isStudent ? createAttendanceQrToken() : null
      };

      createdUsers.push(user);
      if (record.role === RECORD_VALUES.roles.PARENT) {
        record.parentLinks.forEach(link => createdLinks.push({
          id: `parent-student-${id}-${link.studentId}`,
          schoolId: activeSchoolId,
          parentId: id,
          studentId: link.studentId,
          relationship: link.relationship
        }));
      }
    });

    const previousUsers = USERS.slice();
    const previousLinks = PARENT_STUDENT_LINKS.slice();
    try {
      USERS.push(...createdUsers);
      PARENT_STUDENT_LINKS.push(...createdLinks);
      saveUsers();
      writeJson(PARENT_STUDENT_LINK_STORAGE_KEY, PARENT_STUDENT_LINKS);
    } catch (error) {
      USERS.splice(0, USERS.length, ...previousUsers);
      PARENT_STUDENT_LINKS.splice(0, PARENT_STUDENT_LINKS.length, ...previousLinks);
      try {
        saveUsers();
        writeJson(PARENT_STUDENT_LINK_STORAGE_KEY, PARENT_STUDENT_LINKS);
      } catch {
        // Keep the original import error when storage rollback is unavailable.
      }
      throw new Error('The accounts could not be imported.');
    }

    return {
      accounts: createdUsers,
      accountCount: createdUsers.length,
      relationshipCount: createdLinks.length
    };
  }

  function updateUser(userId, values = {}) {
    const user = getUserById(userId);
    if (!user) return null;

    const nextRole = Object.hasOwn(values, 'role')
      ? ROLE_ALIASES[values.role] || values.role
      : user.role;
    const nextLrn = nextRole === RECORD_VALUES.roles.STUDENT
      ? String(Object.hasOwn(values, 'lrn') ? values.lrn : user.lrn || '').trim()
      : null;
    const nextSchoolEmail = Object.hasOwn(values, 'schoolEmail')
      ? String(values.schoolEmail || '').trim().toLowerCase()
      : String(user.schoolEmail || '').trim().toLowerCase();
    const nextPersonalEmail = Object.hasOwn(values, 'personalEmail')
      ? String(values.personalEmail || '').trim().toLowerCase()
      : String(user.personalEmail || '').trim().toLowerCase();

    if (nextSchoolEmail && USERS.some(item => (
      item.id !== user.id
      && item.schoolId === user.schoolId
      && String(item.schoolEmail || '').trim().toLowerCase() === nextSchoolEmail
    ))) {
      throw new Error('That school email is already assigned to another account.');
    }
    if (nextPersonalEmail && USERS.some(item => (
      item.id !== user.id
      && item.schoolId === user.schoolId
      && String(item.personalEmail || '').trim().toLowerCase() === nextPersonalEmail
    ))) {
      throw new Error('That personal email is already assigned to another account.');
    }
    const shouldValidateLrn = nextRole === RECORD_VALUES.roles.STUDENT
      && (Object.hasOwn(values, 'lrn') || nextRole !== user.role);

    if (shouldValidateLrn && !LRN_PATTERN.test(nextLrn)) {
      throw new Error('LRN must contain exactly 12 digits.');
    }
    if (shouldValidateLrn && USERS.some(item => (
      item.id !== user.id
      && item.schoolId === user.schoolId
      && item.role === RECORD_VALUES.roles.STUDENT
      && String(item.lrn || '').trim() === nextLrn
    ))) {
      throw new Error('That LRN is already assigned to another student account.');
    }

    const fields = [
      'role', 'schoolEmail', 'personalEmail', 'status', 'honorific', 'firstName', 'lastName',
      'displayName', 'initials', 'employeeNo', 'lrn', 'schoolLevel',
      'gradeLevel', 'strand', 'sectionId'
    ];
    fields.forEach(field => {
      if (!Object.hasOwn(values, field)) return;
      if (field === 'role') user.role = nextRole;
      else if (field === 'schoolEmail') {
        user.schoolEmail = nextSchoolEmail;
      }
      else if (field === 'personalEmail') user.personalEmail = String(values.personalEmail || '').trim().toLowerCase() || null;
      else if (field === 'lrn') user.lrn = nextLrn;
      else user[field] = values[field];
    });

    if (Object.hasOwn(values, 'firstName') || Object.hasOwn(values, 'lastName')) {
      if (!Object.hasOwn(values, 'displayName')) {
        user.displayName = [user.honorific, user.firstName, user.lastName].filter(Boolean).join(' ');
      }
      user.initials = getInitials([user.firstName, user.lastName].filter(Boolean).join(' '));
    }

    const isStudent = user.role === RECORD_VALUES.roles.STUDENT;
    const isStaff = user.role === RECORD_VALUES.roles.SCHOOL_ADMIN || user.role === RECORD_VALUES.roles.TEACHER;
    user.honorific = isStaff ? user.honorific ?? null : null;
    user.employeeNo = isStaff ? user.employeeNo ?? null : null;
    user.lrn = isStudent
      ? (Object.hasOwn(values, 'lrn') ? nextLrn : (user.lrn ?? null))
      : null;
    user.schoolLevel = isStudent ? user.schoolLevel ?? null : null;
    user.gradeLevel = isStudent ? user.gradeLevel ?? null : null;
    user.strand = isStudent ? user.strand ?? null : null;
    user.sectionId = isStudent ? user.sectionId ?? null : null;
    user.attendanceQrToken = isStudent
      ? (String(user.attendanceQrToken || '').trim() || createAttendanceQrToken())
      : null;

    saveUsers();
    if (values.profile && typeof values.profile === 'object') updateUserProfile(user.id, values.profile);
    if (user.role === RECORD_VALUES.roles.PARENT && Array.isArray(values.parentLinks)) {
      setParentStudentLinks(user.id, values.parentLinks);
    }
    return user;
  }

  function getUserProfile(userId) {
    const user = getUserById(userId);
    if (!user) return null;
    const stored = USER_PROFILES.find(profile => profile.userId === user.id);
    return normalizeUserProfile(user.id, stored || {});
  }

  function updateUserProfile(userId, values = {}) {
    const user = getUserById(userId);
    if (!user) return null;

    const index = USER_PROFILES.findIndex(profile => profile.userId === user.id);
    const current = getUserProfile(user.id);
    const next = normalizeUserProfile(user.id, {
      ...current,
      ...values,
      schoolId: user.schoolId,
      updatedAt: new Date().toISOString()
    });

    if (index >= 0) USER_PROFILES[index] = next;
    else USER_PROFILES.push(next);
    saveUserProfiles();
    return next;
  }

  function getMissingProfileFields(userId, values = {}) {
    const user = getUserById(userId);
    const profile = getUserProfile(userId);
    if (!user || !profile) return [];

    const setupRoles = [RECORD_VALUES.roles.STUDENT, RECORD_VALUES.roles.PARENT];
    if (!setupRoles.includes(user.role)) return [];

    const candidateProfile = normalizeUserProfile(user.id, { ...profile, ...values });
    const personalEmail = Object.hasOwn(values, 'personalEmail')
      ? String(values.personalEmail || '').trim()
      : String(user.personalEmail || '').trim();

    const missing = [];
    if (!personalEmail) missing.push('personalEmail');
    if (!candidateProfile.middleName && !candidateProfile.hasNoMiddleName) missing.push('middleName');
    if (user.role === RECORD_VALUES.roles.STUDENT) {
      ['sex', 'birthDate', 'birthPlace', 'birthCountry', 'motherTongue', 'indigenousGroup', 'religion', 'houseStreet', 'barangay', 'cityMunicipality', 'province']
        .forEach(field => { if (!candidateProfile[field]) missing.push(field); });
    }
    if (user.role === RECORD_VALUES.roles.PARENT) {
      ['sex', 'religion', 'contactNumber', 'houseStreet', 'barangay', 'cityMunicipality', 'province']
        .forEach(field => { if (!candidateProfile[field]) missing.push(field); });
      const isMother = PARENT_STUDENT_LINKS.some(link => (
        link.parentId === user.id && link.relationship === 'mother'
      ));
      if (isMother && !candidateProfile.maidenLastName && !candidateProfile.hasNoMaidenName) missing.push('maidenLastName');
    }
    return missing;
  }

  function isProfileSetupRequired(userId) {
    const user = getUserById(userId);
    const profile = getUserProfile(userId);
    if (!user || !profile) return false;
    return !profile.profileCompletedAt || getMissingProfileFields(user.id).length > 0;
  }

  async function completeProfileSetup(userId, values = {}) {
    const user = getUserById(userId);
    if (!user) throw new Error('Profile account not found.');

    const missing = getMissingProfileFields(user.id, values);
    if (missing.length) {
      const error = new Error('Please complete all required profile fields.');
      error.fields = missing;
      throw error;
    }

    const personalEmail = Object.hasOwn(values, 'personalEmail')
      ? String(values.personalEmail || '').trim().toLowerCase()
      : String(user.personalEmail || '').trim().toLowerCase();
    updateUser(user.id, { personalEmail });
    return updateUserProfile(user.id, {
      ...values,
      profileCompletedAt: new Date().toISOString()
    });
  }

  function enforceProfileSetup(userId, profilePage) {
    if (!isProfileSetupRequired(userId)) return false;

    const currentPage = window.location.pathname.split('/').pop().toLowerCase();
    const targetPage = String(profilePage || '').split('/').pop().toLowerCase();
    if (!targetPage || currentPage === targetPage) return false;

    window.location.replace(`./${targetPage}?setup=required`);
    return true;
  }

  function deleteUser(userId) {
    const index = USERS.findIndex(user => user.id === String(userId));
    if (index < 0) return null;

    const [user] = USERS.splice(index, 1);
    saveUsers();
    return user;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' +
      date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function getReportAcademicContext(record, preferSnapshot = true) {
    const student = getUserById(record.studentId);
    const section = getAssignmentSections(getActiveSchool()).find(item => item.id === record.sectionId);
    return {
      schoolLevel: (preferSnapshot && record.schoolLevel) || student?.schoolLevel || section?.level || null,
      gradeLevel: (preferSnapshot && record.gradeLevel) || student?.gradeLevel || section?.grade || null,
      strand: (preferSnapshot && record.strand) || student?.strand || section?.strand || null
    };
  }

  function reportWithLabels(record, includeTeacherNote = true) {
    const student = getUserById(record.studentId);
    const teacher = getUserById(record.teacherId);
    const section = getAssignmentSections(getActiveSchool()).find(item => item.id === record.sectionId);
    const teacherName = teacher?.displayName || '';
    const academicContext = getReportAcademicContext(record);
    const reportData = { ...record };
    if (!includeTeacherNote) delete reportData.teacherNote;
    return {
      ...reportData,
      ...academicContext,
      studentName: student?.displayName || '',
      studentEmail: student?.schoolEmail || '',
      sectionLabel: section
        ? `${academicContext.gradeLevel || 'Grade level not available'} - ${section.name}`
        : '',
      teacherName,
      teacherInitials: record.teacherInitials || getInitials(teacherName),
      generatedAtLabel: formatDateTime(record.generatedAt),
      confirmedAtLabel: record.confirmedAt ? formatDateTime(record.confirmedAt) : ''
    };
  }

  function getReports() {
    return REPORT_DIRECTORY;
  }

  function getReportsForTeacher(teacherId, weekId = null) {
    const advisorySectionIds = getAssignmentSections()
      .filter(section => section.adviserId === String(teacherId))
      .map(section => section.id);

    return REPORT_DIRECTORY
      .filter(record => (
        record.teacherId === String(teacherId) &&
        advisorySectionIds.includes(record.sectionId) &&
        (!weekId || record.weekId === weekId)
      ))
      .sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0))
      .map(reportWithLabels);
  }

  function getReportsForStudent(studentId, confirmedOnly = false) {
    return REPORT_DIRECTORY
      .filter(record => record.studentId === String(studentId) && (!confirmedOnly || record.status === 'confirmed'))
      .sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0))
      .map(report => reportWithLabels(report, false));
  }

  function saveReports(records = REPORT_DIRECTORY) {
    writeJson(schoolStorageKey(STORAGE_KEYS.reports), Array.isArray(records) ? records : []);
  }

  function updateReport(reportId, values = {}) {
    const report = REPORT_DIRECTORY.find(record => record.id === String(reportId));
    if (!report) return null;
    const nextValues = { ...values };
    if (Object.prototype.hasOwnProperty.call(nextValues, 'recommendedActions')) {
      nextValues.recommendedActions = normalizeRecommendedActions(nextValues.recommendedActions);
    }
    Object.assign(report, nextValues);
    saveReports();
    return report;
  }

  // Narrative reports and recommendations intentionally remain frontend-only for now.
  async function generateReports(values = {}) {
    const sectionId = String(values.sectionId || '');
    const weekId = String(values.weekId || '');
    const teacherId = String(window.EDUGNAY_TEACHER_ACCESS?.teacherId || '');
    const section = getAssignmentSections().find(record => record.id === sectionId);
    const students = Array.isArray(values.students) ? values.students : [];
    const studentIds = new Set(
      getStudents()
        .filter(student => student.sectionId === sectionId)
        .map(student => String(student.id))
    );
    const notesByStudentId = new Map(
      students
        .map(student => [String(student?.studentId || ''), student?.teacherNote ? String(student.teacherNote).trim() : null])
        .filter(([studentId, teacherNote]) => studentId && studentIds.has(studentId) && (teacherNote === null || teacherNote.length <= 1000))
    );

    if (!section || section.adviserId !== teacherId || !notesByStudentId.size) return [];

    let changed = false;
    REPORT_DIRECTORY.forEach(report => {
      if (
        report.sectionId !== sectionId ||
        report.weekId !== weekId ||
        report.status === 'confirmed' ||
        !notesByStudentId.has(String(report.studentId))
      ) return;

      const academicContext = getReportAcademicContext({
        studentId: report.studentId,
        sectionId: report.sectionId
      }, false);
      const teacherNote = notesByStudentId.get(String(report.studentId));
      const recommendedActions = buildMockRecommendedActions({ ...report, ...academicContext });
      if (
        report.schoolLevel !== academicContext.schoolLevel ||
        report.gradeLevel !== academicContext.gradeLevel ||
        report.strand !== academicContext.strand ||
        report.teacherNote !== teacherNote ||
        JSON.stringify(report.recommendedActions) !== JSON.stringify(recommendedActions)
      ) {
        report.schoolLevel = academicContext.schoolLevel;
        report.gradeLevel = academicContext.gradeLevel;
        report.strand = academicContext.strand;
        report.teacherNote = teacherNote;
        report.recommendedActions = recommendedActions;
        changed = true;
      }
    });

    if (changed) saveReports();

    return REPORT_DIRECTORY
      .filter(report => report.sectionId === sectionId && report.weekId === weekId)
      .map(reportWithLabels);
  }

  function getHolidays(school = getActiveSchool()) {
    const schoolId = school?.id;
    if (!schoolId) return [];

    const saved = readJson(schoolStorageKey(STORAGE_KEYS.holidays, schoolId), null);
    const legacy = schoolId === 'scc' ? readJson(STORAGE_KEYS.holidays, null) : null;
    const source = Array.isArray(saved)
      ? saved
      : (Array.isArray(legacy) ? legacy : DEFAULT_HOLIDAYS);

    return source
      .map(record => ({ ...record, schoolId: record.schoolId || schoolId }))
      .filter(record => record.schoolId === schoolId);
  }

  function saveHolidays(holidays, school = getActiveSchool()) {
    const schoolId = school?.id;
    if (!schoolId) return;
    const records = Array.isArray(holidays)
      ? holidays.map(record => ({ ...record, schoolId }))
      : [];
    writeJson(schoolStorageKey(STORAGE_KEYS.holidays, schoolId), records);
  }

  function getNoClassDay(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const localDate = `${year}-${month}-${day}`;
    return getHolidays().find(holiday => holiday.date === localDate) || null;
  }

  let panelEmptyIconRenderQueued = false;

  function queuePanelEmptyIconRender() {
    if (panelEmptyIconRenderQueued || !window.lucide?.createIcons) return;
    panelEmptyIconRenderQueued = true;
    const render = () => {
      panelEmptyIconRenderQueued = false;
      window.lucide?.createIcons?.();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(render);
    else Promise.resolve().then(render);
  }

  /* Shared empty-state markup for data panels. Pages can replace the local
     arrays with API responses later without changing their empty-state UI. */
  function renderPanelEmptyState(options = {}) {
    const icon = String(options.icon || 'inbox').replace(/[^a-z0-9-]/gi, '');
    const title = String(options.title || 'Nothing to show yet');
    const text = String(options.text || 'Records will appear here when they are available.');

    queuePanelEmptyIconRender();
    return `<div class="panel-empty-state" role="status"><div class="panel-empty-state-icon" aria-hidden="true"><i data-lucide="${icon}"></i></div><div class="panel-empty-state-title">${escapeHtml(title)}</div><div class="panel-empty-state-text">${escapeHtml(text)}</div></div>`;
  }

  Object.assign(window.EDUGNAY_API, {
    getMaterials: getApiMaterials,
    uploadMaterial: uploadApiMaterial,
    updateMaterial: updateApiMaterial,
    deleteMaterial: deleteApiMaterial,
    materialFileUrl: apiMaterialFileUrl,
    getSections: getApiSections,
    getSectionStudents: getApiSectionStudents,
    getSectionStudentDetails: getApiSectionStudentDetails,
    getSectionTeachers: getApiSectionTeachers,
    getSubjects: getApiSubjects,
    createSection: createApiSection,
    updateSection: updateApiSection,
    deleteSection: deleteApiSection,
    createSubject: createApiSubject,
    updateSubject: updateApiSubject,
    deleteSubject: deleteApiSubject,
    enrollStudent: enrollApiStudent,
    moveStudent: moveApiStudent,
    withdrawStudent: withdrawApiStudent,
    assignTeacher: assignApiTeacher,
    removeTeacherAssignment: removeApiTeacherAssignment,
    updateTeacherAssignment: updateApiTeacherAssignment
  });

  window.EDUGNAY_CONFIG = {
    values: RECORD_VALUES,
    getActiveSchoolId,
    scopeToActiveSchool,
    withActiveSchool,
    grades: GRADE_CATALOG,
    createDivision,
    subjects: SUBJECT_CATALOG,
    parentRelationships: PARENT_RELATIONSHIPS,
    parentStudentLinks: PARENT_STUDENT_LINKS,
    getUsers,
    getUsersByRole,
    getStudents,
    getUserById,
    getStudentByAttendanceQrToken,
    regenerateStudentAttendanceQr,
    prepareCredentialDelivery,
    parseAttendanceQrPayload,
    generateAttendanceQrDataUrl,
    getUserProfile,
    updateUserProfile,
    getMissingProfileFields,
    isProfileSetupRequired,
    completeProfileSetup,
    enforceProfileSetup,
    getParentStudentLinks,
    createUser,
    importUsers,
    generateSchoolEmail,
    updateUser,
    deleteUser,
    saveUsers,
    setParentStudentLinks,
    academicPeriodTypes: ACADEMIC_PERIOD_TYPES,
    academicPeriodStatuses: ACADEMIC_PERIOD_STATUSES,
    createAcademicPeriods,
    getAcademicPeriods,
    getCurrentAcademicPeriod,
    getAcademicTermConfig,
    validateAcademicTermConfig,
    saveAcademicTermConfig,
    startAcademicPeriod,
    getAcademicPeriodCloseReadiness,
    closeAcademicPeriod,
    extendAcademicPeriod,
    getAcademicPeriodReminder,
    attendanceDefaults: makeAttendanceRules(),
    attendance: ATTENDANCE_DIRECTORY,
    getAttendanceRecords,
    getAttendanceForStudent,
    upsertAttendanceRecords,
    getSchools,
    saveSchools,
    updateSchool,
    getActiveSchool,
    getSchoolTypeInfo,
    buildFinalGradeYears: buildApiFinalGradeYears,
    gradeScoreClass,
    isGradesPageEnabled,
    isNarrativeReportsEnabled,
    getSubjectAssignments,
    saveSubjectAssignments,
    getConfiguredSubjects,
    getJournalSubject,
    isJournalsEnabled,
    getAssignmentSections,
    getSections,
    updateSection,
    getMyTeachingSections,
    getMyAdvisorySections,
    getSfTemplates,
    getSfTemplatePreview,
    downloadSfTemplate,
    downloadBlankCombinedSfTemplates,
    generateSfForm,
    generateCombinedSfForms,
    exportSfForm,
    exportCombinedSfForms,
    assignments: ASSIGNMENT_DIRECTORY,
    getAssignments,
    getAssignmentsForSection,
    getAssignmentsForStudent,
    saveAssignments,
    createAssignment,
    updateAssignment,
    getAssignmentSubmissions,
    saveAssignmentSubmissions,
    submitAssignment,
    getAssignmentStatuses,
    saveAssignmentStatuses,
    setAssignmentStatus,
    learningMaterials: LEARNING_MATERIAL_DIRECTORY,
    getLearningMaterials,
    getLearningMaterialsForSection,
    getLearningMaterialsForStudent,
    saveLearningMaterials,
    createLearningMaterial,
    reports: REPORT_DIRECTORY,
    getReports,
    getReportsForTeacher,
    getReportsForStudent,
    saveReports,
    updateReport,
    generateReports,
    formatDateTime,
    getNotificationReadIds,
    saveNotificationReadIds,
    applyNotificationReadState,
    markNotificationRead,
    markAllNotificationsRead,
    formatDateGroup,
    formatTime,
    formatRelativeTime,
    announcements: ANNOUNCEMENT_DIRECTORY,
    getAnnouncements,
    getAllAnnouncements,
    saveAnnouncements,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    getHolidays,
    saveHolidays,
    getNoClassDay,
    escapeHtml,
    isRecorded,
    getInitials,
    renderPanelEmptyState
  };
})();

/* Shared searchable select enhancement. The native select stays in the form
   as the source of truth, while the visible combobox makes long user lists
   easier to browse and search. Replace the option source with API data later
   without changing the form field contract. */
(function initializeSearchableSelectSupport() {
  const states = new WeakMap();

  function normalize(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  function getOptionRecords(state) {
    return Array.from(state.select.options)
      .map(option => ({
        value: option.value,
        label: option.textContent.trim(),
        disabled: option.disabled
      }))
      .filter(option => option.value && option.label);
  }

  function initialsFor(label) {
    const words = String(label || '').split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map(word => word[0]).join('').toUpperCase() || '?';
  }

  function splitOptionLabel(label) {
    const parts = String(label || '').split(/\s*[\u00b7\u2022]\s*/);
    return {
      main: parts.shift() || label,
      meta: parts.join(' · ')
    };
  }

  function syncInput(state) {
    const selected = getOptionRecords(state).find(option => option.value === state.select.value);
    state.input.disabled = state.select.disabled;
    state.input.required = state.required;
    state.input.setAttribute('aria-required', String(state.required));
    state.wrapper.classList.toggle('is-disabled', state.select.disabled);

    if (!state.open) {
      state.input.value = selected?.label || '';
      state.input.placeholder = state.placeholder;
    }
  }

  function setActiveOption(state, index) {
    const options = Array.from(state.menu.querySelectorAll('.searchable-select-option'));
    if (!options.length) {
      state.activeIndex = -1;
      state.input.removeAttribute('aria-activedescendant');
      return;
    }

    state.activeIndex = state.activeIndex < 0
      ? (index < 0 ? options.length - 1 : 0)
      : (index + options.length) % options.length;
    options.forEach((option, optionIndex) => {
      const active = optionIndex === state.activeIndex;
      option.classList.toggle('is-active', active);
      if (active) state.input.setAttribute('aria-activedescendant', option.id);
    });
    options[state.activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function renderOptions(state, query = '') {
    const term = normalize(query);
    const options = getOptionRecords(state).filter(option => (
      !option.disabled && (!term || normalize(option.label).includes(term))
    ));

    state.visibleOptions = options;
    state.activeIndex = -1;
    state.menu.innerHTML = '';
    state.input.removeAttribute('aria-activedescendant');

    if (!options.length) {
      const empty = document.createElement('div');
      empty.className = 'searchable-select-empty';
      empty.textContent = term ? state.emptyText : 'No options available';
      state.menu.appendChild(empty);
      return;
    }

    options.forEach((option, index) => {
      const item = document.createElement('div');
      const copy = splitOptionLabel(option.label);
      item.className = 'searchable-select-option';
      item.id = `${state.menu.id}-option-${index}`;
      item.dataset.value = option.value;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.value === state.select.value));
      if (option.value === state.select.value) item.classList.add('is-selected');

      const avatar = document.createElement('span');
      avatar.className = 'searchable-select-option-avatar';
      avatar.textContent = initialsFor(copy.main);

      const text = document.createElement('span');
      text.className = 'searchable-select-option-copy';

      const main = document.createElement('span');
      main.className = 'searchable-select-option-main';
      main.textContent = copy.main;
      text.appendChild(main);

      if (copy.meta) {
        const meta = document.createElement('span');
        meta.className = 'searchable-select-option-meta';
        meta.textContent = copy.meta;
        text.appendChild(meta);
      }

      item.append(avatar, text);
      item.addEventListener('mousedown', event => event.preventDefault());
      item.addEventListener('click', () => chooseOption(state, option.value));
      state.menu.appendChild(item);
    });
  }

  function openSelect(state) {
    if (state.select.disabled) return;
    if (!state.open) {
      state.open = true;
      state.wrapper.classList.add('is-open');
      state.input.setAttribute('aria-expanded', 'true');
      state.input.placeholder = state.searchPlaceholder;
      state.input.value = '';
      renderOptions(state, '');
    }
  }

  function closeSelect(state) {
    state.open = false;
    state.wrapper.classList.remove('is-open');
    state.input.setAttribute('aria-expanded', 'false');
    state.input.removeAttribute('aria-activedescendant');
    syncInput(state);
  }

  function chooseOption(state, value) {
    const option = getOptionRecords(state).find(record => record.value === value);
    if (!option || option.disabled) return;
    state.select.value = option.value;
    state.select.dispatchEvent(new Event('change', { bubbles: true }));
    closeSelect(state);
  }

  function handleKeydown(state, event) {
    if (event.key === 'Escape') {
      if (state.open) {
        event.preventDefault();
        closeSelect(state);
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openSelect(state);
      setActiveOption(state, state.activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }

    if (event.key === 'Enter' && state.open) {
      const option = state.visibleOptions[state.activeIndex >= 0 ? state.activeIndex : 0];
      if (option) {
        event.preventDefault();
        chooseOption(state, option.value);
      }
    }
  }

  function createSearchableSelect(selectOrSelector, settings = {}) {
    const select = typeof selectOrSelector === 'string'
      ? document.querySelector(selectOrSelector)
      : selectOrSelector;
    if (!select || select.tagName !== 'SELECT') return null;
    if (states.has(select)) return states.get(select);

    const wrapper = document.createElement('div');
    const control = document.createElement('div');
    const input = document.createElement('input');
    const menu = document.createElement('div');
    const baseId = select.id || `searchable-select-${Math.random().toString(36).slice(2)}`;

    wrapper.className = 'searchable-select';
    wrapper.dataset.searchableSelect = 'true';
    control.className = 'searchable-select-control';
    input.className = 'searchable-select-input';
    input.type = 'text';
    input.id = settings.inputId || `${baseId}-search`;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', `${baseId}-options`);
    input.setAttribute('aria-label', settings.ariaLabel || select.getAttribute('aria-label') || 'Select an option');

    menu.className = 'searchable-select-menu';
    menu.id = `${baseId}-options`;
    menu.setAttribute('role', 'listbox');

    const state = {
      select,
      wrapper,
      input,
      menu,
      placeholder: settings.placeholder || select.options[0]?.textContent.trim() || 'Select an option',
      searchPlaceholder: settings.searchPlaceholder || 'Search options...',
      emptyText: settings.emptyText || 'No matching options',
      required: select.required,
      open: false,
      activeIndex: -1,
      visibleOptions: []
    };

    select.classList.add('searchable-select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    /* Let the visible combobox own native validation while the original
       select remains available for form submission and backend integration. */
    select.required = false;
    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(control, select, menu);
    control.appendChild(input);

    input.addEventListener('focus', () => openSelect(state));
    input.addEventListener('click', () => openSelect(state));
    input.addEventListener('input', () => {
      openSelect(state);
      renderOptions(state, input.value);
    });
    input.addEventListener('keydown', event => handleKeydown(state, event));
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (!wrapper.contains(document.activeElement)) closeSelect(state);
      }, 0);
    });
    select.addEventListener('change', () => {
      syncInput(state);
      if (state.open) renderOptions(state, input.value);
    });
    document.addEventListener('click', event => {
      if (!wrapper.contains(event.target)) closeSelect(state);
    });

    if ('MutationObserver' in window) {
      const observer = new MutationObserver(() => {
        syncInput(state);
        if (state.open) renderOptions(state, input.value);
      });
      observer.observe(select, {
        attributes: true,
        attributeFilter: ['disabled'],
        childList: true,
        subtree: true
      });
      state.observer = observer;
    }

    states.set(select, state);
    syncInput(state);
    return state;
  }

  window.initSearchableSelect = createSearchableSelect;
  window.syncSearchableSelect = function syncSearchableSelect(selectOrSelector) {
    const select = typeof selectOrSelector === 'string'
      ? document.querySelector(selectOrSelector)
      : selectOrSelector;
    const state = select && states.get(select);
    if (!state) return;
    syncInput(state);
    if (state.open) renderOptions(state, state.input.value);
  };
})();

function toggleNotifDropdown() {
  const panel = document.getElementById('tbNotifPanel');
  if (!panel) return;
  panel.classList.toggle('open');
  if (panel.classList.contains('open') && typeof window.EDUGNAY_REFRESH_NOTIFICATIONS === 'function') {
    void window.EDUGNAY_REFRESH_NOTIFICATIONS();
  }
}

function markAllNotifRead() {
  markCurrentNotificationsRead().finally(() => {
    if (typeof renderTopbarNotifs === 'function') renderTopbarNotifs();
  });
}

function getProfileControls() {
  return {
    trigger: document.getElementById('tbProfileTrigger'),
    dropdown: document.getElementById('tbProfileDropdown')
  };
}

function initToastSoundToggle() {
  const { dropdown } = getProfileControls();
  if (!dropdown || dropdown.querySelector('#tbToastSoundToggle')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'tbToastSoundToggle';
  button.className = 'tb-dropdown-item tb-sound-toggle';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-label', 'Toast sounds');
  button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path></svg><span>Toast sounds</span><span class="tb-sound-state" aria-hidden="true"></span>';

  const supported = Boolean(window.AudioContext || window.webkitAudioContext);
  button.disabled = !supported;
  button.setAttribute('aria-checked', String(supported && toastSoundsEnabled));
  button.querySelector('.tb-sound-state').textContent = supported ? (toastSoundsEnabled ? 'On' : 'Off') : 'Unavailable';
  button.addEventListener('click', () => {
    toastSoundsEnabled = !toastSoundsEnabled;
    button.setAttribute('aria-checked', String(toastSoundsEnabled));
    button.querySelector('.tb-sound-state').textContent = toastSoundsEnabled ? 'On' : 'Off';
    try { localStorage.setItem(TOAST_SOUND_STORAGE_KEY, String(toastSoundsEnabled)); } catch {}
    if (toastSoundsEnabled) void playToastSound('success', 'Toast sounds enabled');
  });

  dropdown.insertBefore(button, dropdown.querySelector('.tb-dropdown-divider') || dropdown.querySelector('.tb-dropdown-item.danger'));
}

function toggleProfileDropdown(forceState) {
  const { trigger, dropdown } = getProfileControls();
  if (!trigger || !dropdown) return;
  const isOpen = forceState === undefined
    ? !dropdown.classList.contains('open')
    : forceState;
  dropdown.classList.toggle('open', isOpen);
  trigger.classList.toggle('open', isOpen);
  trigger.setAttribute('aria-expanded', String(isOpen));
}

function toggleDrawer(open) {
  const isOpen = open === undefined
    ? !document.body.classList.contains('drawer-open')
    : open;
  document.body.classList.toggle('drawer-open', isOpen);
  const overlay = document.querySelector('.sidebar-overlay');
  if (overlay) overlay.classList.toggle('open', isOpen);
  refreshSidebarScrollbars();
}

async function confirmLogout() {
  if (EDUGNAY_API_BASE_URL) {
    try {
      await requestApi('/auth/logout', { method: 'POST' });
    } catch {
      // Clear the frontend session even when the server session has expired.
    }
  }

  try {
    sessionStorage.removeItem(EDUGNAY_SESSION_STORAGE_KEY);
  } catch {
    // Continue to the sign-in page when session storage is unavailable.
  }
  const isGitHubPages = location.hostname.endsWith('github.io');
  const BASE = isGitHubPages ? '/edugnay' : '';

  window.location.href = `${BASE}/index.html`;
}

function applyActiveSchoolToShell() {
  if (document.body?.dataset.platformPortal === 'true') return;

  const config = window.EDUGNAY_CONFIG;
  const school = window.EDUGNAY_API_SCHOOL_CONTEXT || config.getActiveSchool();
  if (!school) return;
  const typeLabel = config.getSchoolTypeInfo(school.schoolLevels).label;

  document.querySelectorAll('.brand-sub:not([data-platform-brand])').forEach(element => {
    element.textContent = school.shortName;
  });
  document.querySelectorAll('[data-school-name]').forEach(element => {
    element.textContent = school.name;
  });
  /* The body stores the active school type as metadata. Exclude it from
     content replacement so refreshing the context never wipes the page. */
  document.querySelectorAll('[data-school-type]:not(body)').forEach(element => {
    element.textContent = typeLabel;
  });
  document.querySelectorAll('[data-school-year]').forEach(element => {
    element.textContent = school.schoolYear;
  });
  document.querySelectorAll('[data-active-academic-period]').forEach(element => {
    const schoolLevel = element.dataset.schoolLevel || school.activeDivision;
    const activePeriod = config.getCurrentAcademicPeriod(school.id, schoolLevel);
    const activePeriodLabel = activePeriod
      ? `${activePeriod.name} · S.Y. ${school.schoolYear}`
      : `No active grading period · S.Y. ${school.schoolYear}`;
    element.textContent = activePeriodLabel;
  });
  document.querySelectorAll('[data-school-context]').forEach(element => {
    element.textContent = `${typeLabel} · ${school.schoolYear}`;
  });
  document.body.dataset.activeSchool = school.id;
  document.body.dataset.schoolType = school.schoolType;
  document.body.dataset.gradesPageEnabled = String(config.isGradesPageEnabled(school));
}

/* Keep the grade portal policy in one place so every student and parent page
   responds to the same school setting. The server should enforce this policy
   again after backend integration; this client guard is for the current
   frontend flow and prevents stale direct links from opening the page. */
function applyGradePortalAccess() {
  if (document.body?.dataset.platformPortal === 'true') return;

  const pageName = location.pathname.split('/').pop().toLowerCase();
  const isStudentOrParentPage = /edugnay-(student|parent)-/.test(pageName);
  if (!isStudentOrParentPage) return;

  const enabled = window.EDUGNAY_CONFIG.isGradesPageEnabled();
  const gradeLinks = document.querySelectorAll(
    'a[href*="edugnay-student-grades.html"], a[href*="edugnay-parent-grades.html"]'
  );

  gradeLinks.forEach(link => {
    link.hidden = !enabled;
    link.classList.toggle('is-grades-page-hidden', !enabled);
    link.setAttribute('aria-hidden', String(!enabled));
    if (!enabled) link.setAttribute('tabindex', '-1');
    else link.removeAttribute('tabindex');
  });

  if (!enabled && /edugnay-(student|parent)-grades\.html$/.test(pageName)) {
    const dashboard = pageName.includes('parent')
      ? 'edugnay-parent-dashboard.html'
      : 'edugnay-student-dashboard.html';
    window.location.replace(dashboard);
  }
}

window.refreshEdUgnayShellContext = function refreshEdUgnayShellContext() {
  applyActiveSchoolToShell();
  applyGradePortalAccess();
  applyPageTitleToTopbar();
};

function applyPageTitleToTopbar() {
  const heading = document.querySelector('.page-overview-title, .portal-overview-title');
  const navigation = document.querySelector('.nav-item.active .nav-label')
    || document.querySelector('.nav-group-toggle.active > span');
  const title = document.body?.dataset.pageTitle
    || heading?.textContent.trim()
    || navigation?.textContent.trim();
  if (!title) return;

  document.querySelectorAll('[data-page-title-target]').forEach(value => {
    value.textContent = title;
    const context = value.closest('.topbar-context, .admin-topbar-context');
    if (!context) return;
    context.setAttribute('aria-label', `${title} page`);
  });

  if (document.title === 'Academix') {
    document.title = `${title} | Academix`;
  }
}

/* Initialize the shared right-edge fade for every horizontally scrollable tab bar. */
function initScrollFades() {
  const selector = [
    '.child-switcher',
    '.onboarding-feature-tabs',
    '.activity-type-filters',
    '.subject-tab-bar',
    '.profile-tab-bar',
    '.mgmt-tabs',
    '.school-tabs',
    '.filter-tabs',
    '.tab-bar',
    '.cat-tabs',
    '.att-history-tabs',
    '.grade-tabs',
    '.mini-tab-bar',
    '.section-tab-bar'
  ].join(', ');

  document.querySelectorAll(selector).forEach(element => {
    if (element.dataset.scrollFadeReady === 'true') return;
    element.dataset.scrollFadeReady = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'scroll-fade-wrap';
    if (!element.classList.contains('child-switcher')) {
      wrapper.classList.add('tabs-fade', 'light-tabs-fade');
    }

    element.parentNode.insertBefore(wrapper, element);
    wrapper.appendChild(element);

    const isActivityFilters = element.classList.contains('activity-type-filters');
    const hasScrollButton = isActivityFilters || element.classList.contains('school-tabs');
    const scrollTarget = isActivityFilters ? 'activity categories' : 'school settings tabs';
    const scrollButtonSpace = isActivityFilters ? 40 : 0;
    let scrollButton = null;

    if (hasScrollButton) {
      scrollButton = document.createElement('button');
      scrollButton.type = 'button';
      scrollButton.className = 'scroll-fade-button';
      scrollButton.setAttribute('aria-label', `Scroll ${scrollTarget} right`);
      scrollButton.setAttribute('aria-controls', element.id);
      scrollButton.innerHTML = `
        <i class="scroll-fade-icon scroll-fade-icon-right" data-lucide="chevron-right" aria-hidden="true"></i>
        <i class="scroll-fade-icon scroll-fade-icon-left" data-lucide="chevron-left" aria-hidden="true"></i>
      `;
      wrapper.appendChild(scrollButton);
      window.lucide?.createIcons?.();

      scrollButton.addEventListener('click', () => {
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        if (scrollButton.dataset.direction === 'left') {
          element.scrollTo({ left: 0, behavior });
          return;
        }
        element.scrollBy({ left: Math.max(120, (element.clientWidth - scrollButtonSpace) * 0.8), behavior });
      });
    }

    const updateFade = () => {
      const isDesktop = hasScrollButton && window.matchMedia('(min-width: 761px)').matches;
      const hasReservedButtonSpace = isDesktop && wrapper.classList.contains('has-scroll-control');
      const reservedSpace = hasReservedButtonSpace ? scrollButtonSpace : 0;
      const contentOverflows = element.scrollWidth - element.clientWidth - reservedSpace > 4;

      if (hasScrollButton) {
        const showButton = isDesktop && contentOverflows;
        wrapper.classList.toggle('has-scroll-control', showButton);
        scrollButton.hidden = !showButton;

        const buttonSpace = showButton ? scrollButtonSpace : 0;
        const contentEnd = element.scrollWidth - element.clientWidth - buttonSpace;
        const atEnd = contentEnd - element.scrollLeft <= 4;
        scrollButton.dataset.direction = atEnd ? 'left' : 'right';
        scrollButton.setAttribute('aria-label', atEnd
          ? `Return to first ${scrollTarget}`
          : `Scroll ${scrollTarget} right`);

        wrapper.classList.toggle('has-more-right', contentEnd - element.scrollLeft > 4);
        return;
      }

      const hasMore = element.scrollWidth - element.clientWidth - element.scrollLeft > 4;
      wrapper.classList.toggle('has-more-right', hasMore);
    };

    updateFade();
    element.addEventListener('scroll', updateFade, { passive: true });
    if (hasScrollButton) window.addEventListener('resize', updateFade, { passive: true });
    if ('ResizeObserver' in window) {
      new ResizeObserver(updateFade).observe(element);
    } else {
      window.addEventListener('resize', updateFade);
    }
  });
}

/* Use a custom sidebar thumb so native track and arrow controls never appear. */
const sidebarScrollbarRefreshers = [];

function refreshSidebarScrollbars() {
  sidebarScrollbarRefreshers.forEach(refresh => refresh());
}

function initSidebarScrollbars() {
  const sidebars = Array.from(document.querySelectorAll('.sidebar'));
  if (!sidebars.length) return;

  sidebars.forEach(sidebar => {
    if (sidebar.dataset.customScrollbarReady === 'true') return;
    sidebar.dataset.customScrollbarReady = 'true';

    const scrollbar = document.createElement('div');
    scrollbar.className = 'sidebar-scrollbar';
    scrollbar.setAttribute('aria-hidden', 'true');

    const thumb = document.createElement('div');
    thumb.className = 'sidebar-scrollbar-thumb';
    scrollbar.appendChild(thumb);
    document.body.appendChild(scrollbar);

    let frame = 0;
    let dragging = false;
    let dragStartY = 0;
    let dragStartScrollTop = 0;

    const update = () => {
      frame = 0;

      const rect = sidebar.getBoundingClientRect();
      const scrollRange = sidebar.scrollHeight - sidebar.clientHeight;
      const visible = scrollRange > 1
        && rect.width > 0
        && rect.height > 0
        && rect.right > 0
        && rect.left < window.innerWidth
        && rect.bottom > 0
        && rect.top < window.innerHeight;

      scrollbar.classList.toggle('is-visible', visible);
      if (!visible) return;

      const railHeight = Math.max(1, Math.round(rect.height));
      const thumbHeight = Math.min(
        railHeight,
        Math.max(32, Math.round((sidebar.clientHeight / sidebar.scrollHeight) * railHeight))
      );
      const thumbRange = Math.max(0, railHeight - thumbHeight);
      const progress = scrollRange > 0 ? sidebar.scrollTop / scrollRange : 0;

      scrollbar.style.left = `${Math.round(rect.right - 8)}px`;
      scrollbar.style.top = `${Math.round(rect.top)}px`;
      scrollbar.style.height = `${railHeight}px`;
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.transform = `translateY(${Math.round(thumbRange * progress)}px)`;
    };

    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    const stopDragging = () => {
      dragging = false;
      scrollbar.classList.remove('is-dragging');
    };

    thumb.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      dragging = true;
      dragStartY = event.clientY;
      dragStartScrollTop = sidebar.scrollTop;
      scrollbar.classList.add('is-dragging');
      thumb.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    thumb.addEventListener('pointermove', event => {
      if (!dragging) return;
      const thumbRange = Math.max(1, scrollbar.clientHeight - thumb.offsetHeight);
      const scrollRange = sidebar.scrollHeight - sidebar.clientHeight;
      const delta = event.clientY - dragStartY;
      sidebar.scrollTop = dragStartScrollTop + (delta / thumbRange) * scrollRange;
      scheduleUpdate();
    });

    thumb.addEventListener('pointerup', stopDragging);
    thumb.addEventListener('pointercancel', stopDragging);
    thumb.addEventListener('lostpointercapture', stopDragging);

    scrollbar.addEventListener('pointerdown', event => {
      if (event.target === thumb) return;
      const railRect = scrollbar.getBoundingClientRect();
      const thumbRange = Math.max(1, railRect.height - thumb.offsetHeight);
      const scrollRange = sidebar.scrollHeight - sidebar.clientHeight;
      const target = Math.max(0, Math.min(
        thumbRange,
        event.clientY - railRect.top - (thumb.offsetHeight / 2)
      ));
      sidebar.scrollTop = (target / thumbRange) * scrollRange;
      scheduleUpdate();
    });

    sidebar.addEventListener('scroll', scheduleUpdate, { passive: true });
    sidebar.addEventListener('transitionend', event => {
      if (event.propertyName === 'transform') scheduleUpdate();
    });
    window.addEventListener('resize', scheduleUpdate, { passive: true });

    if ('ResizeObserver' in window) {
      new ResizeObserver(scheduleUpdate).observe(sidebar);
    }

    if ('MutationObserver' in window) {
      new MutationObserver(scheduleUpdate).observe(sidebar, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden']
      });
    }

    sidebarScrollbarRefreshers.push(scheduleUpdate);
    scheduleUpdate();
  });
}

document.addEventListener('click', event => {
  const { trigger, dropdown } = getProfileControls();
  if (trigger && dropdown && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
    toggleProfileDropdown(false);
  }

  const notifTrigger = document.getElementById('tbNotifTrigger');
  const notifPanel = document.getElementById('tbNotifPanel');
  if (notifTrigger && notifPanel && !notifTrigger.contains(event.target) && !notifPanel.contains(event.target)) {
    notifPanel.classList.remove('open');
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  initToastSoundToggle();
  let apiSession = null;
  if (EDUGNAY_API_BASE_URL) {
    try {
      apiSession = await getCurrentUser();
      applyCurrentUserToShell(apiSession);
    } catch (error) {
      if (error.status === 401) {
        try { sessionStorage.removeItem(EDUGNAY_SESSION_STORAGE_KEY); } catch {}
      }
    }
    if (apiSession?.apiSchoolId) {
      try {
        const portal = await getApiPortalFeatures();
        setApiPortalFeatures({ ...portal.features, journalSubjectId: portal.journalSubjectId, journalSubjectName: portal.journalSubjectName });
      } catch (error) {
        console.warn('Unable to load school portal features.', error.message);
      }
    }
  }
  applyCurrentDateToGradingBanners();
  applyActiveSchoolToShell();
  applyGradePortalAccess();
  applyPageTitleToTopbar();
  initScrollFades();
  initSidebarScrollbars();
});
