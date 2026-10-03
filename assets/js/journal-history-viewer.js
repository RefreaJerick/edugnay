(function () {
  function getSubmissionWeekStart(value) {
    if (!value) return '';
    let input = String(value).trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(input)) input += 'Z';
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return '';
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return monday.toISOString().slice(0, 10);
  }

  function groupLegacyEntries(entries) {
    const groups = new Map();
    entries.filter(entry => !entry.promptId).forEach(entry => {
      const weekStartDate = getSubmissionWeekStart(entry.submittedAt);
      const promptText = String(entry.promptText || '').trim();
      const subjectId = String(entry.journalSubjectId || '');
      const sectionId = String(entry.sectionId || '');
      const groupingKey = JSON.stringify([subjectId, sectionId, weekStartDate || `entry:${entry.id}`, promptText]);
      if (!groups.has(groupingKey)) {
        groups.set(groupingKey, {
          key: `legacy:${encodeURIComponent(groupingKey)}`,
          journalSubjectId: subjectId,
          journalSubjectName: entry.journalSubjectName || '',
          sectionId,
          sectionName: entry.sectionName || '',
          weekStartDate,
          promptText,
          entries: []
        });
      }
      groups.get(groupingKey).entries.push(entry);
    });
    return [...groups.values()];
  }

  function createEntryViewer(list, formatDate) {
    const escape = window.EDUGNAY_CONFIG.escapeHtml;
    let view = null;

    function render() {
      if (!view) return;
      const matches = view.entries.filter(entry => String(entry.studentName || '').toLowerCase().includes(view.search.toLowerCase()));
      const pageCount = Math.max(1, Math.ceil(matches.length / 10));
      view.page = Math.min(view.page, pageCount - 1);
      const pageEntries = matches.slice(view.page * 10, view.page * 10 + 10);
      if (!pageEntries.some(entry => entry.id === view.selectedId)) view.selectedId = pageEntries[0]?.id || null;
      const selected = pageEntries.find(entry => entry.id === view.selectedId);
      list.innerHTML = `<div class="journal-entry-viewer ${view.showDetail ? 'is-detail' : ''}">
        <button class="journal-entry-back" type="button" data-entry-back><i data-lucide="arrow-left" aria-hidden="true"></i>Back to journal history</button>
        <div class="journal-entry-viewer-head"><strong>${escape(view.title)}</strong><span>${escape(view.context)}</span></div>
        <div class="journal-entry-viewer-grid">
          <section class="journal-entry-viewer-list" aria-label="Students with journal entries">
            <label class="journal-entry-search-label" for="journalEntrySearch">Search student</label>
            <input class="journal-entry-search" id="journalEntrySearch" type="search" data-entry-search placeholder="Search by student name" value="${escape(view.search)}">
            <div class="journal-entry-students">${pageEntries.length ? pageEntries.map(entry => `<button class="journal-entry-student ${entry.id === view.selectedId ? 'is-selected' : ''}" type="button" data-entry-student="${escape(entry.id)}" aria-pressed="${entry.id === view.selectedId}"><strong>${escape(entry.studentName)}</strong><span>${escape(formatDate(entry.submittedAt))} · ${entry.status === 'reviewed' ? 'Reviewed' : 'Submitted'}</span></button>`).join('') : '<p class="journal-entry-no-results">No students match your search.</p>'}</div>
            <div class="journal-entry-pagination"><span>${matches.length ? `${view.page * 10 + 1}–${Math.min((view.page + 1) * 10, matches.length)} of ${matches.length}` : '0 entries'}</span><div><button type="button" data-entry-prev ${view.page === 0 ? 'disabled' : ''}>Previous</button><button type="button" data-entry-next ${view.page >= pageCount - 1 ? 'disabled' : ''}>Next</button></div></div>
          </section>
          <section class="journal-entry-viewer-detail" data-entry-detail tabindex="-1" aria-label="Selected journal entry">
            <button class="journal-entry-mobile-back" type="button" data-entry-list-back><i data-lucide="arrow-left" aria-hidden="true"></i>Back to students</button>
            ${selected ? `<div class="journal-entry-detail-head"><strong>${escape(selected.studentName)}</strong><span>Submitted ${escape(formatDate(selected.submittedAt))}</span></div>${selected.promptText ? `<p class="journal-entry-detail-prompt">${escape(selected.promptText)}</p>` : ''}<p class="journal-entry-detail-text">${escape(selected.entryText)}</p>${selected.score !== null && selected.score !== undefined ? `<p class="journal-entry-detail-note">Score: ${escape(selected.score)}${selected.maxScore ? ` / ${escape(selected.maxScore)}` : ''}</p>` : ''}` : '<p class="journal-entry-no-results">Choose a student to read their entry.</p>'}
          </section>
        </div>
      </div>`;
      window.lucide?.createIcons();
    }

    list.addEventListener('click', event => {
      if (!view) return;
      if (event.target.closest('[data-entry-back]')) {
        list.innerHTML = view.historyHtml;
        list.scrollTop = view.historyScroll;
        const source = [...list.querySelectorAll('[data-view-journal-entries]')].find(button => button.dataset.viewJournalEntries === view.groupKey);
        view = null;
        source?.focus();
      } else if (event.target.closest('[data-entry-list-back]')) {
        view.showDetail = false;
        render();
        list.scrollTop = 0;
        list.querySelector('[data-entry-search]')?.focus();
      } else if (event.target.closest('[data-entry-student]')) {
        view.selectedId = event.target.closest('[data-entry-student]').dataset.entryStudent;
        view.showDetail = true;
        render();
        list.scrollTop = 0;
        if (window.matchMedia('(max-width: 600px)').matches) list.querySelector('[data-entry-list-back]')?.focus();
        else list.querySelector('[data-entry-detail]')?.focus();
      } else if (event.target.closest('[data-entry-prev], [data-entry-next]')) {
        view.page += event.target.closest('[data-entry-next]') ? 1 : -1;
        view.showDetail = false;
        render();
        list.querySelector('[data-entry-student]')?.focus();
      }
    });

    list.addEventListener('input', event => {
      if (!view || !event.target.matches('[data-entry-search]')) return;
      const position = event.target.selectionStart;
      view.search = event.target.value;
      view.page = 0;
      view.showDetail = false;
      render();
      const search = list.querySelector('[data-entry-search]');
      search.focus();
      search.setSelectionRange(position, position);
    });

    return {
      reset() { view = null; },
      open({ groupKey, title, context, entries }) {
        view = { groupKey, title, context, entries: [...entries].sort((a, b) => String(a.studentName).localeCompare(String(b.studentName))), search: '', page: 0, selectedId: null, showDetail: false, historyHtml: list.innerHTML, historyScroll: list.scrollTop };
        render();
        list.scrollTop = 0;
        list.querySelector('[data-entry-search]')?.focus();
      }
    };
  }

  window.EDUGNAY_JOURNAL_HISTORY = { createEntryViewer, groupLegacyEntries };
})();
