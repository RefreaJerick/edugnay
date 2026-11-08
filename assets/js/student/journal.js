lucide.createIcons();
    const escapeJournalHtml = window.EDUGNAY_CONFIG.escapeHtml;
    let currentPrompt = null;
    let currentEntry = null;
    let pastEntries = [];
    let journalWindowOpen = false;
    let minimumWords = 50;
    let pendingDraft = null;
    let journalRefreshPending = false;

    function formatJournalDate(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? 'Date unavailable'
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatJournalDateTime(value) {
      return window.EDUGNAY_CONFIG.formatDateTime(value);
    }

    function formatJournalDateRange(startValue, endValue) {
      const start = new Date(`${String(startValue).slice(0, 10)}T00:00:00`);
      const end = new Date(endValue);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Dates unavailable';
      const startOptions = { month: 'short', day: 'numeric' };
      const endOptions = { month: 'short', day: 'numeric', year: 'numeric' };
      if (start.getFullYear() !== end.getFullYear()) startOptions.year = 'numeric';
      return `${start.toLocaleDateString('en-US', startOptions)} – ${end.toLocaleDateString('en-US', endOptions)}`;
    }

    function promptWeekLabel(prompt) {
      return `Week of ${formatJournalDate(`${prompt.weekStartDate}T00:00:00`)}`;
    }

    function renderJournalPrompt(prompt, showDeadline = true) {
      if (!prompt) return '';
      const subjectName = prompt.subjectName || 'Journal';
      const dateRange = formatJournalDateRange(prompt.weekStartDate, prompt.dueAt);
      const deadlineLabel = prompt.submissionState === 'late'
        ? 'Late submissions allowed · Original deadline'
        : prompt.submissionState === 'open' ? 'Submit before' : 'Deadline';
      return `
      <section class="journal-prompt" aria-label="Weekly journal prompt">
        <div class="journal-prompt-heading">
          <div class="journal-prompt-icon" aria-hidden="true"><i data-lucide="notebook-pen" style="width:17px;height:17px;"></i></div>
          <div class="journal-prompt-copy">
            <div class="journal-prompt-eyebrow">${escapeJournalHtml(subjectName)} · Weekly Journal</div>
            <div class="journal-prompt-period">${escapeJournalHtml(dateRange)}</div>
          </div>
        </div>
        <p class="journal-prompt-text">${escapeJournalHtml(prompt.promptText)}</p>
        ${showDeadline ? `<div class="journal-prompt-deadline">
          <i data-lucide="clock" style="width:13px;height:13px;"></i>
          <span>${deadlineLabel} <strong>${escapeJournalHtml(formatJournalDateTime(prompt.dueAt))}</strong></span>
        </div>` : ''}
      </section>`;
    }

    function wordCount(text) {
      return text.trim().split(/\s+/).filter(Boolean).length;
    }

    function renderUnsentDraft() {
      return pendingDraft?.text
        ? `<div class="journal-unsent-draft"><label for="journal-unsent-text">Your unsent draft</label><textarea id="journal-unsent-text" readonly>${escapeJournalHtml(pendingDraft.text)}</textarea><small>Copy your text before leaving this page.</small></div>`
        : '';
    }

    function renderCurrentWeekPanel() {
      const panel = document.getElementById('current-week-panel');
      const journalPromptMarkup = renderJournalPrompt(currentPrompt, !currentEntry);

      if (currentEntry) {
        // Submitted entries are read-only.
        const scoreBlock = currentEntry.score !== null
          ? `<span class="score-given-chip" aria-label="Score ${currentEntry.score} out of ${currentEntry.maxScore || currentPrompt?.maxScore || 'unknown'}"><span>Score</span><strong>${currentEntry.score}</strong><span class="score-max">/ ${currentEntry.maxScore || currentPrompt?.maxScore || '—'}</span></span>`
          : `<span class="score-pending-chip" role="status"><i data-lucide="hourglass" aria-hidden="true" style="width:12px;height:12px;"></i> Awaiting review</span>`;

        panel.innerHTML = `${journalPromptMarkup}
          <section class="journal-submission" aria-labelledby="current-entry-title">
            <div class="journal-submission-head">
              <h2 class="panel-title" id="current-entry-title">Your entry</h2>
              <p class="panel-sub">Submitted ${escapeJournalHtml(formatJournalDateTime(currentEntry.submittedAt))}</p>
            </div>
            <p class="journal-submission-note"><i data-lucide="lock-keyhole" aria-hidden="true" style="width:13px;height:13px;"></i> This entry is read-only after submission.</p>
            <div class="submitted-entry" aria-label="Your submitted journal entry">${escapeJournalHtml(currentEntry.entryText)}</div>
            <div class="submitted-meta">${scoreBlock}</div>
          </section>`;
        lucide.createIcons();
        return;
      }

      if (!currentPrompt) {
        panel.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'notebook-pen', title: 'No journal prompt yet', text: 'A journal prompt will appear here when your teacher publishes one.' });
        lucide.createIcons();
        return;
      }

      if (!journalWindowOpen) {
        panel.innerHTML = `${journalPromptMarkup}
      <div class="closed-state">
        <div class="closed-icon"><i data-lucide="lock" style="width:22px;height:22px;"></i></div>
        <div class="closed-title">Submission window closed</div>
      <div class="closed-sub">This week's journal entry is no longer accepting submissions.</div>
      ${pendingDraft?.promptId === currentPrompt.id ? renderUnsentDraft() : ''}
      </div>`;
        lucide.createIcons();
        return;
      }

      // Open composer
      panel.innerHTML = `${journalPromptMarkup}
    <div class="panel-head">
      <div>
        <div class="panel-title">Write Your Entry</div>
      <div class="panel-sub">${minimumWords} words minimum</div>
      </div>
    </div>
    <div class="composer-body">
      <textarea class="composer-textarea" id="entry-textarea" placeholder="Start writing your reflection here..." data-page-input="gbab952f6df20"></textarea>
      <div class="composer-foot">
        <span class="word-count" id="word-count-label">0 words</span>
        <button class="btn-submit" id="submit-btn" disabled data-page-click="ge730745b002d">
          <i data-lucide="send" style="width:14px;height:14px;"></i> Submit Entry
        </button>
      </div>
      <div class="composer-hint">
        <i data-lucide="info" style="width:13px;height:13px;flex-shrink:0;margin-top:1px;"></i>
        <span>Once submitted, you cannot edit this entry. Take your time and write honestly. There is no wrong answer.</span>
      </div>
    </div>`;
      lucide.createIcons();
    }

    function updateWordCount() {
      const textarea = document.getElementById('entry-textarea');
      const label = document.getElementById('word-count-label');
      const submitBtn = document.getElementById('submit-btn');
      if (!textarea || !label || !submitBtn) return;
      const count = wordCount(textarea.value);

      label.textContent = `${count} words`;
      label.className = 'word-count';
      if (count > 0 && count < minimumWords) {
        label.classList.add('under');
        label.textContent = `${count} words · need ${minimumWords - count} more`;
      } else if (count >= minimumWords) {
        label.classList.add('ok');
      }

      submitBtn.disabled = count < minimumWords;
    }

    async function submitEntry() {
      const textarea = document.getElementById('entry-textarea');
      const submitBtn = document.getElementById('submit-btn');
      if (!currentPrompt || !textarea || !submitBtn || wordCount(textarea.value) < minimumWords) return;
      submitBtn.disabled = true;
      try {
        await window.EDUGNAY_API.submitJournalEntry({ promptId: currentPrompt.id, entryText: textarea.value.trim() });
        showAppToast('Journal entry submitted!', 'success');
        await loadStudentJournals();
      } catch (error) {
        showAppToast(error.message || 'Unable to submit this journal entry.', 'error');
        submitBtn.disabled = false;
      }
    }

    function renderHistory() {
      const list = document.getElementById('history-list');

      if (pastEntries.length === 0) {
        list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'notebook-pen', title: 'No past entries yet', text: 'Submitted journal entries will appear here.' });
        lucide.createIcons();
        return;
      }

      list.innerHTML = pastEntries.map(e => {
        const scoreBadge = e.score !== null
          ? `<span class="history-reviewed-score"><span>Reviewed</span><strong>${e.score}/${e.maxScore || '—'}</strong></span>`
          : `<span class="badge badge-gray"><i data-lucide="hourglass" aria-hidden="true" style="width:10px;height:10px;"></i> Awaiting review</span>`;
        return `
      <button class="history-row" type="button" aria-label="View journal entry: ${escapeJournalHtml(e.week)}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openEntryModal(String(e.id)) })}">
        <span class="history-icon" aria-hidden="true"><i data-lucide="notebook-pen" style="width:17px;height:17px;"></i></span>
        <span class="history-info">
          <span class="history-week">${escapeJournalHtml(e.week)}</span>
          <span class="history-excerpt">${escapeJournalHtml(e.excerpt)}</span>
        </span>
        <span class="history-score">${scoreBadge}</span>
      </button>`;
      }).join('');
      lucide.createIcons();
    }

    function openEntryModal(id) {
      const e = pastEntries.find(entry => entry.id === String(id));
      if (!e) return;
      document.getElementById('entryModalWeek').textContent = e.week;
      document.getElementById('entryModalDate').textContent = e.dateRange;
      document.getElementById('entryModalPrompt').textContent = e.prompt;
      document.getElementById('entryModalText').textContent = e.entryText;
      document.getElementById('entryModalSubmitted').textContent = formatJournalDateTime(e.submittedAt);

      const scoreEl = document.getElementById('entryModalScore');
      scoreEl.innerHTML = e.score !== null
        ? `<span class="score-given-chip"><span>Score</span><strong>${e.score}</strong><span class="score-max">/ ${e.maxScore || '—'}</span></span>`
        : `<span class="score-pending-chip"><i data-lucide="hourglass" style="width:12px;height:12px;"></i> Awaiting score</span>`;

      document.getElementById('entryModalBackdrop').classList.add('open');
      lucide.createIcons();
    }

    function closeEntryModal() {
      document.getElementById('entryModalBackdrop').classList.remove('open');
    }

    async function loadStudentJournals() {
      const panel = document.getElementById('current-week-panel');
      const list = document.getElementById('history-list');
      const draftInput = document.getElementById('entry-textarea');
      if (draftInput?.value.trim()) pendingDraft = { promptId: currentPrompt?.id, text: draftInput.value };
      panel.innerHTML = '';
      list.innerHTML = '';
      try {
        const [user, portal] = await Promise.all([
          window.EDUGNAY_API.getCurrentUser(),
          window.EDUGNAY_API.getPortalFeatures()
        ]);
        if (user?.role !== 'student') throw new Error('Only student accounts can view journal entries.');
        if (!portal.features.journalsEnabled || !portal.journalSubjectEligible) {
          currentPrompt = null;
          currentEntry = null;
          pastEntries = [];
          panel.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'notebook-pen', title: 'Journals are unavailable', text: 'Journals are available only to eligible Junior High School students taking the journal subject.' });
          return;
        }
        const showUnavailable = message => {
          currentPrompt = null;
          currentEntry = null;
          pastEntries = [];
          panel.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'notebook-pen', title: 'Journals are unavailable', text: message });
        };
        let subjects;
        try {
          subjects = await window.EDUGNAY_API.getJournalSubjects();
        } catch (error) {
          showUnavailable(error.message || 'Current Journals are unavailable.');
          return;
        }
        if (!subjects.length) {
          showUnavailable('Weekly journals are not available right now. Ask your teacher for details.');
          return;
        }

        let prompts, entries, history;
        try {
          [prompts, entries, history] = await Promise.all([
            window.EDUGNAY_API.getJournalPrompts(),
            window.EDUGNAY_API.getJournalEntries(),
            window.EDUGNAY_API.getJournalHistory()
          ]);
        } catch (error) {
          showUnavailable(error.message || 'Current Journals are unavailable.');
          return;
        }

        currentPrompt = prompts[0] || null;
        currentEntry = currentPrompt
          ? entries.find(entry => entry.promptId === currentPrompt.id) || null
          : null;
        minimumWords = Number(currentPrompt?.minWords) || 50;
        journalWindowOpen = currentPrompt?.submissionState === 'open' || currentPrompt?.submissionState === 'late';

        const historicalEntries = history.entries.filter(entry => entry.id !== currentEntry?.id);
        pastEntries = historicalEntries.map(entry => {
          const prompt = history.prompts.find(item => item.id === entry.promptId);
          const weekDate = prompt?.weekStartDate || entry.submittedAt;
          const week = `${entry.journalSubjectName} · ${prompt
            ? formatJournalDateRange(prompt.weekStartDate, prompt.dueAt)
            : `Week of ${formatJournalDate(weekDate)}`}`;
          return {
            ...entry,
            week,
            dateRange: formatJournalDate(entry.submittedAt),
            prompt: prompt?.promptText || entry.promptText || 'Journal prompt unavailable',
            excerpt: entry.entryText.length > 96 ? `${entry.entryText.slice(0, 96)}…` : entry.entryText
          };
        });
        renderCurrentWeekPanel();
        if (journalWindowOpen && pendingDraft?.promptId === currentPrompt.id) {
          const textarea = document.getElementById('entry-textarea');
          if (textarea) {
            textarea.value = pendingDraft.text;
            updateWordCount();
          }
        }
        if (currentEntry) pendingDraft = null;
        renderHistory();
      } catch (error) {
        panel.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'triangle-alert', title: 'Unable to load journal', text: error.message || 'Please refresh and try again.' });
        panel.insertAdjacentHTML('beforeend', renderUnsentDraft());
        list.innerHTML = '';
        lucide.createIcons();
      }
    }

    document.addEventListener('DOMContentLoaded', async () => {
      await loadStudentJournals();
      window.EDUGNAY_PAGE_LOADING.ready();
    });

    let journalRetryPending = false;
    async function refreshJournalWindow() {
      if (document.hidden || journalRefreshPending || journalRetryPending) return;
      journalRefreshPending = true;
      try {
        const prompts = await window.EDUGNAY_API.getJournalPrompts();
        const latest = prompts[0] || null;
        if (latest?.id !== currentPrompt?.id || latest?.submissionState !== currentPrompt?.submissionState) {
          await loadStudentJournals();
        }
      } catch (error) {
        if (error.status === 429) {
          journalRetryPending = true;
          setTimeout(() => { journalRetryPending = false; }, (error.retryAfterSeconds || 60) * 1000);
        } else if (currentPrompt) await loadStudentJournals();
      } finally { journalRefreshPending = false; }
    }

    document.addEventListener('visibilitychange', refreshJournalWindow);
    setInterval(refreshJournalWindow, 60000);

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    pec5fd30166e3: function(event) { closeEntryModal() },
    pfc27c180b59b: function(event) { if(event.target===this) closeEntryModal() },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    ge730745b002d: function(event) { submitEntry() },
  },
  input: {
    gbab952f6df20: function(event) { updateWordCount() },
  },
});
