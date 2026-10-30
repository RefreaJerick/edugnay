/* Shared shell behavior for every portal role. */

const EDUGNAY_SESSION_STORAGE_KEY = 'edugnay_session';
const EDUGNAY_TEACHER_NAV_CACHE_PREFIX = 'edugnay_teacher_sidebar_v1:';
const EDUGNAY_STUDENT_NAV_CACHE_PREFIX = 'edugnay_student_sidebar_v1:';
const EDUGNAY_PARENT_NAV_CACHE_PREFIX = 'edugnay_parent_sidebar_v1:';
const EDUGNAY_PROFILE_DISPLAY_KEY = 'edugnay_profile_display_v1';
const EDUGNAY_LEGACY_STUDENT_PROFILE_DISPLAY_KEY = 'edugnay_student_profile_display_v1';
window.EDUGNAY_TEACHER_NAV_CACHE_PREFIX = EDUGNAY_TEACHER_NAV_CACHE_PREFIX;
window.EDUGNAY_STUDENT_NAV_CACHE_PREFIX = EDUGNAY_STUDENT_NAV_CACHE_PREFIX;
window.EDUGNAY_PARENT_NAV_CACHE_PREFIX = EDUGNAY_PARENT_NAV_CACHE_PREFIX;
const EDUGNAY_API_BASE_URL = String(window.EDUGNAY_APP_CONFIG?.apiBaseUrl || '').trim().replace(/\/+$/, '');
const TOAST_SOUND_STORAGE_KEY = 'edugnay_toast_sounds_enabled';

function clearTeacherSidebarCache() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(EDUGNAY_TEACHER_NAV_CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Continue authentication flows if session storage is unavailable.
  }
}

function clearStudentSidebarCache() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(EDUGNAY_STUDENT_NAV_CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Continue authentication flows if session storage is unavailable.
  }
}

function clearParentSidebarCache() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(EDUGNAY_PARENT_NAV_CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Continue authentication flows if session storage is unavailable.
  }
}

const EDUGNAY_PROFILE_ROLE_LABELS = {
  platform_admin: 'Platform Administrator',
  school_admin: 'Administrator',
  teacher: 'Faculty',
  student: 'Student',
  parent: 'Parent'
};

function getPortalRoleFromPath() {
  const match = location.pathname.match(/\/views\/(student|teacher|admin|parent|platform)\//i);
  if (!match) return null;
  const folder = match[1].toLowerCase();
  return folder === 'admin' ? 'school_admin' : folder === 'platform' ? 'platform_admin' : folder;
}

function clearProfileDisplaySnapshot() {
  try {
    sessionStorage.removeItem(EDUGNAY_PROFILE_DISPLAY_KEY);
    sessionStorage.removeItem(EDUGNAY_LEGACY_STUDENT_PROFILE_DISPLAY_KEY);
  } catch {}
  cachedProfileDisplaySnapshot = null;
}

function isValidProfileDisplaySnapshot(snapshot) {
  return snapshot?.version === 1
    && Object.hasOwn(EDUGNAY_PROFILE_ROLE_LABELS, snapshot.role)
    && Boolean(snapshot.userId)
    && (snapshot.role === 'platform_admin' || Boolean(snapshot.schoolId))
    && typeof snapshot.displayName === 'string' && Boolean(snapshot.displayName.trim())
    && typeof snapshot.initials === 'string'
    && (snapshot.avatarUrl === null || typeof snapshot.avatarUrl === 'string');
}

function readProfileDisplaySnapshot() {
  try {
    const stored = sessionStorage.getItem(EDUGNAY_PROFILE_DISPLAY_KEY)
      || sessionStorage.getItem(EDUGNAY_LEGACY_STUDENT_PROFILE_DISPLAY_KEY);
    const snapshot = JSON.parse(stored || 'null');
    return isValidProfileDisplaySnapshot(snapshot) ? snapshot : null;
  } catch { return null; }
}

function createProfileDisplaySnapshot(session) {
  if (!session) return null;
  const snapshot = {
    version: 1,
    role: session.role,
    userId: String(session.apiUserId ?? session.userId ?? ''),
    schoolId: String(session.apiSchoolId ?? session.schoolId ?? ''),
    displayName: String(session.displayName || '').trim(),
    initials: String(session.initials || '').trim(),
    avatarUrl: session.avatarUrl || null
  };
  return isValidProfileDisplaySnapshot(snapshot) ? snapshot : null;
}

function profileDisplayIdentityMatches(first, second) {
  return first?.role === second?.role
    && String(first?.userId || '') === String(second?.userId || '')
    && String(first?.schoolId || '') === String(second?.schoolId || '');
}

let cachedProfileDisplaySnapshot = readProfileDisplaySnapshot();
const portalRoleForCurrentPage = getPortalRoleFromPath();
if (portalRoleForCurrentPage) document.documentElement.classList.add('profile-chip-page');
if (cachedProfileDisplaySnapshot && portalRoleForCurrentPage
  && cachedProfileDisplaySnapshot.role === portalRoleForCurrentPage) {
  document.documentElement.classList.add('profile-chip-restoring');
} else if (cachedProfileDisplaySnapshot && portalRoleForCurrentPage
  && cachedProfileDisplaySnapshot.role !== portalRoleForCurrentPage) {
  clearProfileDisplaySnapshot();
}

function saveProfileDisplaySnapshot(session) {
  const snapshot = createProfileDisplaySnapshot(session);
  if (!snapshot) {
    clearProfileDisplaySnapshot();
    return;
  }
  if (cachedProfileDisplaySnapshot && !profileDisplayIdentityMatches(cachedProfileDisplaySnapshot, snapshot)) {
    clearProfileDisplaySnapshot();
  }
  try {
    sessionStorage.setItem(EDUGNAY_PROFILE_DISPLAY_KEY, JSON.stringify(snapshot));
    sessionStorage.removeItem(EDUGNAY_LEGACY_STUDENT_PROFILE_DISPLAY_KEY);
  } catch {}
  cachedProfileDisplaySnapshot = snapshot;
}

function restoreProfileChip() {
  const snapshot = cachedProfileDisplaySnapshot;
  if (snapshot && snapshot.role === getPortalRoleFromPath()) {
    document.querySelectorAll('.tb-profile-name').forEach(element => { element.textContent = snapshot.displayName; });
    document.querySelectorAll('.tb-profile-role').forEach(element => {
      element.textContent = EDUGNAY_PROFILE_ROLE_LABELS[snapshot.role];
    });
    document.querySelectorAll('.tb-profile-trigger').forEach(element => {
      element.setAttribute('aria-label', `Open profile menu for ${snapshot.displayName}`);
    });
    document.querySelectorAll('.tb-profile-trigger .tb-avatar').forEach(element => {
      renderAvatar(element, {
        id: snapshot.userId, name: snapshot.displayName, initials: snapshot.initials,
        avatarUrl: snapshot.avatarUrl, role: snapshot.role
      });
    });
    document.documentElement.classList.add('profile-chip-restored');
  }
  document.documentElement.classList.remove('profile-chip-restoring');
}

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

function apiResponseError(response, data, fallback) {
  const retryAfter = Number(response.headers.get('Retry-After') || data?.retryAfterSeconds);
  const message = response.status === 429
    ? 'Too many requests. Please try again' + (Number.isFinite(retryAfter) && retryAfter > 0
      ? ' in ' + Math.ceil(retryAfter / 60) + ' minute' + (retryAfter > 60 ? 's' : '') + '.'
      : ' in a few minutes.')
    : data?.message || fallback;
  const error = new Error(message);
  error.status = response.status;
  error.data = data;
  error.retryAfterSeconds = Number.isFinite(retryAfter) ? retryAfter : null;
  return error;
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
    throw apiResponseError(response, data, 'The request could not be completed.');
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
    throw apiResponseError(response, data, 'The file could not be downloaded.');
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
    throw apiResponseError(response, data, 'The upload could not be completed.');
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

async function importApiUsers(file, role) {
  const form = new FormData();
  form.append('csvFile', file);
  form.append('role', role);
  return requestApiMultipart('/users/import', form);
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
  return response?.school ? { ...response.school, registrationStatusToken: response.registrationStatusToken } : null;
}

async function getApiRegistrationStatus(token) {
  const response = await requestApi('/schools/registration-status', {
    method: 'POST',
    body: JSON.stringify({ token })
  });
  return response?.registration || null;
}

async function getApiRegistrationDetails(token) {
  const response = await requestApi('/schools/registration-details', {
    method: 'POST',
    body: JSON.stringify({ token })
  });
  return response?.application || null;
}

async function resubmitApiSchool(token, values, logoFile) {
  const body = new FormData();
  body.append('payload', JSON.stringify({ ...values, registrationStatusToken: token }));
  if (logoFile) body.append('logo', logoFile);
  const response = await requestApi('/schools/registration-resubmit', { method: 'POST', body });
  return response?.school ? { ...response.school, registrationStatusToken: response.registrationStatusToken } : null;
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
    journalSubjectName: response?.journalSubjectName || null,
    journalSubjectEligible: Boolean(response?.journalSubjectEligible)
  };
}

async function updateApiPortalFeatures(values = {}) {
  const response = await requestApi('/school/portal-features', {
    method: 'PATCH',
    body: JSON.stringify(values)
  });
  return {
    features: response?.features || {},
    journalSubjectId: response?.journalSubjectId || null,
    journalSubjectEligible: Boolean(response?.journalSubjectEligible),
    reportWeekSettings: response?.reportWeekSettings || null
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

async function getApiDepedSubjectPreview() {
  const response = await requestApi('/school/academic-structure/deped-subjects');
  return { curriculum: response?.curriculum || '', grades: Array.isArray(response?.grades) ? response.grades : [] };
}

async function applyApiDepedSubjectDefaults() {
  return requestApi('/school/academic-structure/deped-subjects', {
    method: 'POST',
    body: JSON.stringify({})
  });
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
    schoolId: record.schoolId == null ? '' : String(record.schoolId),
    sectionId: record.sectionId == null ? null : String(record.sectionId),
    subjectId: record.subjectId == null ? null : String(record.subjectId),
    electiveClassId: record.electiveClassId == null ? null : String(record.electiveClassId),
    scopeType: record.electiveClassId == null ? 'section' : 'elective',
    teacherId: String(record.teacherUserId || ''),
    teacher: record.teacherName || '',
    subject: record.subjectName || '',
    subjectName: record.subjectName || '',
    academicPeriodId: record.academicTermId ? String(record.academicTermId) : null,
    gradingItemId: record.gradingItemId ? String(record.gradingItemId) : null,
    categoryId: record.subjectGradingComponentCode || record.gradingCategoryCode || (record.gradingCategoryId ? String(record.gradingCategoryId) : null),
    subjectGradingComponentId: record.subjectGradingComponentId == null ? null : Number(record.subjectGradingComponentId),
    subjectGradingExamPartId: record.subjectGradingExamPartId == null ? null : Number(record.subjectGradingExamPartId),
    instructions: record.description || null,
    assignedDate: dueDate,
    dueDate,
    publicationStatus: record.publicationStatus || record.status || null,
    onlineSubmissionEnabled: record.onlineSubmissionEnabled === undefined
      ? true
      : Boolean(record.onlineSubmissionEnabled),
    maxScore: record.maxScore === null || record.maxScore === undefined ? null : Number(record.maxScore)
  };
}

async function getApiAssignments(filters = {}) {
  const params = new URLSearchParams();
  ['sectionId', 'subjectId', 'electiveClassId', 'status'].forEach(name => {
    if (filters[name] !== undefined && filters[name] !== null && String(filters[name]).trim()) {
      params.set(name, String(filters[name]).trim());
    }
  });
  const query = params.toString();
  const response = await requestApi(`/assignments${query ? `?${query}` : ''}`);
  return (response?.assignments || []).map(normalizeApiAssignment).filter(Boolean);
}

async function getApiAssignmentHistory() {
  const response = await requestApi('/assignments/history');
  return Array.isArray(response?.history) ? response.history : [];
}

function getApiHistoricalSubmissionUrl(assignmentId) {
  const id = Number(assignmentId);
  if (!EDUGNAY_API_BASE_URL || !Number.isSafeInteger(id) || id < 1) return null;
  return `${EDUGNAY_API_BASE_URL}/assignments/history/${id}/file`;
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

async function getApiParentChildAssignments(studentId) {
  const id = Number(studentId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('The student ID is invalid.');
  return requestApi(`/assignments/children/${id}`);
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
      subjectGradingComponentId: values.subjectGradingComponentId ? Number(values.subjectGradingComponentId) : null,
      subjectGradingExamPartId: values.subjectGradingExamPartId ? Number(values.subjectGradingExamPartId) : null,
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
      subjectGradingComponentId: values.subjectGradingComponentId === undefined ? undefined : (values.subjectGradingComponentId ? Number(values.subjectGradingComponentId) : null),
      subjectGradingExamPartId: values.subjectGradingExamPartId === undefined ? undefined : (values.subjectGradingExamPartId ? Number(values.subjectGradingExamPartId) : null),
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

async function deleteApiAssignment(assignmentId, expectedSubmissionCount) {
  const query = new URLSearchParams({ expectedSubmissionCount: String(expectedSubmissionCount) });
  return await requestApi(`/assignments/${Number(assignmentId)}?${query}`, { method: 'DELETE' }) || { deleted: true };
}

function normalizeApiGradingItem(record) {
  if (!record) return null;
  return {
    ...record,
    id: String(record.id),
    apiId: Number(record.id),
    sectionId: record.sectionId == null ? null : String(record.sectionId),
    subjectId: record.subjectId == null ? null : String(record.subjectId),
    electiveClassId: record.electiveClassId == null ? null : String(record.electiveClassId),
    academicTermId: String(record.academicTermId),
    academicPeriodId: String(record.academicTermId),
    gradingCategoryId: record.gradingCategoryId == null ? null : String(record.gradingCategoryId),
    categoryId: record.subjectGradingComponentCode || record.gradingCategoryCode || (record.gradingCategoryId == null ? null : String(record.gradingCategoryId)),
    subjectGradingComponentId: record.subjectGradingComponentId == null ? null : Number(record.subjectGradingComponentId),
    subjectGradingExamPartId: record.subjectGradingExamPartId == null ? null : Number(record.subjectGradingExamPartId),
    subjectGradingComponentCode: record.subjectGradingComponentCode || null,
    subjectGradingComponentName: record.subjectGradingComponentName || null,
    subjectGradingExamPartCode: record.subjectGradingExamPartCode || null,
    subjectGradingExamPartName: record.subjectGradingExamPartName || null,
    cat: String(record.subjectGradingComponentCode || record.gradingCategoryCode || record.gradingCategoryName || '').slice(0, 3).toUpperCase(),
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
      gradingCategoryId: values.gradingCategoryId ? Number(values.gradingCategoryId) : null,
      subjectGradingComponentId: values.subjectGradingComponentId ? Number(values.subjectGradingComponentId) : null,
      subjectGradingExamPartId: values.subjectGradingExamPartId ? Number(values.subjectGradingExamPartId) : null,
      subjectGradingComponentId: values.subjectGradingComponentId ? Number(values.subjectGradingComponentId) : null,
      subjectGradingExamPartId: values.subjectGradingExamPartId ? Number(values.subjectGradingExamPartId) : null,
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

async function getApiTransferReview(scope = {}) {
  const params = new URLSearchParams();
  ['sectionId', 'subjectId', 'academicTermId'].forEach(name => params.set(name, String(scope[name] || '')));
  return requestApi(`/final-grades/transfer-review?${params.toString()}`);
}

async function publishApiFinalGrades(scope = {}) {
  const response = await requestApi('/final-grades/publish', {
    method: 'POST',
    body: JSON.stringify({
      sectionId: String(scope.sectionId || ''),
      subjectId: String(scope.subjectId || ''),
      academicTermId: String(scope.academicTermId || ''),
      ...(scope.transferReviewAcknowledged === true ? { transferReviewAcknowledged: true } : {})
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
    sectionId: record.sectionId == null ? null : String(record.sectionId),
    subjectId: record.subjectId == null ? null : String(record.subjectId),
    electiveClassId: record.electiveClassId == null ? null : String(record.electiveClassId),
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
    const counts = { quarterly: 4, semestral: 2, semester: 2, trimestral: 3, three_term: 3 };
    const names = { quarterly: 'Quarter', semestral: 'Semester', semester: 'Semester', trimestral: 'Trimester', three_term: 'Term' };
    const ensurePeriod = (periodType, sequenceNumber, term) => {
      const periodKey = periodType + ':' + sequenceNumber;
      if (!periodsByKey.has(periodKey)) {
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
      if (term) {
        const termId = String(term.id);
        if (!period.termIds.includes(termId)) period.termIds.push(termId);
        if (term.status === 'active') {
          period.status = 'active';
          period.disabled = false;
        } else if (term.status === 'closed' && period.status !== 'active') {
          period.status = 'closed';
          period.disabled = false;
        } else if (term.status === 'upcoming' && period.status === 'unconfigured') {
          period.status = 'upcoming';
        }
      }
      return period;
    };

    (year.sections || []).forEach(section => {
      const termsBySequence = new Map((section.terms || []).map(term => [Number(term.sequenceNumber), term]));
      const configuredCount = counts[section.gradingPeriodType] || 0;
      const periodCount = year.status === 'closed' && termsBySequence.size
        ? termsBySequence.size
        : Math.max(configuredCount, termsBySequence.size);

      for (let sequenceNumber = 1; sequenceNumber <= periodCount; sequenceNumber += 1) {
        const term = termsBySequence.get(sequenceNumber);
        const periodType = section.gradingPeriodType || 'period';
        const period = ensurePeriod(periodType, sequenceNumber, term);
        if (!term) continue;

        (section.subjects || []).forEach(subject => {
          const grade = grades.find(item => item.electiveClassId == null
            && String(item.sectionId) === String(section.id)
            && String(item.academicYearId) === String(year.id)
            && String(item.academicTermId) === String(term.id)
            && String(item.subjectId) === String(subject.subjectId));
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

    (year.electiveClasses || []).forEach(electiveClass => {
      const termsBySequence = new Map((electiveClass.terms || []).map(term => [Number(term.sequenceNumber), term]));
      const periodType = electiveClass.gradingPeriodType || 'period';
      const configuredCount = counts[periodType] || 0;
      const periodCount = year.status === 'closed' && termsBySequence.size
        ? termsBySequence.size
        : Math.max(configuredCount, termsBySequence.size);

      for (let sequenceNumber = 1; sequenceNumber <= periodCount; sequenceNumber += 1) {
        const term = termsBySequence.get(sequenceNumber);
        if (!term) continue;
        const period = ensurePeriod(periodType, sequenceNumber, term);
        const grade = grades.find(item => String(item.electiveClassId) === String(electiveClass.classId)
          && String(item.academicYearId) === String(year.id)
          && String(item.academicTermId) === String(term.id));
        if (period.subjects.some(subject => String(subject.electiveClassId || '') === String(electiveClass.classId))) continue;
        period.subjects.push({
          sectionId: null,
          subjectId: null,
          electiveClassId: String(electiveClass.classId),
          subjectName: electiveClass.subjectName,
          sectionName: electiveClass.className,
          finalGrade: grade ? grade.finalGrade : null,
          passingGradeThreshold: grade?.passingGradeThreshold ?? electiveClass.passingGradeThreshold,
          publishedAt: grade?.publishedAt || null
        });
      }
    });

    grades.filter(grade => String(grade.academicYearId) === String(year.id)).forEach(grade => {
      const periodType = grade.gradingPeriodType || 'period';
      const sequenceNumber = Number(grade.academicTermSequenceNumber || 1);
      const periodKey = periodType + ':' + sequenceNumber;
      let period = Array.from(periodsByKey.values()).find(item => item.termIds.includes(String(grade.academicTermId)));
      if (!period) {
        period = {
          id: year.id + ':' + periodKey,
          label: grade.academicTermName || (names[periodType] || 'Period') + ' ' + sequenceNumber,
          sequenceNumber,
          status: 'history',
          disabled: false,
          termIds: [String(grade.academicTermId)],
          subjects: []
        };
        periodsByKey.set(periodKey, period);
      }
      const isDuplicate = period.subjects.some(subject => grade.electiveClassId != null
        ? String(subject.electiveClassId || '') === String(grade.electiveClassId)
        : subject.electiveClassId == null
          && String(subject.sectionId) === String(grade.sectionId)
          && String(subject.subjectId) === String(grade.subjectId));
      if (isDuplicate) return;
      period.subjects.push({
        sectionId: grade.sectionId,
        subjectId: grade.subjectId,
        electiveClassId: grade.electiveClassId || null,
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
      electiveClasses: (year.electiveClasses || []).map(electiveClass => ({
        ...electiveClass,
        classId: String(electiveClass.classId),
        academicYearId: String(electiveClass.academicYearId),
        terms: (electiveClass.terms || []).map(term => ({
          ...term,
          id: String(term.id),
          sequenceNumber: Number(term.sequenceNumber)
        }))
      })),
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
      sectionId: grade.sectionId == null ? null : String(grade.sectionId),
      subjectId: grade.subjectId == null ? null : String(grade.subjectId),
      electiveClassId: grade.electiveClassId == null ? null : String(grade.electiveClassId),
      academicTermId: String(grade.academicTermId),
      academicYearId: String(grade.academicYearId),
      academicTermSequenceNumber: Number(grade.academicTermSequenceNumber),
      finalGrade: Number(grade.finalGrade)
    })),
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

async function getApiGradingSettings(filters = {}) {
  const params = new URLSearchParams();
  if (filters.schoolLevelId) params.set('schoolLevelId', String(filters.schoolLevelId));
  if (filters.sectionId) params.set('sectionId', String(filters.sectionId));
  if (filters.subjectId) params.set('subjectId', String(filters.subjectId));
  const query = params.toString();
  const response = await requestApi(`/grading-categories${query ? `?${query}` : ''}`);
  return {
    gradingCategories: Array.isArray(response?.gradingCategories)
      ? response.gradingCategories.map(category => ({ ...category, weight: Number(category.weight) }))
      : [],
    gradingScale: response?.gradingScale || 'standard',
    shsGradingTypes: Array.isArray(response?.shsGradingTypes) ? response.shsGradingTypes : [],
    publishedShsGradeCount: Number(response?.publishedShsGradeCount || 0)
  };
}

async function getApiGradingCategories(filters = {}) {
  return (await getApiGradingSettings(filters)).gradingCategories;
}

async function getApiShsGradingTypes() {
  return (await getApiGradingSettings()).shsGradingTypes;
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

async function getApiDepedK10GradingPreview(filters = {}) {
  const params = new URLSearchParams({
    academicYearId: String(filters.academicYearId || ''),
    schoolLevelId: String(filters.schoolLevelId || '')
  });
  return requestApi(`/deped-k10/grading-preview?${params.toString()}`);
}

async function applyApiDepedK10GradingDefaults(values = {}) {
  return requestApi('/deped-k10/grading-defaults', {
    method: 'POST',
    body: JSON.stringify(values)
  });
}

async function restoreApiDepedSubjectDefaults(values = {}) {
  return requestApi('/deped-k10/subject-defaults', {
    method: 'POST',
    body: JSON.stringify(values)
  });
}

async function restoreApiDepedCatalogSubjectGroupDefaults(values = {}) {
  return requestApi('/deped-k10/subject-group-defaults', {
    method: 'POST',
    body: JSON.stringify(values)
  });
}

async function saveApiK10FinalGradeRules(values = {}) {
  return requestApi('/deped-k10/final-grade-rules', {
    method: 'PUT',
    body: JSON.stringify(values)
  });
}

async function getApiSubjectGradingConfig(filters = {}) {
  const params = new URLSearchParams();
  for (const key of ['sectionId', 'subjectId', 'academicYearId', 'schoolLevelId']) {
    if (filters[key]) params.set(key, String(filters[key]));
  }
  const query = params.toString();
  return requestApi(`/subject-grading-config${query ? `?${query}` : ''}`);
}

async function saveApiSubjectGradingConfig(values = {}) {
  return requestApi('/subject-grading-config', {
    method: 'PUT',
    body: JSON.stringify(values)
  });
}

async function saveApiK10CatalogSubjectGroupConfig(values = {}) {
  return requestApi('/deped-k10/subject-group-config', {
    method: 'PUT',
    body: JSON.stringify(values)
  });
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

async function getApiStudentAttendance() {
  return requestApi('/attendance/me');
}

async function getApiSchoolAttendanceSummary(academicYearId = '') {
  const query = academicYearId ? `?academicYearId=${Number(academicYearId)}` : '';
  return requestApi(`/attendance/school-summary${query}`);
}

async function getApiTeacherStudentFlags() {
  return requestApi('/attendance/teacher-flags');
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
  task: 'dashboard',
  student_transfer: 'section'
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
    schoolId: record.schoolId == null ? '' : String(record.schoolId),
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
  if (type === 'report') {
    try {
      const target = new URL(String(record.targetPath || ''), window.location.origin);
      const studentId = target.searchParams.get('studentId') || '';
      const reportId = target.searchParams.get('reportId') || '';
      if (target.origin === window.location.origin
        && target.pathname === '/views/parent/edugnay-parent-reports.html'
        && /^\d+$/.test(studentId)
        && /^\d+$/.test(reportId)) {
        link = { page: 'reports', studentId, reportId };
      }
    } catch {
      link = { page: 'reports' };
    }
  } else if (type === 'grading_period_reopen') {
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
  } else if (type === 'student_transfer') {
    link = { page: 'notifications' };
    try {
      const target = new URL(String(record.targetPath || ''), window.location.origin);
      const sectionId = target.searchParams.get('sectionId') || '';
      if (target.origin === window.location.origin
        && target.pathname === '/views/teacher/edugnay-teacher-sections.html'
        && /^\d+$/.test(sectionId)) {
        link = { page: 'section', section: sectionId };
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
    grading_period_reopen: { icon: 'clipboard-check', tone: 'blue', label: 'Grade access' },
    student_transfer: { icon: 'users-round', tone: 'blue', label: 'Student transfer' }
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

const readSyntheticNotificationIds = new Set();

function isSyntheticNotificationRead(id) {
  return readSyntheticNotificationIds.has(String(id));
}

function getTodayCalendarNotifications() {
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return (window.EDUGNAY_CALENDAR_NOTICES || []).filter(notice => notice.date === localDate)
    .map(notice => ({
      id: `calendar-${notice.id}`, schoolId: window.EDUGNAY_API_SCHOOL_CONTEXT?.id,
      icon: 'calendar-off', tone: 'gold', type: 'Calendar', read: isSyntheticNotificationRead(`calendar-${notice.id}`),
      title: notice.title, message: notice.detail || 'No classes today.',
      link: { page: 'announcements' }, createdAt: `${notice.date}T00:00:00`
    }));
}

async function loadApiCommunication(role) {
  if (!EDUGNAY_API_BASE_URL) throw new Error('The API address has not been configured.');
  if (role !== 'platform_admin') {
    await window.EDUGNAY_SCHOOL_READY;
    await window.EDUGNAY_CALENDAR_READY;
  }
  const [notifications, tasks, announcements] = await Promise.all([
    getApiNotifications(),
    getApiTasks(),
    role === 'platform_admin' ? Promise.resolve([]) : getApiAnnouncements()
  ]);
  return { backend: true,
    notifications: [...(role === 'platform_admin' ? [] : getTodayCalendarNotifications()), ...notifications],
    announcements, tasks };
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

async function deleteApiPlatformSchool(schoolId) {
  const id = Number(schoolId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('The school ID is invalid.');
  return requestApi(`/platform/schools/${id}`, { method: 'DELETE' });
}

async function changeApiPlatformSchool(schoolId, action, reason) {
  if (!['approve', 'reject', 'suspend', 'reactivate'].includes(action)) throw new Error('School action is invalid.');
  return requestApi(`/platform/schools/${Number(schoolId)}/${action}`, {
    method: 'POST', body: JSON.stringify(reason ? { reason } : {})
  });
}

async function retryApiPlatformSchoolRegistrationEmail(schoolId) {
  const id = Number(schoolId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('The school ID is invalid.');
  return requestApi('/platform/schools/' + id + '/registration-email/retry', { method: 'POST' });
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
  window.EDUGNAY_API_SCHOOL_CONTEXT = school
    ? { ...(window.EDUGNAY_API_SCHOOL_CONTEXT || {}), ...school }
    : null;
  if (features) window.EDUGNAY_API_PORTAL_FEATURES = features;
  document.dispatchEvent(new CustomEvent('edugnay:school-context-updated', {
    detail: window.EDUGNAY_API_SCHOOL_CONTEXT
  }));
}

function setApiPortalFeatures(features) {
  window.EDUGNAY_API_PORTAL_FEATURES = features || null;
}

async function getApiSchoolContext() {
  const response = await requestApi('/school/context');
  if (!response?.school?.id) throw new Error('School context is unavailable.');
  const school = { ...response.school, logoUrl: resolveApiSchoolLogo(response.school.logoUrl) };
  setApiSchoolContext(school, {
    gradesEnabled: response.school.gradesPageEnabled,
    narrativeReportsEnabled: response.school.narrativeReportsEnabled,
    journalsEnabled: response.school.journalsEnabled,
    attendanceEnabled: response.school.attendanceEnabled,
    sfTemplatesEnabled: response.school.sfTemplatesEnabled,
    journalSubjectId: response.school.journalSubjectId
  });
  return school;
}

async function loadApiCalendarNotices() {
  const response = await requestApi('/school/calendar-notices');
  window.EDUGNAY_CALENDAR_NOTICES = Array.isArray(response?.notices) ? response.notices : [];
  document.dispatchEvent(new CustomEvent('edugnay:calendar-notices-updated', {
    detail: window.EDUGNAY_CALENDAR_NOTICES
  }));
  return window.EDUGNAY_CALENDAR_NOTICES;
}

window.EDUGNAY_API = {
  request: requestApi,
  getTimetable: (academicYearId) => requestApi(`/timetables${academicYearId ? `?academicYearId=${encodeURIComponent(academicYearId)}` : ''}`),
  getTimetableYears: () => requestApi('/timetables/years').then(result => result.years || []),
  getShsProgram: academicYearId => requestApi(`/shs-program${academicYearId ? `?academicYearId=${encodeURIComponent(academicYearId)}` : ''}`),
  getShsSelection: () => requestApi('/shs-selection/mine'),
  submitShsSelection: values => requestApi('/shs-selection/mine', { method: 'PUT', body: JSON.stringify(values) }),
  getShsSelectionStudents: values => requestApi(`/shs-selection/students?${new URLSearchParams(values || {})}`),
  getShsStudentChoices: (studentId, academicYearId) => requestApi(`/shs-selection/students/${encodeURIComponent(studentId)}/choices?academicYearId=${encodeURIComponent(academicYearId)}`),
  saveShsStudentChoices: (studentId, academicYearId, classIds) => requestApi(`/shs-selection/students/${encodeURIComponent(studentId)}/choices?academicYearId=${encodeURIComponent(academicYearId)}`, {
    method: 'PUT', body: JSON.stringify({ classIds })
  }),
  decideShsSelection: (requestId, values) => requestApi(`/shs-selection/requests/${encodeURIComponent(requestId)}/decision`, { method: 'POST', body: JSON.stringify(values) }),
  changeApprovedShsSelection: (requestId, values) => requestApi(`/shs-selection/requests/${encodeURIComponent(requestId)}/classes`, { method: 'PUT', body: JSON.stringify(values) }),
  clearApprovedShsSelection: requestId => requestApi(`/shs-selection/requests/${encodeURIComponent(requestId)}/clear`, { method: 'POST' }),
  activateShsOffering: values => requestApi('/shs-program/offerings', { method: 'POST', body: JSON.stringify(values) }),
  setShsOfferingActive: (offeringId, isActive) => requestApi(`/shs-program/offerings/${encodeURIComponent(offeringId)}`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  createShsClass: values => requestApi('/shs-program/classes', { method: 'POST', body: JSON.stringify(values) }),
  updateShsClass: (classId, values) => requestApi(`/shs-program/classes/${encodeURIComponent(classId)}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteShsClass: classId => requestApi(`/shs-program/classes/${encodeURIComponent(classId)}`, { method: 'DELETE' }),
  saveElectiveTimetableMeeting: (classId, meetingId, values) => requestApi(`/timetables/elective-classes/${encodeURIComponent(classId)}/meetings${meetingId ? `/${encodeURIComponent(meetingId)}` : ''}`, {
    method: meetingId ? 'PATCH' : 'POST', body: JSON.stringify(values)
  }),
  saveTimetableMeeting: (assignmentId, meetingId, values) => requestApi(`/timetables/assignments/${encodeURIComponent(assignmentId)}/meetings${meetingId ? `/${encodeURIComponent(meetingId)}` : ''}`, {
    method: meetingId ? 'PATCH' : 'POST', body: JSON.stringify(values)
  }),
  deleteTimetableMeeting: meetingId => requestApi(`/timetables/meetings/${encodeURIComponent(meetingId)}`, { method: 'DELETE' }),
  requestFile: requestApiFile,
  requestMultipart: requestApiMultipart,
  isBackendAvailable: Boolean(EDUGNAY_API_BASE_URL),
  normalizeUser: normalizeApiUser,
  getUsers: getApiUsers,
  getAllUsers: getAllApiUsers,
  getUser: getApiUser,
  createUser: createApiUser,
  importUsers: importApiUsers,
  updateUser: updateApiUser,
  deleteUser: deleteApiUser,
  setUserStatus: setApiUserStatus,
  getSchoolSettings: getApiSchoolSettings,
  getRegistrationStatus: getApiRegistrationStatus,
  getRegistrationDetails: getApiRegistrationDetails,
  resubmitSchool: resubmitApiSchool,
  getSchoolContext: getApiSchoolContext,
  getCalendarNotices: loadApiCalendarNotices,
  getParentNotificationTriggers: getApiParentNotificationTriggers,
  updateParentNotificationTriggers: updateApiParentNotificationTriggers,
  updateSchoolSettings: updateApiSchoolSettings,
  updateSchoolLogo: updateApiSchoolLogo,
  registerSchool: registerApiSchool,
  getPortalFeatures: getApiPortalFeatures,
  updatePortalFeatures: updateApiPortalFeatures,
  getAcademicStructure: getApiAcademicStructure,
  updateAcademicStructure: updateApiAcademicStructure,
  getDepedSubjectPreview: getApiDepedSubjectPreview,
  applyDepedSubjectDefaults: applyApiDepedSubjectDefaults,
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
  getAssignmentHistory: getApiAssignmentHistory,
  getHistoricalSubmissionUrl: getApiHistoricalSubmissionUrl,
  getParentAssignmentActivity: getApiParentAssignmentActivity,
  getParentChildAssignments: getApiParentChildAssignments,
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
  getTransferReview: getApiTransferReview,
  publishFinalGrades: publishApiFinalGrades,
  getFinalGrades: getApiFinalGrades,
  getFinalGradesOverview: getApiFinalGradesOverview,
  getAssignmentSubmissions: getApiAssignmentSubmissions,
  getAssignmentSubmissionDownloadUrl: getApiAssignmentSubmissionDownloadUrl,
  getAssignmentSubmissionPreview: getApiAssignmentSubmissionPreview,
  submitAssignment: submitApiAssignment,
  getGradingCategories: getApiGradingCategories,
  getGradingSettings: getApiGradingSettings,
  getShsGradingTypes: getApiShsGradingTypes,
  updateGradingCategories: updateApiGradingCategories,
  getDepedK10GradingPreview: getApiDepedK10GradingPreview,
  applyDepedK10GradingDefaults: applyApiDepedK10GradingDefaults,
  restoreDepedSubjectDefaults: restoreApiDepedSubjectDefaults,
  restoreDepedCatalogSubjectGroupDefaults: restoreApiDepedCatalogSubjectGroupDefaults,
  saveK10FinalGradeRules: saveApiK10FinalGradeRules,
  getSubjectGradingConfig: getApiSubjectGradingConfig,
  saveSubjectGradingConfig: saveApiSubjectGradingConfig,
  saveK10CatalogSubjectGroupConfig: saveApiK10CatalogSubjectGroupConfig,
  getSectionAttendance: getApiSectionAttendance,
  getSectionAttendanceHistory: getApiSectionAttendanceHistory,
  saveSectionAttendance: saveApiSectionAttendance,
  getQrAttendance: getApiQrAttendance,
  startQrAttendance: startApiQrAttendance,
  scanQrAttendance: scanApiQrAttendance,
  confirmQrAttendance: confirmApiQrAttendance,
  getParentAttendance: getApiParentAttendance,
  getStudentAttendance: getApiStudentAttendance,
  getParentChildren: getApiParentChildren,
  getStudentParents: getApiStudentParents,
  getArchive: getApiArchive,
  getArchivedYear: getApiArchivedYear,
  archiveAcademicYear: archiveApiAcademicYear,
  getSchoolAttendanceSummary: getApiSchoolAttendanceSummary,
  getTeacherStudentFlags: getApiTeacherStudentFlags,
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
  deletePlatformSchool: deleteApiPlatformSchool,
  changePlatformSchool: changeApiPlatformSchool,
  retryPlatformSchoolRegistrationEmail: retryApiPlatformSchoolRegistrationEmail,
  getPlatformActivityPage: getApiPlatformActivityPage,
  getDashboardActivity: getApiDashboardActivity,
  getSchoolActivityPage: getApiSchoolActivityPage,
  loadCommunication: loadApiCommunication,
  getTodayCalendarNotifications,
  isSyntheticNotificationRead,
  setSchoolContext: setApiSchoolContext,
  setPortalFeatures: setApiPortalFeatures
};

window.EDUGNAY_CALENDAR_READY = Promise.resolve();
window.EDUGNAY_SCHOOL_READY = EDUGNAY_API_BASE_URL
  && /^\/views\/(admin|teacher|student|parent)\//.test(window.location.pathname)
  ? getApiSchoolContext().then(school => {
    window.EDUGNAY_CALENDAR_READY = loadApiCalendarNotices().catch(error => {
      const message = `${error?.message || 'Calendar notices could not be loaded.'} Reload to retry.`;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => showAppToast(message, 'error'), { once: true });
      } else {
        showAppToast(message, 'error');
      }
    });
    return school;
  }).catch(error => {
    const message = error?.message || 'School data could not be loaded.';
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => showAppToast(`${message} Reload to retry.`, 'error'), { once: true });
    } else {
      showAppToast(`${message} Reload to retry.`, 'error');
    }
    throw error;
  })
  : Promise.resolve();
window.EDUGNAY_SCHOOL_READY.catch(() => {});

function readFrontendSession() {
  return window.EDUGNAY_SESSION || null;
}

window.EDUGNAY_SESSION = null;
let currentUserRequest = null;

function saveFrontendSession(session) {
  window.EDUGNAY_SESSION = session;
  saveProfileDisplaySnapshot(session);
}

function renderAvatar(element, person = {}, options = {}) {
  if (!element) return;
  const sizes = ['sm', 'compact', 'md', 'lg', 'profile'];
  const tones = ['navy', 'blue', 'gold', 'green', 'purple', 'orange', 'teal'];
  const roleTone = { platform_admin: 'blue', school_admin: 'blue', teacher: 'gold',
    student: 'green', parent: 'purple' };
  const identity = String(person.id || person.name || person.initials || '');
  const hash = [...identity].reduce((value, character) => value + character.charCodeAt(0), 0);
  const tone = tones.includes(options.color) ? options.color
    : roleTone[person.role] || tones[hash % tones.length];
  const name = String(person.name || '').trim();
  const initials = String(person.initials || name.split(/\s+/).map(part => part[0]).slice(0, 2).join('') || '--').trim().toUpperCase();
  const size = sizes.includes(options.size) ? options.size : 'md';

  element.classList.add('person-avatar');
  sizes.forEach(value => element.classList.toggle(`person-avatar--${value}`, value === size));
  element.dataset.avatarTone = tone;
  if (options.decorative !== false) {
    element.setAttribute('aria-hidden', 'true');
    element.removeAttribute('role');
    element.removeAttribute('aria-label');
  } else {
    element.removeAttribute('aria-hidden');
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', options.label || `${name || 'User'} avatar`);
  }

  const fallback = document.createElement('span');
  fallback.textContent = initials;
  const value = String(person.avatarUrl || '').trim();
  let photoUrl = null;
  if (value && EDUGNAY_API_BASE_URL) {
    try {
      const url = new URL(value, EDUGNAY_API_BASE_URL);
      if (url.origin === new URL(EDUGNAY_API_BASE_URL).origin
        && /^\/api\/users\/[1-9]\d*\/avatar$/.test(url.pathname)) photoUrl = url.href;
    } catch { /* Invalid photo URLs use initials. */ }
  }
  const existing = element.querySelector(':scope > img');
  if (photoUrl && existing?.src === photoUrl) {
    element.replaceChildren(fallback, existing);
    return;
  }
  element.replaceChildren(fallback);
  if (!photoUrl) return;
  const image = document.createElement('img');
  image.alt = '';
  image.crossOrigin = 'use-credentials';
  image.addEventListener('error', () => image.remove(), { once: true });
  element.appendChild(image);
  image.src = photoUrl;
}

function avatarHtml(person = {}, options = {}) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const name = person.name || person.displayName || person.studentName || person.teacherName || '';
  const initials = person.initials || person.studentInitials || person.teacherInitials
    || String(name).split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() || '--';
  const details = {
    id: person.id || person.studentId || person.teacherId || person.parentId,
    name, initials, avatarUrl: person.avatarUrl, role: options.role || person.role
  };
  const size = ['sm', 'compact', 'md', 'lg', 'profile'].includes(options.size) ? options.size : 'md';
  const className = String(options.className || '').replace(/[^a-zA-Z0-9_ -]/g, '').trim();
  return `<span class="${escape(className)} person-avatar person-avatar--${size}" data-person-avatar="${escape(JSON.stringify(details))}" aria-hidden="true">${escape(initials)}</span>`;
}

function hydrateAvatars(root = document) {
  const elements = root.matches?.('[data-person-avatar]') ? [root] : [];
  elements.push(...(root.querySelectorAll?.('[data-person-avatar]:not([data-avatar-ready])') || []));
  elements.forEach(element => {
    if (element.hasAttribute('data-avatar-ready')) return;
    element.setAttribute('data-avatar-ready', '');
    try { renderAvatar(element, JSON.parse(element.dataset.personAvatar), {
      size: element.classList.contains('person-avatar--compact') ? 'compact'
        : element.classList.contains('person-avatar--sm') ? 'sm'
        : element.classList.contains('person-avatar--lg') ? 'lg' : 'md'
    }); } catch { element.removeAttribute('data-avatar-ready'); }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  hydrateAvatars();
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType === 1) hydrateAvatars(node);
  }))).observe(document.body, { childList: true, subtree: true });
});

async function getCurrentUser() {
  if (!EDUGNAY_API_BASE_URL) return window.EDUGNAY_SESSION;
  if (currentUserRequest) return currentUserRequest;

  currentUserRequest = (async () => {
    const response = await requestApi('/auth/me');
    const user = response?.user;
    if (!user?.id || !user.role) throw new Error('The session response is invalid.');
    const session = {
      apiUserId: user.id,
      apiSchoolId: user.schoolId,
      userId: String(user.id),
      schoolId: user.schoolId == null ? '' : String(user.schoolId),
      role: user.role,
      schoolEmail: user.schoolEmail,
      personalEmail: user.personalEmail,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      initials: user.initials,
      hasAvatar: user.hasAvatar,
      avatarUrl: user.avatarUrl,
      avatarVersion: user.avatarVersion,
      accountStatus: user.accountStatus,
      setupCompletedAt: user.setupCompletedAt
    };
    saveFrontendSession(session);
    return session;
  })();

  try {
    return await currentUserRequest;
  } finally {
    currentUserRequest = null;
  }
}

function applyCurrentUserToShell(session) {
  if (!session) return;
  const roleLabel = EDUGNAY_PROFILE_ROLE_LABELS[session.role] || '';
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
  document.querySelectorAll('.tb-profile-trigger').forEach(element => {
    element.setAttribute('aria-label', `Open profile menu for ${session.displayName || 'your account'}`);
  });
  document.querySelectorAll('.tb-avatar').forEach(element => {
    renderAvatar(element, {
      id: session.apiUserId || session.userId,
      name: session.displayName,
      initials: session.initials || element.textContent,
      avatarUrl: session.avatarUrl,
      role: session.role
    });
  });
  document.dispatchEvent(new CustomEvent('edugnay:current-user-updated', { detail: session }));
}

function setCurrentUserShellStatus(label, roleLabel = '') {
  document.querySelectorAll('[data-current-user-name], .tb-profile-name').forEach(element => {
    if (/^loading\b/i.test(label) && window.EDUGNAY_CONFIG?.renderPanelSkeleton) {
      element.innerHTML = window.EDUGNAY_CONFIG.renderPanelSkeleton({ kind: 'line', label: 'Loading account' });
    } else {
      element.textContent = label;
    }
  });
  document.querySelectorAll('[data-current-user-role], .tb-profile-role').forEach(element => {
    element.textContent = roleLabel;
  });
  document.querySelectorAll('[data-current-user-initials], .tb-avatar').forEach(element => {
    element.textContent = '--';
  });
  document.querySelectorAll('.profile-avatar').forEach(element => {
    element.textContent = '--';
  });
  document.querySelectorAll('.tb-profile-trigger').forEach(element => {
    element.setAttribute('aria-label', `${label}${roleLabel ? `, ${roleLabel}` : ''}`);
  });
}

let avatarRefreshInFlight = null;
let lastAvatarRefreshAt = 0;
function isPublicPage() {
  return document.body?.dataset.publicPage === 'true';
}

function refreshCurrentUserAvatar() {
  if (document.readyState === 'loading' || isPublicPage() || !EDUGNAY_API_BASE_URL || avatarRefreshInFlight || Date.now() - lastAvatarRefreshAt < 10000) return avatarRefreshInFlight;
  lastAvatarRefreshAt = Date.now();
  avatarRefreshInFlight = getCurrentUser()
    .then(applyCurrentUserToShell)
    .catch(error => { if (error.status !== 401) console.warn('Avatar refresh failed.', error.message); })
    .finally(() => { avatarRefreshInFlight = null; });
  return avatarRefreshInFlight;
}

window.EDUGNAY_AVATAR = { render: renderAvatar, html: avatarHtml, hydrate: hydrateAvatars,
  refreshCurrentUser: refreshCurrentUserAvatar };

function initProfileAvatar() {
  const avatar = document.getElementById('profileAvatar');
  const trigger = document.getElementById('avatarEditTrigger');
  const menu = document.getElementById('avatarMenu');
  const uploadButton = document.getElementById('avatarUploadBtn');
  const removeButton = document.getElementById('avatarRemoveBtn');
  const input = document.getElementById('avatarFileInput');
  if (!avatar || !trigger || !menu || !uploadButton || !removeButton || !input) return;
  const status = document.createElement('span');
  status.className = 'avatar-save-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  avatar.parentElement.appendChild(status);

  const closeMenu = () => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  const setBusy = (busy, message = '') => {
    avatar.classList.toggle('is-saving', busy);
    avatar.parentElement.classList.toggle('is-saving', busy);
    trigger.disabled = busy;
    uploadButton.disabled = busy;
    removeButton.disabled = busy;
    avatar.setAttribute('aria-busy', String(busy));
    status.textContent = busy ? message : '';
    status.hidden = !busy;
  };
  const render = user => {
    if (!user) return;
    renderAvatar(avatar, {
      id: user.apiUserId || user.id || user.userId,
      name: user.displayName,
      initials: user.initials,
      avatarUrl: user.avatarUrl,
      role: user.role
    }, { size: 'profile' });
    removeButton.hidden = !user.hasAvatar;
  };
  document.addEventListener('edugnay:current-user-updated', event => render(event.detail));
  render(EDUGNAY_API_BASE_URL ? null : readFrontendSession() || window.EDUGNAY_SESSION);
  if (EDUGNAY_API_BASE_URL) refreshCurrentUserAvatar();

  trigger.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    trigger.setAttribute('aria-expanded', String(!menu.hidden));
  });
  uploadButton.addEventListener('click', () => { closeMenu(); input.click(); trigger.focus(); });
  document.addEventListener('click', event => {
    if (!trigger.contains(event.target) && !menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { closeMenu(); trigger.focus(); }
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      showAppToast('Choose a valid PNG, JPEG, or WebP photo that is 2 MB or smaller.', 'error');
      return;
    }
    const form = new FormData();
    form.append('avatar', file);
    setBusy(true, 'Saving photo…');
    try {
      const response = await requestApiMultipart('/users/me/avatar', form);
      const current = readFrontendSession() || window.EDUGNAY_SESSION;
      const user = { ...current, ...response.avatar };
      saveFrontendSession(user);
      applyCurrentUserToShell(user);
      showAppToast('Profile photo saved.');
    } catch (error) {
      showAppToast(error.message || 'Unable to save your photo.', 'error');
    } finally {
      setBusy(false);
    }
  });
  removeButton.addEventListener('click', async () => {
    closeMenu();
    setBusy(true, 'Removing photo…');
    try {
      await requestApi('/users/me/avatar', { method: 'DELETE' });
      const current = readFrontendSession() || window.EDUGNAY_SESSION;
      const user = { ...current, hasAvatar: false, avatarUrl: null,
        avatarVersion: Number(current?.avatarVersion || 0) + 1 };
      saveFrontendSession(user);
      applyCurrentUserToShell(user);
      showAppToast('Profile photo removed.');
    } catch (error) {
      showAppToast(error.message || 'Unable to remove your photo.', 'error');
    } finally {
      setBusy(false);
    }
  });
}
document.addEventListener('DOMContentLoaded', initProfileAvatar);
window.addEventListener('focus', () => { if (!document.hidden) refreshCurrentUserAvatar(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCurrentUserAvatar(); });
window.addEventListener('pageshow', event => { if (event.persisted) refreshCurrentUserAvatar(); });

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

/* Small rendering helpers shared by portal pages. */
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

async function markCurrentNotificationRead(id) {
  const context = window.EDUGNAY_NOTIFICATION_CONTEXT;
  if (!context) return null;
  const items = typeof context.getItems === 'function'
    ? context.getItems()
    : (Array.isArray(context.records) ? context.records : []);
  const record = items.find(item => String(item.id) === String(id)) || null;

  if (window.EDUGNAY_COMMUNICATION?.backend) {
    if (!/^\d+$/.test(String(id)) && record) {
      readSyntheticNotificationIds.add(String(id));
      record.read = true;
      return record;
    }
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

  return null;
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
      items.forEach(item => {
        if (!/^\d+$/.test(String(item.id))) readSyntheticNotificationIds.add(String(item.id));
        item.read = true;
      });
    } catch (error) {
      window.alert(error?.message || 'Notifications could not be marked as read.');
    }
    return items;
  }

  return items;
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

/* Shared school configuration and UI rules. */
(function initializeEdUgnayConfig() {
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
      tracks: ['Academic', 'Technical Professional (TechPro)']
    }
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
      strands: level === 'shs' ? [] : values.strands || [...(catalog?.strands || [])],
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

  function clone(value) {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }


  function getSchools() {
    return window.EDUGNAY_API_SCHOOL_CONTEXT ? [window.EDUGNAY_API_SCHOOL_CONTEXT] : [];
  }


  function getActiveSchool() {
    return window.EDUGNAY_API_SCHOOL_CONTEXT || null;
  }

  function getActiveSchoolId() {
    return getActiveSchool()?.id || null;
  }


  function getCurrentAcademicPeriod(schoolId = getActiveSchoolId(), schoolLevel) {
    const school = getSchools().find(record => record.id === schoolId);
    const level = schoolLevel || school?.activeDivision || school?.schoolLevels?.[0];
    const division = school?.divisions?.[level];
    return clone(division?.academicPeriods?.find(period => period.id === division.activeAcademicPeriodId) || null);
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


  function isGradesPageEnabled(school = getActiveSchool()) {
    if (window.EDUGNAY_API_PORTAL_FEATURES && Object.hasOwn(window.EDUGNAY_API_PORTAL_FEATURES, 'gradesEnabled')) {
      return Boolean(window.EDUGNAY_API_PORTAL_FEATURES.gradesEnabled);
    }
    return Boolean(school?.gradesPageEnabled);
  }

  function isAttendanceEnabled() {
    return true;
  }

  function isNarrativeReportsEnabled(school = getActiveSchool()) {
    if (window.EDUGNAY_API_PORTAL_FEATURES && Object.hasOwn(window.EDUGNAY_API_PORTAL_FEATURES, 'narrativeReportsEnabled')) {
      return Boolean(window.EDUGNAY_API_PORTAL_FEATURES.narrativeReportsEnabled);
    }
    return Boolean(school?.narrativeReportsEnabled);
  }

  function getJournalSubject() {
    const features = window.EDUGNAY_API_PORTAL_FEATURES;
    return features?.journalSubjectId && features.journalSubjectName
      ? { id: String(features.journalSubjectId), name: features.journalSubjectName } : null;
  }

  function isJournalsEnabled() {
    const features = window.EDUGNAY_API_PORTAL_FEATURES;
    return Boolean(features?.journalsEnabled && features.journalSubjectEligible === true && getJournalSubject());
  }

  function normalizeApiSection(record) {
    return {
      ...record,
      id: String(record.id),
      schoolId: record.schoolId == null ? '' : String(record.schoolId),
      level: record.schoolLevelCode,
      grade: record.gradeLevelName,
      academicYear: record.academicYearLabel || '',
      academicYearStatus: record.academicYearStatus || '',
      adviserId: record.adviserUserId ? String(record.adviserUserId) : null,
      adviserName: record.adviserName || '',
      trackId: record.trackId == null ? null : String(record.trackId),
      trackCode: record.trackCode || '',
      trackName: record.trackName || '',
      strandId: record.strandId == null ? null : String(record.strandId),
      strandCode: record.strandCode || '',
      strandName: record.strandName || '',
      needsCurriculumSetup: Boolean(record.needsCurriculumSetup),
      track: record.trackName || '',
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
      schoolId: record.schoolId == null ? '' : String(record.schoolId),
      code: record.subjectCode || '',
      name: record.name || '',
      schoolLevelCode: record.schoolLevelCode || '',
      gradeCode: record.gradeCode || '',
      isActive: record.isActive !== false,
      gradeLevelIds: Array.isArray(record.gradeLevelIds) ? record.gradeLevelIds.map(Number) : [],
      gradeScopes: Array.isArray(record.gradeScopes) ? record.gradeScopes : [],
      trackId: record.trackId == null ? null : Number(record.trackId),
      strandId: record.strandId == null ? null : Number(record.strandId),
      shsGradingGroup: record.shsGradingGroup || null
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

  async function enrollApiStudentsBulk(sectionId, studentIds) {
    return requestApi(`/sections/${Number(sectionId)}/students/bulk`, {
      method: 'POST',
      body: JSON.stringify({ studentIds: studentIds.map(Number) })
    });
  }

  async function moveApiStudent(sectionId, studentId, targetSectionId) {
    return requestApi(`/sections/${Number(sectionId)}/students/${Number(studentId)}/move`, {
      method: 'POST',
      body: JSON.stringify({ targetSectionId: Number(targetSectionId) })
    });
  }

  async function previewApiStudentMove(sectionId, studentId, targetSectionId) {
    return requestApi(`/sections/${Number(sectionId)}/students/${Number(studentId)}/move-preview?targetSectionId=${Number(targetSectionId)}`);
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


  async function getMyTeachingSections() {
    return getApiSections({ scope: 'teaching' });
  }

  async function getMyAdvisorySections(includeClosed = false) {
    const session = readFrontendSession() || await getCurrentUser();
    const teacherId = String(session?.apiUserId || '');
    return (await getApiSections()).filter(section => section.adviserId === teacherId
      && (section.status === 'active' && section.academicYearStatus === 'active'
        || includeClosed && section.status === 'archived' && section.academicYearStatus === 'closed'));
  }

  async function getApiMaterials(filters = {}) {
    const params = new URLSearchParams();
    if (filters.sectionId) params.set('sectionId', filters.sectionId);
    if (filters.subjectId) params.set('subjectId', filters.subjectId);
    if (filters.electiveClassId) params.set('electiveClassId', filters.electiveClassId);
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

  function getApiMaterialFile(materialId, download = false) {
    return requestApiFile(`/materials/${encodeURIComponent(materialId)}/file${download ? '?download=1' : ''}`);
  }


  async function getSfTemplates() {
    const response = await requestApi('/sf-templates');
    return (response.templates || []).map(record => ({
      id: record.formCode === 'SF1' ? 'sf1-school-register-v1'
        : record.formCode === 'SF2' ? 'sf2-daily-attendance-v1'
          : record.formCode === 'SF3' ? 'sf3-books-issued-returned-v1'
            : record.formCode === 'SF5' ? 'sf5-promotion-proficiency-v1'
              : record.formCode === 'SF8' ? 'sf8-health-nutrition-v1'
                : record.formCode === 'SF9' ? 'sf9-learner-performance-v1' : `sf-${record.id}`,
      apiId: String(record.id),
      formCode: record.formCode,
      formName: record.formName,
      version: record.version,
      schoolLevels: ['SF5', 'SF9'].includes(record.formCode) ? ['elementary', 'jhs'] : ['elementary', 'jhs', 'shs'],
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

  async function getSfTemplateLearners(templateId, sectionId) {
    const template = (await getSfTemplates()).find(record => record.id === String(templateId));
    if (!template || template.formCode !== 'SF9') throw new Error('Learner selection is available only for SF9.');
    const response = await requestApi(`/sf-templates/${template.apiId}/learners?sectionId=${encodeURIComponent(sectionId)}`);
    return (response.learners || []).map(learner => ({
      id: String(learner.id),
      displayName: learner.displayName || '',
      lrn: learner.lrn || ''
    }));
  }

  async function getSfTemplatePreview(templateId, sheetName = '') {
    const template = (await getSfTemplates()).find(record => record.id === String(templateId));
    if (!template) throw new Error('The selected template could not be found.');
    await requestApi(`/sf-templates/${template.apiId}`);
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

  async function generateSfForm(values = {}) {
    const template = (await getSfTemplates()).find(record => record.id === String(values.templateId));
    if (!template || template.status !== RECORD_VALUES.statuses.ACTIVE || template.mappingStatus !== 'ready') {
      throw new Error('Select an active template with a verified mapping.');
    }

    const section = (await getMyAdvisorySections(['SF5', 'SF9'].includes(template.formCode))).find(record => record.id === String(values.sectionId));
    if (!section) throw new Error('You do not have access to the selected class.');

    const schoolYear = String(values.schoolYear || '').trim();
    if (!schoolYear) throw new Error('Select a school year.');

    if (EDUGNAY_API_BASE_URL) {
      const monthQuery = template.formCode === 'SF2' ? `&month=${encodeURIComponent(values.month || '')}` : '';
      const studentQuery = template.formCode === 'SF9' ? `&studentId=${encodeURIComponent(values.studentId || '')}` : '';
      if (template.formCode === 'SF9' && !values.studentId) throw new Error('Select a learner for SF9.');
      const response = await requestApi(`/sf-templates/${template.apiId}/preview?sectionId=${encodeURIComponent(section.id)}${monthQuery}${studentQuery}`);
      const generated = await window.EDUGNAY_SF_WORKBOOK.generatePreviewFromMappedCells(
        template,
        response.mappedCells || [],
        [],
        response.editableCells || []
      );
      const issues = response.issues || [];
      return {
        templateId: template.id,
        apiTemplateId: template.apiId,
        sectionId: section.id,
        studentId: template.formCode === 'SF9' ? String(values.studentId) : null,
        month: template.formCode === 'SF2' ? values.month : null,
        pages: response.pages || [response.mappedCells || []],
        editableCells: response.editableCells || [],
        breakdown: response.breakdown || [],
        schoolYear,
        fileName: `${template.formCode}_${section.grade}-${section.name}_${template.formCode === 'SF9' ? `${values.studentName || 'learner'}_` : ''}${template.formCode === 'SF2' ? `${values.month}_` : ''}${schoolYear}${template.formCode === 'SF9' ? '-draft' : ''}.xlsx`
          .replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-'),
        issues,
        previewFingerprint: response.previewFingerprint,
        hasBlockingIssues: issues.some(issue => issue.severity === 'error' && !issue.canBeCorrectedInDownload),
        exportId: null,
        ...generated
      };
    }

    throw new Error('School form generation requires the live school database.');
  }

  async function generateCombinedSfForms(values = {}) {
    if (!EDUGNAY_API_BASE_URL) throw new Error('Combined school-form generation requires the live school database.');
    const requestedIds = (Array.isArray(values.templateIds) ? values.templateIds : []).map(String);
    const templateIds = [...new Set(requestedIds)];
    if (templateIds.length !== requestedIds.length) throw new Error('A school form can only be selected once.');
    const templates = (await getSfTemplates()).filter(template => templateIds.includes(template.id));
    const formCodes = templates.map(template => template.formCode);
    if (templates.length < 2 || templates.length > 5 || templates.length !== templateIds.length
      || new Set(formCodes).size !== formCodes.length || templates.some(template => template.status !== RECORD_VALUES.statuses.ACTIVE
        || template.mappingStatus !== 'ready') || formCodes.some(code => !['SF1', 'SF2', 'SF3', 'SF5', 'SF8'].includes(code))) {
      throw new Error('Select two to five different active, verified SF templates to create one combined workbook.');
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
      const generated = await window.EDUGNAY_SF_WORKBOOK.generatePreviewFromMappedCells(
        template,
        form.mappedCells || [],
        [],
        form.editableCells || []
      );
      const issues = form.issues || [];
      return {
        templateId: template.id,
        apiTemplateId: template.apiId,
        formCode: template.formCode,
        sectionId: section.id,
        month: template.formCode === 'SF2' ? values.month : null,
        schoolYear,
        pages: form.pages?.length ? form.pages : [form.mappedCells || []],
        editableCells: form.editableCells || [],
        breakdown: form.breakdown || [],
        issues,
        hasBlockingIssues: issues.some(issue => issue.severity === 'error' && !issue.canBeCorrectedInDownload),
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
      fileName: `${formCodes.sort().join('_')}_${section.grade}-${section.name}_${values.month || schoolYear}${formCodes.some(code => ['SF5', 'SF8'].includes(code)) ? '-draft' : ''}.xlsx`
        .replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-'),
      hasBlockingIssues: forms.some(form => form.hasBlockingIssues),
      forms
    };
  }

  async function exportCombinedSfForms(values = {}) {
    if (!EDUGNAY_API_BASE_URL) throw new Error('Combined school-form downloads require the live school database.');
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
    const section = (await getMyAdvisorySections(['SF5', 'SF9'].includes(template.formCode))).find(record => record.id === String(values.sectionId));
    if (!section) throw new Error('You do not have access to the selected class.');
    if (EDUGNAY_API_BASE_URL) {
      let exportId = values.exportId;
      if (!exportId) {
        const response = await requestApi(`/sf-templates/${template.apiId}/generate`, {
          method: 'POST',
          body: JSON.stringify({
            sectionId: Number(section.id),
            studentId: template.formCode === 'SF9' ? Number(values.studentId) : undefined,
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

    throw new Error('School form downloads require the live school database.');
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


  function schoolEmailDomain(school = getActiveSchool()) {
    return String(school?.schoolEmailDomain || '').trim().toLowerCase();
  }

  const ROLE_ALIASES = {
    admin: RECORD_VALUES.roles.SCHOOL_ADMIN,
    adm: RECORD_VALUES.roles.SCHOOL_ADMIN,
    fac: RECORD_VALUES.roles.TEACHER,
    stud: RECORD_VALUES.roles.STUDENT,
    par: RECORD_VALUES.roles.PARENT,
    parents: RECORD_VALUES.roles.PARENT
  };

  function generateSchoolEmail(values = {}) {
    const role = ROLE_ALIASES[values.role] || values.role;
    const roleSuffix = {
      [RECORD_VALUES.roles.SCHOOL_ADMIN]: 'adm',
      [RECORD_VALUES.roles.TEACHER]: 'fac',
      [RECORD_VALUES.roles.STUDENT]: 'stud',
      [RECORD_VALUES.roles.PARENT]: 'par'
    }[role];
    const firstName = String(values.firstName || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    const lastName = String(values.lastName || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!firstName || !lastName || !roleSuffix) return '';

    const domain = schoolEmailDomain(values.schoolEmailDomain ? { schoolEmailDomain: values.schoolEmailDomain } : getActiveSchool());
    if (!domain) return '';
    const base = `${firstName.charAt(0)}.${lastName}.${roleSuffix}`;
    const existingEmails = new Set((Array.isArray(values.existingUsers) ? values.existingUsers : [])
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


  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' +
      date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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

  const PANEL_SKELETON_KINDS = new Set(['cards', 'child-switcher', 'stat-cards', 'section-cards', 'table-rows', 'list', 'calendar', 'profile', 'modal', 'tabs', 'chart', 'donut', 'line']);

  function renderPanelSkeleton(options = {}) {
    const kind = PANEL_SKELETON_KINDS.has(options.kind) ? options.kind : 'list';
    const label = String(options.label || options.title || 'Loading');
    const requestedRows = Number(options.rows);
    const rows = Number.isFinite(requestedRows) ? Math.max(1, Math.min(8, Math.floor(requestedRows))) : 3;
    const requestedColumns = Number(options.columns);
    const columns = Number.isFinite(requestedColumns) ? Math.max(1, Math.min(7, Math.floor(requestedColumns))) : 4;
    const shape = (className = '') => `<span class="panel-skeleton-shape ${className}"></span>`;
    let content = '';

    if (kind === 'child-switcher') {
      content = Array.from({ length: rows }, () => `<div class="child-card panel-skeleton-child-card"><span class="panel-skeleton-shape panel-skeleton-child-avatar"></span><span class="child-info panel-skeleton-child-info"><span class="panel-skeleton-shape panel-skeleton-child-name"></span><span class="panel-skeleton-shape panel-skeleton-child-section"></span></span></div>`).join('');
    } else if (kind === 'cards') {
      content = Array.from({ length: rows }, () => `<div class="panel-skeleton-card">${shape('panel-skeleton-title')}${shape()}${shape('panel-skeleton-short')}</div>`).join('');
    } else if (kind === 'stat-cards') {
      content = Array.from({ length: rows }, () => `<div class="stat-card panel-skeleton-stat-card"><span class="panel-skeleton-shape panel-skeleton-stat-icon"></span><span class="panel-skeleton-shape panel-skeleton-stat-value"></span><span class="panel-skeleton-shape panel-skeleton-stat-label"></span></div>`).join('');
    } else if (kind === 'section-cards') {
      content = Array.from({ length: rows }, () => `<article class="section-card panel-skeleton-section-card"><div class="card-body"><div class="card-head">${shape('panel-skeleton-title')}</div>${shape()}${shape('panel-skeleton-short')}</div></article>`).join('');
    } else if (kind === 'table-rows') {
      const cells = () => Array.from({ length: columns }, (_, index) => `<td aria-hidden="true"><span class="panel-skeleton-shape${index === 0 ? ' panel-skeleton-title' : ''}"></span></td>`).join('');
      content = Array.from({ length: rows }, (_, index) => `<tr class="panel-skeleton-table-tr"${index === 0 ? ` role="status" aria-live="polite" aria-busy="true" aria-label="${escapeHtml(label)}"` : ' aria-hidden="true"'}>${cells()}</tr>`).join('');
    } else if (kind === 'calendar') {
      content = Array.from({ length: 35 }, () => `<span class="cal-day panel-skeleton-calendar-day">${shape('panel-skeleton-day')}</span>`).join('');
    } else if (kind === 'profile') {
      content = `<span class="panel-skeleton-profile-head">${shape('panel-skeleton-avatar')}<span class="panel-skeleton-copy">${shape('panel-skeleton-title')}${shape('panel-skeleton-short')}</span></span><span class="panel-skeleton-profile-details">${Array.from({ length: rows }, () => `<span>${shape('panel-skeleton-short')}${shape()}</span>`).join('')}</span>`;
    } else if (kind === 'modal') {
      content = `<span class="panel-skeleton-modal-head">${shape('panel-skeleton-icon')}<span class="panel-skeleton-copy">${shape('panel-skeleton-title')}${shape('panel-skeleton-short')}</span></span>${Array.from({ length: rows }, () => `<span class="panel-skeleton-field">${shape('panel-skeleton-label')}${shape('panel-skeleton-input')}</span>`).join('')}`;
    } else if (kind === 'tabs') {
      content = Array.from({ length: rows }, (_, index) => `<span class="panel-skeleton-tab${index === 0 ? ' is-active' : ''}">${shape(index === 0 ? 'panel-skeleton-tab-label' : '')}</span>`).join('');
    } else if (kind === 'chart') {
      content = `<span class="panel-skeleton-chart-axis">${shape('panel-skeleton-chart-label')}${shape('panel-skeleton-chart-label')}${shape('panel-skeleton-chart-label')}</span><span class="panel-skeleton-chart-bars">${Array.from({ length: columns }, (_, index) => `<span class="panel-skeleton-chart-bar" style="--panel-skeleton-bar-height:${32 + ((index * 29) % 58)}%">${shape('panel-skeleton-chart-fill')}</span>`).join('')}</span>`;
    } else if (kind === 'donut') {
      content = `<span class="panel-skeleton-donut-ring"></span><span class="panel-skeleton-donut-legend">${Array.from({ length: rows }, () => `<span>${shape('panel-skeleton-icon')}${shape('panel-skeleton-short')}</span>`).join('')}</span>`;
    } else if (kind === 'line') {
      content = shape('panel-skeleton-short');
    } else {
      const rowInsetClass = options.rowInset === 'flush' ? ' panel-skeleton-row--flush' : '';
      content = Array.from({ length: rows }, () => `<span class="panel-skeleton-row${rowInsetClass}">${shape('panel-skeleton-icon')}<span class="panel-skeleton-copy">${shape('panel-skeleton-title')}${shape('panel-skeleton-short')}</span></span>`).join('');
    }

    if (kind === 'table-rows') return content;

    const wrapper = kind === 'line' ? 'span' : 'div';
    const visual = kind === 'line' ? 'span' : 'div';
    const columnStyle = kind === 'table' ? ` style="--panel-skeleton-columns:${columns}"` : '';
    const displayContentsKind = ['cards', 'child-switcher', 'stat-cards', 'section-cards', 'calendar', 'list', 'tabs'].includes(kind);
    const status = displayContentsKind ? `<span class="panel-skeleton-status" role="status" aria-live="polite" aria-busy="true" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</span>` : '';
    const wrapperClass = `panel-skeleton panel-skeleton--${kind}`;
    const statusAttributes = displayContentsKind ? '' : ' role="status" aria-live="polite"';
    return `<${wrapper} class="${wrapperClass}"${columnStyle}${statusAttributes} aria-busy="true" aria-label="${escapeHtml(label)}">${status}<${visual} class="panel-skeleton-visual" aria-hidden="true">${content}</${visual}></${wrapper}>`;
  }

  function initializeDeclaredPanelSkeletons() {
    const renderDeclared = () => {
      document.querySelectorAll('[data-skeleton-kind]').forEach(element => {
        const kind = element.getAttribute('data-skeleton-kind');
        const label = element.getAttribute('data-skeleton-label') || String(element.textContent || '').trim() || 'Loading content';
        const rows = element.getAttribute('data-skeleton-rows');
        const columns = element.getAttribute('data-skeleton-columns');
        const rowInset = element.getAttribute('data-skeleton-row-inset');
        element.innerHTML = renderPanelSkeleton({ kind, label, rows, columns, rowInset });
        element.removeAttribute('data-skeleton-kind');
        element.removeAttribute('data-skeleton-label');
        element.removeAttribute('data-skeleton-rows');
        element.removeAttribute('data-skeleton-columns');
        element.removeAttribute('data-skeleton-row-inset');
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderDeclared, { once: true });
    else renderDeclared();
  }

  /* Shared empty-state markup for data panels. */
  function renderPanelEmptyState(options = {}) {
    const icon = String(options.icon || 'inbox').replace(/[^a-z0-9-]/gi, '');
    const title = String(options.title || 'Nothing to show yet');
    const text = String(options.text || 'Records will appear here when they are available.');

    queuePanelEmptyIconRender();
    return `<div class="panel-empty-state" role="status"><div class="panel-empty-state-icon" aria-hidden="true"><i data-lucide="${icon}"></i></div><div class="panel-empty-state-title">${escapeHtml(title)}</div><div class="panel-empty-state-text">${escapeHtml(text)}</div></div>`;
  }

  Object.assign(window.EDUGNAY_API, {
    getShsGradeWorkspace: scope => requestApi(`/shs-grades/workspace?${new URLSearchParams(scope)}`),
    previewShsGrades: scope => requestApi(`/shs-grades/preview?${new URLSearchParams(scope)}`),
    createShsGradingItem: values => requestApi('/shs-grades/items', {
      method: 'POST', body: JSON.stringify(values)
    }),
    saveShsScore: values => requestApi('/shs-grades/scores', {
      method: 'PUT', body: JSON.stringify(values)
    }),
    correctShsScore: values => requestApi('/shs-grades/scores/correction', {
      method: 'PUT', body: JSON.stringify(values)
    }),
    publishShsGrades: values => requestApi('/shs-grades/publish', {
      method: 'POST', body: JSON.stringify(values)
    }),
    getShsTeachingClasses: () => requestApi('/shs-teaching/classes'),
    getShsElectiveRoster: classId => requestApi(`/shs-teaching/classes/${Number(classId)}/roster`),
    getShsElectiveStudentDetails: (classId, studentId) => requestApi(
      `/shs-teaching/classes/${Number(classId)}/students/${Number(studentId)}/details`),
    getShsElectiveAttendance: async (classId, date = '') => {
      const query = date ? `?date=${encodeURIComponent(date)}` : '';
      return normalizeApiAttendanceData(await requestApi(`/shs-teaching/classes/${Number(classId)}/attendance${query}`));
    },
    saveShsElectiveAttendance: async (classId, values = {}) => normalizeApiAttendanceData(await requestApi(
      `/shs-teaching/classes/${Number(classId)}/attendance`, {
        method: 'PUT', body: JSON.stringify({ attendanceDate: values.attendanceDate, records: values.records || [] })
      })),
    getShsElectiveAttendanceHistory: classId => requestApi(`/shs-teaching/classes/${Number(classId)}/attendance/history`),
    getShsElectiveQrAttendance: async classId => normalizeApiAttendanceData(await requestApi(
      `/shs-teaching/classes/${Number(classId)}/qr-attendance`)),
    startShsElectiveQrAttendance: async classId => normalizeApiAttendanceData(await requestApi(
      `/shs-teaching/classes/${Number(classId)}/qr-attendance/start`, { method: 'POST' })),
    scanShsElectiveQrAttendance: (sessionId, qrToken) => requestApi(
      `/shs-teaching/qr-sessions/${Number(sessionId)}/scan`, { method: 'POST', body: JSON.stringify({ qrToken }) }),
    confirmShsElectiveQrAttendance: async (sessionId, records = []) => normalizeApiAttendanceData(await requestApi(
      `/shs-teaching/qr-sessions/${Number(sessionId)}/confirm`, { method: 'PUT', body: JSON.stringify({ records }) })),
    createShsElectiveAssignment: (classId, values) => requestApi(`/shs-teaching/classes/${Number(classId)}/assignments`, {
      method: 'POST', body: JSON.stringify(values || {})
    }),
    uploadShsElectiveMaterial: (classId, values = {}) => {
      const formData = new FormData();
      formData.append('title', values.title || '');
      formData.append('status', values.status || 'published');
      if (values.file) formData.append('file', values.file);
      return requestApiMultipart(`/shs-teaching/classes/${Number(classId)}/materials`, formData);
    },
    getMaterials: getApiMaterials,
    uploadMaterial: uploadApiMaterial,
    updateMaterial: updateApiMaterial,
    deleteMaterial: deleteApiMaterial,
    materialFileUrl: apiMaterialFileUrl,
    getMaterialFile: getApiMaterialFile,
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
    enrollStudentsBulk: enrollApiStudentsBulk,
    moveStudent: moveApiStudent,
    previewStudentMove: previewApiStudentMove,
    withdrawStudent: withdrawApiStudent,
    assignTeacher: assignApiTeacher,
    removeTeacherAssignment: removeApiTeacherAssignment,
    updateTeacherAssignment: updateApiTeacherAssignment
  });

  window.EDUGNAY_CONFIG = {
    values: RECORD_VALUES,
    grades: GRADE_CATALOG,
    parentRelationships: PARENT_RELATIONSHIPS,
    academicPeriodTypes: ACADEMIC_PERIOD_TYPES,
    attendanceDefaults: makeAttendanceRules(),
    createDivision,
    createAcademicPeriods,
    validateAcademicTermConfig,
    getAcademicPeriodReminder,
    getCurrentAcademicPeriod,
    getActiveSchool,
    getActiveSchoolId,
    getSchoolTypeInfo,
    buildFinalGradeYears: buildApiFinalGradeYears,
    gradeScoreClass,
    isGradesPageEnabled,
    isAttendanceEnabled,
    isNarrativeReportsEnabled,
    isJournalsEnabled,
    getMyTeachingSections,
    getMyAdvisorySections,
    getSfTemplates,
    getSfTemplateLearners,
    getSfTemplatePreview,
    downloadSfTemplate,
    downloadBlankCombinedSfTemplates,
    generateSfForm,
    generateCombinedSfForms,
    exportSfForm,
    exportCombinedSfForms,
    generateSchoolEmail,
    parseAttendanceQrPayload,
    generateAttendanceQrDataUrl,
    formatDateTime,
    escapeHtml,
    getInitials,
    renderPanelEmptyState,
    renderPanelSkeleton
  };
  initializeDeclaredPanelSkeletons();
})();

/* Shared searchable select enhancement. The native select stays in the form
   as the source of truth, while the visible combobox makes long user lists
   easier to browse and search. Replace the option source with API data later
   without changing the form field contract. */
(function initializeSearchableSelectSupport() {
  const states = new WeakMap();
  let opened = null;
  if (!document.querySelector('link[href*="modal-system.css"]') && document.currentScript?.src) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('../css/modal-system.css', document.currentScript.src).href;
    document.head.appendChild(stylesheet);
  }

  function normalize(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  function getOptionRecords(state) {
    return Array.from(state.select.options)
      .map(option => ({
        value: option.value,
        label: option.textContent.trim(),
        disabled: option.disabled || option.parentElement?.disabled === true
      }))
      .filter(option => option.label);
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
    state.wrapper.hidden = state.select.hidden || window.getComputedStyle(state.select).display === 'none';
    if (state.wrapper.hidden && state.open) closeSelect(state);
    state.input.disabled = state.select.disabled;
    state.input.setAttribute('aria-required', String(state.select.required));
    state.wrapper.classList.toggle('is-disabled', state.select.disabled);
    state.wrapper.classList.toggle('is-invalid', state.select.required && !state.select.value && state.wrapper.classList.contains('is-invalid'));
    state.searchable = state.people || getOptionRecords(state).filter(option => option.value).length > 10;
    state.input.readOnly = !state.searchable;
    state.input.setAttribute('aria-autocomplete', state.searchable ? 'list' : 'none');

    if (!state.open) {
      state.input.value = selected?.label || '';
      state.input.placeholder = state.select.options[0]?.textContent.trim() || state.placeholder;
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
    const options = getOptionRecords(state).filter(option =>
      (option.value || option.value === state.select.value) &&
      (!term || normalize(option.label).includes(term)));

    state.visibleOptions = options;
    state.activeIndex = -1;
    state.menu.replaceChildren();
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
      if (option.disabled) {
        item.setAttribute('aria-disabled', 'true');
        item.classList.add('is-disabled');
      }
      if (option.value === state.select.value) item.classList.add('is-selected');

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

      if (state.people) {
        const avatar = document.createElement('span');
        avatar.className = 'searchable-select-option-avatar';
        avatar.textContent = initialsFor(copy.main);
        item.appendChild(avatar);
      }
      item.appendChild(text);
      item.addEventListener('mousedown', event => event.preventDefault());
      item.addEventListener('click', () => chooseOption(state, option.value));
      state.menu.appendChild(item);
    });
  }

  function openSelect(state) {
    if (state.select.disabled) return;
    if (!state.open) {
      if (opened && opened !== state) closeSelect(opened);
      opened = state;
      state.open = true;
      state.wrapper.classList.add('is-open');
      state.menu.classList.add('is-open');
      state.input.setAttribute('aria-expanded', 'true');
      state.input.placeholder = state.searchable ? state.searchPlaceholder : state.placeholder;
      if (state.searchable) state.input.value = '';
      renderOptions(state, '');
      positionMenu(state);
    }
  }

  function closeSelect(state) {
    if (opened === state) opened = null;
    state.open = false;
    state.wrapper.classList.remove('is-open');
    state.menu.classList.remove('is-open');
    state.input.setAttribute('aria-expanded', 'false');
    state.input.removeAttribute('aria-activedescendant');
    syncInput(state);
  }

  function bindSelectTriggerEvents(input, state) {
    input.addEventListener('pointerdown', () => { state.pointerDown = true; });
    document.addEventListener('pointerup', () => { state.pointerDown = false; });
    document.addEventListener('pointercancel', () => { state.pointerDown = false; });
    input.addEventListener('focus', () => {
      if (!state.pointerDown) openSelect(state);
    });
    input.addEventListener('click', () => {
      if (state.open) closeSelect(state);
      else openSelect(state);
    });
  }

  function positionMenu(state) {
    if (!state.open) return;
    const rect = state.wrapper.getBoundingClientRect();
    const availableBelow = window.innerHeight - rect.bottom;
    const above = availableBelow < 230 && rect.top > availableBelow;
    state.menu.style.left = `${Math.max(8, rect.left)}px`;
    state.menu.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
    state.menu.style.top = above ? 'auto' : `${rect.bottom + 5}px`;
    state.menu.style.bottom = above ? `${window.innerHeight - rect.top + 5}px` : 'auto';
    state.menu.style.maxHeight = `${Math.max(80, Math.min(224, above ? rect.top - 16 : availableBelow - 16))}px`;
  }

  function chooseOption(state, value) {
    const option = getOptionRecords(state).find(record => record.value === value);
    if (!option || option.disabled) return;
    state.select.value = option.value;
    closeSelect(state);
    state.select.dispatchEvent(new Event('change', { bubbles: true }));
    state.input.focus();
  }

  function handleKeydown(state, event) {
    if (event.key === 'Escape') {
      if (state.open) {
        event.preventDefault();
        closeSelect(state);
      }
      return;
    }

    if (event.key === 'Tab') { closeSelect(state); return; }
    if (event.key === 'Home' || event.key === 'End') {
      if (!state.open) return;
      event.preventDefault();
      setActiveOption(state, event.key === 'Home' ? 0 : state.visibleOptions.length - 1);
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
      if (option && !option.disabled) {
        event.preventDefault();
        chooseOption(state, option.value);
      }
    }
    if ((event.key === ' ' || event.key === 'Enter') && !state.open && !state.searchable) {
      event.preventDefault();
      openSelect(state);
    }
  }

  function createSearchableSelect(selectOrSelector, settings = {}) {
    const select = typeof selectOrSelector === 'string'
      ? document.querySelector(selectOrSelector)
      : selectOrSelector;
    if (!select || select.tagName !== 'SELECT' || select.multiple || select.size > 1 || select.dataset.nativeSelect === 'true') return null;
    if (states.has(select)) return states.get(select);

    const wrapper = document.createElement('div');
    const control = document.createElement('div');
    const input = document.createElement('input');
    const menu = document.createElement('div');
    const baseId = select.id || `searchable-select-${Math.random().toString(36).slice(2)}`;

    const people = Boolean(settings.people || settings.avatar || settings.searchPlaceholder || select.id === 'teacherSelect');
    wrapper.className = `searchable-select ${people ? 'searchable-select-people' : 'searchable-select-plain'}`;
    wrapper.dataset.searchableSelect = 'true';
    control.className = 'searchable-select-control';
    input.className = 'searchable-select-input';
    input.type = 'text';
    input.id = settings.inputId || `${baseId}-search`;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', `${baseId}-options`);
    const labels = Array.from(select.labels || []);
    const label = labels[0];
    input.setAttribute('aria-label', settings.ariaLabel || select.getAttribute('aria-label') || label?.textContent.trim() || 'Select an option');
    const labelledBy = [select.getAttribute('aria-labelledby'), ...labels.map((associatedLabel, index) => {
      if (!associatedLabel.id) associatedLabel.id = `${baseId}-label-${index + 1}`;
      associatedLabel.addEventListener('click', event => {
        if (wrapper.contains(event.target)) return;
        event.preventDefault();
        if (select.disabled) return;
        input.focus({ preventScroll: true });
        openSelect(state);
      });
      return associatedLabel.id;
    })].filter(Boolean).join(' ');
    if (labelledBy) input.setAttribute('aria-labelledby', labelledBy);
    if (select.hasAttribute('aria-describedby')) input.setAttribute('aria-describedby', select.getAttribute('aria-describedby'));

    menu.className = 'searchable-select-menu';
    if (!people) menu.classList.add('searchable-select-plain-menu');
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
      people,
      open: false,
      pointerDown: false,
      activeIndex: -1,
      visibleOptions: []
    };

    select.classList.add('searchable-select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(control, select);
    document.body.appendChild(menu);
    control.appendChild(input);

    bindSelectTriggerEvents(input, state);
    input.addEventListener('input', () => {
      if (!state.searchable) return;
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
      wrapper.classList.remove('is-invalid');
      syncInput(state);
      if (state.open) renderOptions(state, input.value);
    });
    const valueProperty = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() { return valueProperty.get.call(this); },
      set(value) { valueProperty.set.call(this, value); syncInput(state); }
    });
    select.addEventListener('invalid', event => {
      event.preventDefault();
      wrapper.classList.add('is-invalid');
      input.focus();
    });
    select.form?.addEventListener('reset', () => window.setTimeout(() => syncInput(state), 0));
    document.addEventListener('click', event => {
      if (!wrapper.contains(event.target) && !menu.contains(event.target)) closeSelect(state);
    });
    window.addEventListener('resize', () => positionMenu(state));
    window.addEventListener('scroll', () => positionMenu(state), true);

    if ('MutationObserver' in window) {
      const observer = new MutationObserver(() => {
        syncInput(state);
        if (state.open) renderOptions(state, input.value);
      });
      observer.observe(select, {
        attributes: true,
        attributeFilter: ['disabled', 'hidden', 'style', 'class'],
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
  function enhanceSelects(root = document) {
    if (root.matches?.('select')) createSearchableSelect(root);
    root.querySelectorAll?.('select').forEach(select => createSearchableSelect(select));
  }
  function start() {
    enhanceSelects();
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === 1) enhanceSelects(node);
    }))).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
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
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && getPortalRoleFromPath()) {
    try {
      const appRoot = new URL('../../', window.location.href);
      const registration = await navigator.serviceWorker.getRegistration(appRoot.href);
      await (await registration?.pushManager?.getSubscription())?.unsubscribe();
    } catch { /* Server-side session removal also disables this device. */ }
  }
  if (EDUGNAY_API_BASE_URL) {
    try {
      await requestApi('/auth/logout', { method: 'POST' });
    } catch {
      // Clear the frontend session even when the server session has expired.
    }
  }

  try {
    sessionStorage.removeItem(EDUGNAY_SESSION_STORAGE_KEY);
    clearTeacherSidebarCache();
    clearStudentSidebarCache();
    clearParentSidebarCache();
    clearProfileDisplaySnapshot();
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
  const brandLabels = document.querySelectorAll('.brand-sub:not([data-platform-brand])');
  if (!school) {
    brandLabels.forEach(element => { element.textContent = ''; });
    return;
  }
  const typeLabel = config.getSchoolTypeInfo(school.schoolLevels).label;
  const schoolYear = String(school.schoolYear || '').trim();

  brandLabels.forEach(element => {
    element.textContent = String(school.shortName || '').trim();
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
    element.textContent = schoolYear;
  });
  document.querySelectorAll('[data-active-academic-period]').forEach(element => {
    const schoolLevel = element.dataset.schoolLevel || school.activeDivision;
    const activePeriod = config.getCurrentAcademicPeriod(school.id, schoolLevel);
    const schoolYearSuffix = schoolYear ? ` · S.Y. ${schoolYear}` : '';
    const activePeriodLabel = activePeriod
      ? `${activePeriod.name}${schoolYearSuffix}`
      : `No active grading period${schoolYearSuffix}`;
    element.textContent = activePeriodLabel;
  });
  document.querySelectorAll('[data-school-context]').forEach(element => {
    element.textContent = schoolYear ? `${typeLabel} · ${schoolYear}` : typeLabel;
  });
  document.body.dataset.activeSchool = school.id;
  document.body.dataset.schoolType = school.schoolType;
  document.body.dataset.gradesPageEnabled = String(config.isGradesPageEnabled(school));
}

document.addEventListener('edugnay:school-context-updated', applyActiveSchoolToShell);

/* Keep the grade portal policy in one place so every student and parent page
   responds to the same school setting. The server should enforce this policy
   again after backend integration; this client guard is for the current
   frontend flow and prevents stale direct links from opening the page. */
function applyGradePortalAccess() {
  if (document.body?.dataset.platformPortal === 'true') return;

  const pageName = location.pathname.split('/').pop().toLowerCase();
  const isStudentOrParentPage = /edugnay-(student|parent)-/.test(pageName);
  if (!isStudentOrParentPage) return;
  if (pageName.startsWith('edugnay-parent-')) return; // Parent shell owns its sidebar and page guard.

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
const scrollFadeRefreshers = new WeakMap();

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
    '.section-tab-bar',
    '.subject-scroll-fade-tab-row'
  ].join(', ');

  document.querySelectorAll(selector).forEach(element => {
    if (element.dataset.scrollFadeReady === 'true') {
      scrollFadeRefreshers.get(element)?.();
      return;
    }
    element.dataset.scrollFadeReady = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'scroll-fade-wrap';
    if (!element.classList.contains('child-switcher')) {
      wrapper.classList.add('tabs-fade', 'light-tabs-fade');
    }

    element.parentNode.insertBefore(wrapper, element);
    wrapper.appendChild(element);

    const isActivityFilters = element.classList.contains('activity-type-filters');
    const isSubjectTabs = element.classList.contains('subject-scroll-fade-tab-row');
    const hasScrollButton = isActivityFilters || isSubjectTabs || element.classList.contains('school-tabs');
    const scrollTarget = isActivityFilters
      ? 'activity categories'
      : isSubjectTabs
        ? element.dataset.scrollTarget || 'subject tabs'
        : 'school settings tabs';
    const scrollButtonSpace = isActivityFilters ? 40 : isSubjectTabs ? 44 : 0;
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
        const visibleWidth = element.clientWidth - (isActivityFilters ? scrollButtonSpace : 0);
        element.scrollBy({ left: Math.max(120, visibleWidth * 0.8), behavior });
      });
    }

    const updateFade = () => {
      const isDesktop = hasScrollButton && window.matchMedia('(min-width: 761px)').matches;
      const canShowButton = isSubjectTabs || isDesktop;
      const hasReservedButtonSpace = canShowButton && wrapper.classList.contains('has-scroll-control');
      const reservedSpace = hasReservedButtonSpace ? scrollButtonSpace : 0;
      const contentOverflows = element.scrollWidth - element.clientWidth - reservedSpace > 4;

      if (hasScrollButton) {
        const showButton = canShowButton && contentOverflows;
        wrapper.classList.toggle('has-scroll-control', showButton);
        scrollButton.hidden = !showButton;

        const buttonSpace = showButton && isActivityFilters ? scrollButtonSpace : 0;
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

    scrollFadeRefreshers.set(element, updateFade);
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

    const isHoverTarget = target => Boolean(target && (
      target === sidebar || sidebar.contains(target)
      || target === scrollbar || scrollbar.contains(target)
    ));

    if (sidebar.matches?.(':hover')) scrollbar.classList.add('is-hovered');

    const updateHoverState = event => {
      if (event.type === 'pointerenter') scrollbar.classList.add('is-hovered');
      else scrollbar.classList.toggle('is-hovered', isHoverTarget(event.relatedTarget));
      scheduleUpdate();
    };

    sidebar.addEventListener('pointerenter', updateHoverState);
    sidebar.addEventListener('pointerleave', updateHoverState);
    scrollbar.addEventListener('pointerenter', updateHoverState);
    scrollbar.addEventListener('pointerleave', updateHoverState);

    const stopDragging = event => {
      if (!dragging) return;
      dragging = false;
      scrollbar.classList.remove('is-dragging');
      if ((event.type === 'pointerup' || event.type === 'pointercancel')
        && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        const target = document.elementFromPoint?.(event.clientX, event.clientY);
        if (target) scrollbar.classList.toggle('is-hovered', isHoverTarget(target));
      }
      scheduleUpdate();
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
  if (!isPublicPage()) applyActiveSchoolToShell();
  let apiSession = null;
  if (!isPublicPage() && EDUGNAY_API_BASE_URL) {
    if (!document.documentElement.classList.contains('profile-chip-restored')) {
      document.documentElement.classList.remove('profile-chip-restoring');
      setCurrentUserShellStatus('Loading account...');
    }
    try {
      apiSession = await getCurrentUser();
      applyCurrentUserToShell(apiSession);
    } catch (error) {
      if (error.status === 401) {
        try { sessionStorage.removeItem(EDUGNAY_SESSION_STORAGE_KEY); } catch {}
        clearTeacherSidebarCache();
        clearStudentSidebarCache();
        clearParentSidebarCache();
        clearProfileDisplaySnapshot();
      }
      if (error.status === 401 || !document.documentElement.classList.contains('profile-chip-restored')) {
        setCurrentUserShellStatus('Account unavailable', 'Connection issue');
      }
      showAppToast('Your account could not be loaded from the school database. Refresh when the connection is restored.', 'error');
    }
    if (apiSession?.apiSchoolId) {
      try {
        await window.EDUGNAY_SCHOOL_READY;
      } catch (error) {
        showAppToast('School information could not be loaded. Refresh when the connection is restored.', 'error');
      }
    }
  } else if (!isPublicPage()) {
    applyCurrentUserToShell(window.EDUGNAY_SESSION);
  }
  if (!isPublicPage()) {
    applyCurrentDateToGradingBanners();
    applyActiveSchoolToShell();
    applyGradePortalAccess();
  }
  applyPageTitleToTopbar();
  initScrollFades();
  initSidebarScrollbars();
});
