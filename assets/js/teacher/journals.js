lucide.createIcons();

/* ══════ DATA ══════ */
let SECTIONS = {};
let SECTION_TABS = [];
let STUDENT_BY_ID = {};
let currentSection = '';
let currentPromptId = '';
let settingsWeekStart = '';
let editingPromptId = '';
let activeStudentIds = [];
let activeStudentIndex = 0;
let journalHistoryPrompts = [];
let journalHistoryEntries = [];
let journalTeacherId = '';
let pendingJournalDeleteId = '';
const JOURNAL_SETTINGS = { day: 'Friday', deadline: '23:59', minWords: 50, allowLate: false };

function localDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function dateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function mondayDate(date = new Date()) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function dateTimeInputValue(value) {
  const date = localDate(value);
  return `${dateInputValue(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatJournalDate(value) {
  const input = String(value || '');
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(input) ? `${input}T00:00:00` : input.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function dueDateForWeek(weekStart, dayName, time) {
  const dayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(dayName);
  const date = localDate(`${weekStart}T00:00:00`);
  date.setDate(date.getDate() + ((dayIndex + 6) % 7));
  const [hours, minutes] = time.split(':').map(Number);
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

function openSettingsDrawer() {
  const sec = SECTIONS[currentSection];
  if (!sec) return;
  const prompt = sec.prompts.find(item => item.id === currentPromptId) || null;
  const hasSubmissions = prompt && sec.entries.some(entry => entry.promptId === prompt.id);
  editingPromptId = prompt && prompt.status === 'open' && !hasSubmissions ? prompt.id : '';
  if (editingPromptId) {
    settingsWeekStart = prompt.weekStartDate;
  } else {
    const latestPrompt = sec.prompts[0] || null;
    const base = latestPrompt ? localDate(`${latestPrompt.weekStartDate}T00:00:00`) : mondayDate();
    if (latestPrompt) base.setDate(base.getDate() + 7);
    settingsWeekStart = dateInputValue(mondayDate(base));
  }

  const promptInput = document.getElementById('settings-prompt-input');
  promptInput.value = editingPromptId ? prompt.promptText : '';
  document.getElementById('settings-section-name').textContent = sec.label;
  updatePromptCounter();

  const deadline = editingPromptId ? localDate(prompt.dueAt) : null;
  document.getElementById('settings-day').value = deadline
    ? deadline.toLocaleDateString('en-US', { weekday: 'long' })
    : JOURNAL_SETTINGS.day;
  document.getElementById('settings-deadline').value = deadline
    ? `${String(deadline.getHours()).padStart(2, '0')}:${String(deadline.getMinutes()).padStart(2, '0')}`
    : JOURNAL_SETTINGS.deadline;
  document.getElementById('settings-minwords').value = editingPromptId ? prompt.minWords : JOURNAL_SETTINGS.minWords;
  setToggle('toggle-allow-late', editingPromptId ? prompt.allowLate : JOURNAL_SETTINGS.allowLate);

  const gradingSelect = document.getElementById('settings-grading-item');
  const items = sec.gradingItems.filter(item => item.subjectId === sec.subjectId);
  gradingSelect.replaceChildren(new Option(items.length ? 'Choose gradebook item' : 'Create a score item first', ''));
  items.forEach(item => gradingSelect.add(new Option(`${item.name} · ${item.max}`, item.id)));
  gradingSelect.value = editingPromptId ? (prompt.gradingItemId || '') : '';
  gradingSelect.disabled = items.length === 0;
  document.getElementById('settingsBackdrop').classList.add('open');
  lucide.createIcons();
}

function closeSettingsDrawer() {
  document.getElementById('settingsBackdrop').classList.remove('open');
}

function setToggle(id, isOn) {
  document.getElementById(id).classList.toggle('on', isOn);
}

function updatePromptCounter() {
  document.getElementById('prompt-char-count').textContent = document.getElementById('settings-prompt-input').value.length;
}

async function saveJournalSettings() {
  const sec = SECTIONS[currentSection];
  const newPrompt = document.getElementById('settings-prompt-input').value.trim();
  const minWords = Number(document.getElementById('settings-minwords').value);
  const gradingItemId = document.getElementById('settings-grading-item').value;
  const day = document.getElementById('settings-day').value;
  const deadline = document.getElementById('settings-deadline').value;
  const allowLate = document.getElementById('toggle-allow-late').classList.contains('on');
  if (!sec || !newPrompt || !gradingItemId || !deadline || !Number.isInteger(minWords) || minWords < 10 || minWords > 2000) {
    showAppToast('Enter a prompt, minimum word count, deadline, and gradebook item.', 'error');
    return;
  }

  const dueDate = dueDateForWeek(settingsWeekStart, day, deadline);
  let opensAt = new Date();
  if (editingPromptId) opensAt = localDate(sec.prompts.find(item => item.id === editingPromptId)?.opensAt);
  if (dueDate <= opensAt && editingPromptId) {
    showAppToast('The deadline must be after the opening time.', 'error');
    return;
  }
  if (dueDate <= opensAt) {
    let nextWeek = mondayDate();
    if (dueDateForWeek(dateInputValue(nextWeek), day, deadline) <= opensAt) nextWeek.setDate(nextWeek.getDate() + 7);
    settingsWeekStart = dateInputValue(nextWeek);
  }
  const finalDueDate = dueDateForWeek(settingsWeekStart, day, deadline);
  if (finalDueDate <= opensAt) {
    showAppToast('The deadline must be after the opening time.', 'error');
    return;
  }
  const payload = {
    sectionId: sec.id,
    gradingItemId,
    weekStartDate: settingsWeekStart,
    promptText: newPrompt,
    opensAt: dateTimeInputValue(opensAt),
    dueAt: dateTimeInputValue(finalDueDate),
    minWords,
    allowLate
  };

  try {
    if (editingPromptId) await window.EDUGNAY_API.updateJournalPrompt(editingPromptId, payload);
    else await window.EDUGNAY_API.createJournalPrompt(payload);
    closeSettingsDrawer();
    showAppToast('Journal prompt saved.', 'success');
    await loadTeacherJournals();
  } catch (error) {
    showAppToast(error.message || 'Unable to save journal prompt.', 'error');
  }
}

function buildJournalSummaryCards() {
  const rosters = Object.values(SECTIONS).flatMap(section => section.roster || []);
  const students = Object.values(SECTIONS).flatMap(section => section.prompt ? section.students : []);
  const submittedStudents = students.filter(student => student.submitted);
  const pendingReviewStudents = submittedStudents.filter(student => !student.reviewed);
  const notSubmittedStudents = students.filter(student => !student.submitted);
  return [
    { tone: 'purple', icon: 'notebook-pen', records: rosters, label: 'Total students', sub: 'Students in your sections' },
    { tone: 'green', icon: 'send', records: submittedStudents, label: 'Submitted this week', sub: 'Entries received so far' },
    { tone: 'orange', icon: 'hourglass', records: pendingReviewStudents, label: 'Pending review', sub: 'Entries waiting for a score' },
    { tone: 'red', icon: 'circle-x', records: notSubmittedStudents, label: 'Not submitted', sub: 'Students to remind' },
  ];
}

function renderJournalSummary() {
  const strip = document.getElementById('journal-summary-strip');
  if (!strip) return;
  strip.innerHTML = buildJournalSummaryCards().map(card => `<div class="stat-card ${card.tone}"><div class="stat-card-top"><div class="stat-card-icon"><i data-lucide="${card.icon}" style="width:18px;height:18px;"></i></div></div><div class="stat-card-num">${card.records.length}</div><div class="stat-card-label">${card.label}</div><div class="stat-card-sub">${card.sub}</div></div>`).join('');
  lucide.createIcons();
}

function renderJournalSectionTabs() {
  const tabs = document.getElementById('journal-section-tabs');
  if (!tabs) return;
  SECTION_TABS = Object.entries(SECTIONS).map(([key, section]) => ({ key, label: section.label, count: section.roster.length }));
  tabs.innerHTML = SECTION_TABS.length
    ? SECTION_TABS.map(section => `<button class="section-tab ${section.key === currentSection ? 'active' : ''}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { switchSection(String(section.key)) })}" id="tab-${section.key}">${window.EDUGNAY_CONFIG.escapeHtml(section.label)}<span class="tab-count">${section.count}</span></button>`).join('')
    : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'door-open', title: 'No sections assigned', text: 'Sections assigned to you will appear here.' });
  lucide.createIcons();
}

/* ══════ SECTION SWITCH ══════ */
function selectSectionPrompt(section, promptId) {
  section.prompt = section.prompts.find(prompt => prompt.id === promptId) || null;
  currentPromptId = section.prompt?.id || '';
  section.students = section.roster.map(student => {
    const entry = section.prompt
      ? section.entries.find(record => record.promptId === section.prompt.id && record.studentId === student.id)
      : null;
    return {
      studentId: student.id,
      entryId: entry?.id || null,
      promptId: section.prompt?.id || '',
      promptText: section.prompt?.promptText || '',
      week: section.prompt ? `Week of ${formatJournalDate(section.prompt.weekStartDate)}` : '',
      dateRange: section.prompt ? `Due ${formatJournalDate(section.prompt.dueAt)}` : '',
      submitted: Boolean(entry),
      reviewed: entry?.reviewed || false,
      late: entry?.isLate || false,
      score: entry?.score ?? null,
      maxScore: entry?.maxScore || section.prompt?.maxScore || 50,
      entryText: entry?.entryText || '',
      submittedAt: entry?.submittedAt || null,
    };
  });
}

function renderPromptOptions(section) {
  const select = document.getElementById('week-filter');
  select.innerHTML = section.prompts.map(prompt => {
    const label = `Week of ${formatJournalDate(prompt.weekStartDate)}`;
    return `<option value="${prompt.id}">${window.EDUGNAY_CONFIG.escapeHtml(label)}</option>`;
  }).join('');
  select.value = currentPromptId;
  select.hidden = section.prompts.length < 2;
}

function switchSection(sectionKey) {
  currentSection = sectionKey;
  document.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${sectionKey}`)?.classList.add('active');

  const sec = SECTIONS[sectionKey];
  if (!sec) return;
  document.getElementById('panel-title').textContent = `Journal Entries: ${sec.label}`;
  document.getElementById('search-input').value = '';
  document.getElementById('status-filter').value = 'all';
  currentPromptId = sec.prompts[0]?.id || '';
  selectSectionPrompt(sec, currentPromptId);
  renderPromptOptions(sec);
  renderTable();
}

function selectJournalPrompt(promptId) {
  const sec = SECTIONS[currentSection];
  if (!sec) return;
  selectSectionPrompt(sec, promptId);
  renderTable();
}

/* ══════ RENDER TABLE ══════ */
function renderTable() {
  const sec = SECTIONS[currentSection];
  if (!sec) return;
  const noPromptEl = document.getElementById('noPromptState');
  const toolbar = document.querySelector('.toolbar');
  const tableWrap = document.querySelector('.table-wrap');
  const tableFooter = document.getElementById('table-footer');

  if (!sec.prompt) {
      if (!noPromptEl.innerHTML.trim()) {
        noPromptEl.innerHTML = `${window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: 'notebook-pen',
        title: 'No journal prompt set yet',
        text: "Students in this section cannot submit a journal entry until a weekly prompt is published. Set one up to open submissions."
      })}<button class="top-btn primary panel-empty-action" type="button" data-page-click="g89b3cc6496e2"><i data-lucide="plus" style="width:13px;height:13px;"></i> Create this week's prompt</button>`;
    }
    noPromptEl.style.display = 'block';
    toolbar.style.display = 'none';
    tableWrap.style.display = 'none';
    tableFooter.style.display = 'none';
    lucide.createIcons();
    return;
  }

  noPromptEl.style.display = 'none';
  toolbar.style.display = 'flex';
  tableWrap.style.display = 'block';
  tableFooter.style.display = 'block';

  const query = document.getElementById('search-input').value.toLowerCase();
  const statusFilter = document.getElementById('status-filter').value;

  const filtered = sec.students.filter(s => {
    const student = STUDENT_BY_ID[s.studentId];
    if (!student) return false;
    if (query && !student.displayName.toLowerCase().includes(query)) return false;
    if (statusFilter === 'submitted' && !s.submitted) return false;
    if (statusFilter === 'not_submitted' && s.submitted) return false;
    if (statusFilter === 'reviewed' && !s.reviewed) return false;
    if (statusFilter === 'pending' && (s.reviewed || !s.submitted)) return false;
    if (statusFilter === 'late' && !s.late) return false;
    return true;
  });

  activeStudentIds = filtered.map(s => s.studentId);

  const tbody = document.getElementById('journal-tbody');

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr class="panel-empty-row"><td colspan="7">${window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'notebook-pen', title: 'No entries found', text: 'Try adjusting your search or filter.' })}</td></tr>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  tbody.innerHTML = filtered.map((s, i) => {
    const student = STUDENT_BY_ID[s.studentId];
    if (!student) return '';
    const excerpt = s.submitted && s.entryText ? window.EDUGNAY_CONFIG.escapeHtml(s.entryText.slice(0, 90) + (s.entryText.length > 90 ? '…' : '')) : '—';

    let scoreCellHtml;
    if (!s.submitted) {
      scoreCellHtml = `<span class="score-none">—</span>`;
    } else if (s.score !== null) {
      const percentage = s.maxScore ? s.score / s.maxScore : 0;
      const cls = percentage >= 0.8 ? 'score-pass' : percentage >= 0.6 ? 'score-warn' : 'score-fail';
      scoreCellHtml = `<span class="score-chip"><span class="score-val ${cls}">${s.score}</span><span class="score-max">/${s.maxScore}</span></span>`;
    } else {
      scoreCellHtml = `<span class="score-none">Not scored</span>`;
    }

    let statusBadge;
    if (!s.submitted) {
      statusBadge = `<span class="badge badge-gray">Not submitted</span>`;
    } else if (s.reviewed) {
      statusBadge = `<span class="badge badge-green"><i data-lucide="check" style="width:10px;height:10px;"></i> Reviewed</span>`;
    } else {
      statusBadge = `<span class="badge badge-orange">Pending review</span>`;
    }

    return `
      <tr class="${s.reviewed ? 'reviewed' : ''}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openEntry(String(s.studentId)) })}">
        <td style="color:var(--gray-400);font-size:12px;">${i + 1}</td>
        <td>
          <div class="student-cell">
            ${window.EDUGNAY_AVATAR.html(student, { className: 'student-av', role: 'student' })}
            <div>
              <div class="student-name">${window.EDUGNAY_CONFIG.escapeHtml(student.displayName)}</div>
            </div>
          </div>
        </td>
        <td><div class="entry-preview">${excerpt}</div></td>
        <td class="center">
          ${s.submitted
            ? (s.late
                ? `<span class="badge badge-gold"><i data-lucide="clock-alert" style="width:10px;height:10px;"></i> Late</span>`
                : `<span class="badge badge-blue"><i data-lucide="check" style="width:10px;height:10px;"></i> Yes</span>`)
            : `<span class="badge badge-red">No</span>`}
        </td>
        <td class="center">${scoreCellHtml}</td>
        <td class="center">${statusBadge}</td>
        <td>
          <button class="row-btn primary" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { event.stopPropagation();openEntry(String(s.studentId)) })}">
            <i data-lucide="eye" style="width:11px;height:11px;"></i> Review
          </button>
        </td>
      </tr>`;
  }).join('');

  const total = sec.students.length;
  const shown = filtered.length;
  document.getElementById('table-footer').textContent =
    shown === total ? `Showing all ${total} students` : `Showing ${shown} of ${total} students`;

  lucide.createIcons();
}

/* ══════ OPEN ENTRY MODAL ══════ */
function openEntry(studentId) {
  const sec = SECTIONS[currentSection];
  const s = sec.students.find(x => x.studentId === studentId);
  if (!s) return;

  activeStudentIndex = activeStudentIds.indexOf(studentId);
  populateModal(s);
  openModal('journalModal');
}

function populateModal(s) {
  const sec = SECTIONS[currentSection];
  const student = STUDENT_BY_ID[s.studentId];
  if (!student) return;

  window.EDUGNAY_AVATAR.render(document.getElementById('modal-avatar'), student, { size: 'lg' });
  document.getElementById('modal-student-name').textContent = student.displayName;
  document.getElementById('modal-meta').textContent = `${sec.label} · ${s.week || 'Journal'} · ${s.dateRange || ''}`;
  document.getElementById('modal-prompt').textContent = s.promptText || sec.prompt?.promptText || 'Journal prompt unavailable';

  const entryEl = document.getElementById('modal-entry-body');
  if (s.submitted && s.entryText) {
    entryEl.textContent = s.entryText;
    entryEl.classList.remove('no-entry');
  } else {
    entryEl.textContent = 'No journal entry submitted for this week.';
    entryEl.classList.add('no-entry');
  }

  const maxScore = Number(s.maxScore) || 50;
  const scoreInput = document.getElementById('modal-score-input');
  scoreInput.max = maxScore;
  scoreInput.value = s.score !== null ? s.score : '';
  scoreInput.disabled = !s.submitted;
  document.getElementById('markReviewedBtn').disabled = !s.submitted;
  document.querySelector('.score-max-label').textContent = maxScore;


  const statusNote = document.getElementById('modal-status-note');
  if (s.reviewed) {
    statusNote.innerHTML = `<i data-lucide="check-circle" style="width:12px;height:12px;color:#16a34a;"></i> <span style="color:#16a34a;font-weight:600;">Reviewed</span>`;
  } else if (!s.submitted) {
    statusNote.innerHTML = `<i data-lucide="circle-x" style="width:12px;height:12px;"></i> No submission`;
  } else {
    statusNote.innerHTML = `<i data-lucide="clock" style="width:12px;height:12px;"></i> Not yet reviewed`;
  }

  const allIds = activeStudentIds;
  const idx = activeStudentIndex;
  document.getElementById('modal-nav-label').textContent = `${idx + 1} / ${allIds.length}`;
  document.getElementById('prevBtn').disabled = idx === 0;
  document.getElementById('nextBtn').disabled = idx === allIds.length - 1;

  lucide.createIcons();
}

/* ══════ MODAL NAVIGATION ══════ */
function navigateEntry(dir) {
  const newIdx = activeStudentIndex + dir;
  if (newIdx < 0 || newIdx >= activeStudentIds.length) return;
  activeStudentIndex = newIdx;
  const sec = SECTIONS[currentSection];
  const s = sec.students.find(x => x.studentId === activeStudentIds[activeStudentIndex]);
  if (s) populateModal(s);
}

/* ══════ MARK REVIEWED ══════ */
async function markReviewed() {
  const sec = SECTIONS[currentSection];
  const studentId = activeStudentIds[activeStudentIndex];
  const s = sec.students.find(x => x.studentId === studentId);
  if (!s) return;

  const scoreInput = document.getElementById('modal-score-input');
  const scoreVal = parseFloat(scoreInput.value);

  if (s.submitted && (isNaN(scoreVal) || scoreInput.value === '')) {
    scoreInput.style.borderColor = 'var(--red)';
    scoreInput.focus();
    showAppToast('Please enter a score before marking as reviewed.', 'error');
    return;
  }

  scoreInput.style.borderColor = '';

  const maxScore = Number(s.maxScore) || 50;
  if (scoreVal > maxScore) {
    scoreInput.style.borderColor = 'var(--red)';
    scoreInput.focus();
    showAppToast(`Score cannot exceed ${maxScore}.`, 'error');
    return;
  }
  scoreInput.style.borderColor = '';
  const button = document.getElementById('markReviewedBtn');
  button.disabled = true;
  document.getElementById('prevBtn').disabled = true;
  document.getElementById('nextBtn').disabled = true;
  let reviewSaved = false;
  try {
    await window.EDUGNAY_API.reviewJournalEntry(s.entryId, scoreVal);
    reviewSaved = true;
    await loadTeacherJournals();
    const refreshed = SECTIONS[currentSection]?.students.find(student => student.studentId === s.studentId);
    if (refreshed) populateModal(refreshed);
    showAppToast(`${STUDENT_BY_ID[s.studentId]?.displayName || 'Student'} · review saved`, 'success');
  } catch (error) {
    showAppToast(reviewSaved ? 'Review saved, but the page could not refresh. Please reload.' : error.message || 'Unable to save this journal review.', 'error');
  } finally {
    button.disabled = !s.submitted;
    document.getElementById('prevBtn').disabled = activeStudentIndex === 0;
    document.getElementById('nextBtn').disabled = activeStudentIndex === activeStudentIds.length - 1;
  }
}

/* ══════ MODAL HELPERS ══════ */
let journalHistoryReturnFocus = null;
let journalDeleteReturnFocus = null;
function openModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}
function closeModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (id === 'journalHistoryModal') {
    journalEntryViewer.reset();
    journalHistoryReturnFocus?.focus();
  }
  if (id === 'journalDeleteModal') journalDeleteReturnFocus?.focus();
}

document.querySelectorAll('.modal-backdrop').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    toggleDrawer(false);
    if (document.getElementById('journalDeleteModal').classList.contains('open')) closeModal('journalDeleteModal');
    else if (document.getElementById('journalHistoryModal').classList.contains('open')) closeModal('journalHistoryModal');
    else closeModal('journalModal');
    closeSettingsDrawer();
  }
  if (e.key === 'ArrowRight' && document.getElementById('journalModal').classList.contains('open')) navigateEntry(1);
  if (e.key === 'ArrowLeft'  && document.getElementById('journalModal').classList.contains('open')) navigateEntry(-1);
});

const journalEntryViewer = window.EDUGNAY_JOURNAL_HISTORY.createEntryViewer(document.getElementById('journalHistoryList'), formatJournalDate);

function renderJournalHistory() {
  const escape = window.EDUGNAY_CONFIG.escapeHtml;
  const list = document.getElementById('journalHistoryList');
  const promptCards = journalHistoryPrompts.map(prompt => {
    const entries = journalHistoryEntries.filter(entry => entry.promptId === prompt.id);
    const canDelete = prompt.gradingItemId && !prompt.usedInPublishedGrades && !prompt.entryCount && !prompt.recordedScoreCount
      && String(prompt.componentTeacherUserId) === journalTeacherId;
    const previous = prompt.effectiveStatus === 'inactive';
    const status = previous ? 'Previous subject' : prompt.status === 'open' ? 'Open' : 'Closed';
    return `<article class="journal-history-card">
      <div class="journal-history-card-head"><div class="journal-history-card-heading"><strong class="journal-history-card-title">${escape(prompt.subjectName)} · ${escape(prompt.sectionName)}</strong><span class="journal-history-card-date">Week of ${escape(formatJournalDate(prompt.weekStartDate))}</span></div><span class="journal-history-status ${previous ? 'is-previous' : prompt.status === 'open' ? 'is-open' : ''}">${status}</span></div>
      <p class="journal-history-card-content">${escape(prompt.promptText)}</p>
      <div class="journal-history-card-meta"><div>Score component: <strong>${escape(prompt.componentTitle || 'Not linked')}</strong></div><div class="journal-history-facts"><span>${prompt.entryCount} ${prompt.entryCount === 1 ? 'entry' : 'entries'}</span><span>${prompt.recordedScoreCount} recorded ${prompt.recordedScoreCount === 1 ? 'score' : 'scores'}</span>${prompt.usedInPublishedGrades ? '<span class="journal-history-protected">Used in published grades</span>' : ''}</div></div>
      ${entries.length ? `<div class="journal-history-entry-action"><button type="button" data-view-journal-entries="prompt:${escape(prompt.id)}"><i data-lucide="users" aria-hidden="true"></i>View submitted entries (${entries.length})<i data-lucide="arrow-right" aria-hidden="true"></i></button></div>` : ''}
      ${canDelete ? `<div class="journal-history-actions"><button class="journal-history-delete" type="button" data-delete-journal="${escape(prompt.id)}"><i data-lucide="trash-2" aria-hidden="true"></i>Delete prompt & component</button></div>` : ''}
    </article>`;
  }).join('');
  const legacyCards = window.EDUGNAY_JOURNAL_HISTORY.groupLegacyEntries(journalHistoryEntries).map(group => {
    const entryCount = group.entries.length;
    const weekLabel = group.weekStartDate ? `Submission week of ${formatJournalDate(group.weekStartDate)}` : 'Submission date unavailable';
    return `<article class="journal-history-card">
      <div class="journal-history-card-head"><div class="journal-history-card-heading"><strong class="journal-history-card-title">${escape(group.journalSubjectName)} · ${escape(group.sectionName)}</strong><span class="journal-history-card-date">${escape(weekLabel)}</span></div><span class="journal-history-status is-previous">Past entries</span></div>
      <p class="journal-history-card-content">${escape(group.promptText || 'Original prompt text unavailable.')}</p>
      <div class="journal-history-card-meta"><div class="journal-history-facts"><span>${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}</span></div></div>
      <div class="journal-history-entry-action"><button type="button" data-view-journal-entries="${escape(group.key)}"><i data-lucide="users" aria-hidden="true"></i>View submitted entries (${entryCount})<i data-lucide="arrow-right" aria-hidden="true"></i></button></div>
    </article>`;
  }).join('');
  list.innerHTML = promptCards + legacyCards || window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'history', title: 'No journal history', text: 'Past prompts and entries will appear here.' });
  lucide.createIcons();
}

async function openJournalHistory() {
  const list = document.getElementById('journalHistoryList');
  if (!document.getElementById('journalHistoryModal').classList.contains('open')) journalHistoryReturnFocus = document.activeElement;
  list.innerHTML = '';
  openModal('journalHistoryModal');
  document.querySelector('#journalHistoryModal .modal-close').focus();
  try {
    const [user, history] = await Promise.all([
      window.EDUGNAY_API.getCurrentUser(),
      window.EDUGNAY_API.getJournalHistory()
    ]);
    journalTeacherId = String(user.id);
    journalHistoryPrompts = history.prompts;
    journalHistoryEntries = history.entries;
    renderJournalHistory();
  } catch (error) {
    list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'triangle-alert', title: 'Journal history unavailable', text: error.message || 'Please try again.' });
    lucide.createIcons();
  }
}

document.getElementById('journalHistoryList').addEventListener('click', event => {
  const entriesButton = event.target.closest('[data-view-journal-entries]');
  if (entriesButton) {
    const key = entriesButton.dataset.viewJournalEntries;
    const prompt = key.startsWith('prompt:') ? journalHistoryPrompts.find(item => item.id === key.slice(7)) : null;
    const legacyGroup = key.startsWith('legacy:')
      ? window.EDUGNAY_JOURNAL_HISTORY.groupLegacyEntries(journalHistoryEntries).find(group => group.key === key)
      : null;
    const entries = prompt ? journalHistoryEntries.filter(entry => entry.promptId === prompt.id) : legacyGroup?.entries || [];
    const first = entries[0];
    if (!first) return;
    journalEntryViewer.open({ groupKey: key, title: `Submitted entries · ${first.journalSubjectName} · ${first.sectionName}`, context: prompt ? `Week of ${formatJournalDate(prompt.weekStartDate)}` : legacyGroup?.weekStartDate ? `Submission week of ${formatJournalDate(legacyGroup.weekStartDate)}` : 'Submission date unavailable', entries });
    return;
  }
  const button = event.target.closest('[data-delete-journal]');
  if (!button) return;
  const prompt = journalHistoryPrompts.find(item => item.id === button.dataset.deleteJournal);
  if (!prompt) return;
  journalDeleteReturnFocus = button;
  pendingJournalDeleteId = prompt.id;
  document.getElementById('journalDeleteMessage').textContent = `Delete the prompt for ${prompt.subjectName} · ${prompt.sectionName} and its linked score component “${prompt.componentTitle}”?`;
  openModal('journalDeleteModal');
  document.querySelector('#journalDeleteModal .modal-close').focus();
});

document.getElementById('journalDeleteConfirm').addEventListener('click', async event => {
  if (!pendingJournalDeleteId) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await window.EDUGNAY_API.deleteJournalPrompt(pendingJournalDeleteId);
    pendingJournalDeleteId = '';
    closeModal('journalDeleteModal');
    await openJournalHistory();
    await loadTeacherJournals();
    showAppToast('Journal prompt and score component deleted.');
  } catch (error) { showAppToast(error.message || 'The journal prompt could not be deleted.', 'error'); }
  finally { button.disabled = false; }
});

async function loadTeacherJournals() {
  const tabs = document.getElementById('journal-section-tabs');
  const noPrompt = document.getElementById('noPromptState');
  const previousSection = currentSection;
  const previousPromptId = currentPromptId;
  tabs.innerHTML = '';
  try {
    const [user, subjects, sections, prompts] = await Promise.all([
      window.EDUGNAY_API.getCurrentUser(),
      window.EDUGNAY_API.getJournalSubjects(),
      window.EDUGNAY_API.getJournalSections(),
      window.EDUGNAY_API.getJournalPrompts()
    ]);
    if (user?.role !== 'teacher') throw new Error('Only teacher accounts can review journal entries.');
    journalTeacherId = String(user.id);
    if (!subjects.length) throw new Error('Journals are not configured for this school.');

    STUDENT_BY_ID = {};
    const sectionRecords = await Promise.all(sections.map(async section => {
      const [rosterResult, entries, gradingItems] = await Promise.all([
        window.EDUGNAY_API.getSectionStudents(section.id),
        window.EDUGNAY_API.getJournalEntries({ sectionId: section.id }),
        window.EDUGNAY_API.getGradingItems({ sectionId: section.id })
      ]);
      const roster = rosterResult.students || [];
      roster.forEach(student => { STUDENT_BY_ID[student.id] = student; });
      return [section.id, {
        ...section,
        subjectId: subjects[0].subjectId,
        prompts: prompts.filter(prompt => prompt.sectionId === section.id),
        entries,
        roster,
        gradingItems,
        students: []
      }];
    }));

    SECTIONS = Object.fromEntries(sectionRecords);
    Object.values(SECTIONS).forEach(section => selectSectionPrompt(section, section.prompts[0]?.id || ''));
    currentSection = SECTIONS[previousSection] ? previousSection : sectionRecords[0]?.[0] || '';
    const activeSection = SECTIONS[currentSection];
    if (activeSection) {
      currentPromptId = activeSection.prompts.some(prompt => prompt.id === previousPromptId)
        ? previousPromptId
        : activeSection.prompts[0]?.id || '';
      selectSectionPrompt(activeSection, currentPromptId);
      document.getElementById('panel-title').textContent = `Journal Entries: ${activeSection.label}`;
      renderPromptOptions(activeSection);
    }
    renderJournalSectionTabs();
    renderJournalSummary();
    renderTable();
    lucide.createIcons();
  } catch (error) {
    SECTIONS = {};
    tabs.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'triangle-alert', title: 'Journal sections unavailable', text: error.message || 'Please refresh and try again.' });
    noPrompt.innerHTML = '';
    noPrompt.style.display = 'none';
    document.querySelector('.toolbar').style.display = 'none';
    document.querySelector('.table-wrap').style.display = 'none';
    document.getElementById('table-footer').style.display = 'none';
    renderJournalSummary();
    lucide.createIcons();
  }
}

/* ══════ INIT ══════ */
document.addEventListener('DOMContentLoaded', async () => {
  await loadTeacherJournals();
  window.EDUGNAY_PAGE_LOADING.ready();
});

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    p3719d64e09ec: function(event) { renderTable() },
    pa6724fc4f0dc: function(event) { selectJournalPrompt(this.value) },
  },
  click: {
    p4ad72c84fe5e: function(event) { closeModal('journalHistoryModal') },
    p535d5ec44b32: function(event) { openJournalHistory() },
    p55d5b5994090: function(event) { this.classList.toggle('on') },
    p62b91de57feb: function(event) { if(event.target===this) closeSettingsDrawer() },
    p7bdd2ba2646d: function(event) { closeSettingsDrawer() },
    p89b3cc6496e2: function(event) { openSettingsDrawer() },
    pb07ad5eb0f92: function(event) { markReviewed() },
    pca0e8365ee9a: function(event) { saveJournalSettings() },
    pd197fddcb669: function(event) { closeModal('journalDeleteModal') },
    pd8045c9dbc14: function(event) { closeModal('journalModal') },
    pf80ff387525d: function(event) { navigateEntry(-1) },
    pfb3eab28ac02: function(event) { navigateEntry(1) },
  },
  input: {
    pdc2c4328193e: function(event) { updatePromptCounter() },
    peb9eb74321cd: function(event) { renderTable() },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    g89b3cc6496e2: function(event) { openSettingsDrawer() },
  },
});
