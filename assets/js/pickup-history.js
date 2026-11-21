(function () {
  const escape = value => window.EDUGNAY_CONFIG.escapeHtml(String(value ?? ''));

  function schoolDateLabel(value) {
    const [year, month, day] = String(value || '').split('-').map(Number);
    if (!year || !month || !day) return 'Date unavailable';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }

  function render(records, timeZone) {
    const groups = new Map();
    for (const record of records) {
      const date = record.schoolDate || String(record.pickedUpAt || '').slice(0, 10);
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(record);
    }

    const formatTime = new Intl.DateTimeFormat('en-PH', { timeZone, timeStyle: 'short' });
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([date, entries]) => {
      const rows = entries.slice().sort((left, right) => String(right.pickedUpAt).localeCompare(String(left.pickedUpAt)))
        .map(record => {
          const time = formatTime.format(new Date(record.pickedUpAt));
          const avatar = window.EDUGNAY_AVATAR.html({
            id: record.studentId,
            displayName: record.studentName,
            initials: record.studentInitials,
            avatarUrl: record.avatarUrl
          }, { className: 'pickup-history-student-avatar', role: 'student', size: 'sm' });
          const relationship = String(record.fetcherRelationship || '').trim();
          return `<article class="pickup-history-item">
            ${avatar}
            <div class="pickup-history-record-body">
              <strong>${escape(record.studentName)}</strong>
              <div class="pickup-history-fetcher">Picked up by ${escape(record.fetcherName)}${relationship ? ` (${escape(relationship)})` : ''}</div>
              <p class="pickup-history-guard">Guard: ${escape(record.guardName)}</p>
            </div>
            <div class="pickup-history-record-meta">
              <time datetime="${escape(record.pickedUpAt)}">${escape(time)}</time>
            </div>
          </article>`;
        }).join('');
      return `<section class="pickup-history-date-group" aria-label="${escape(schoolDateLabel(date))}">
        <h3 class="pickup-history-date-heading">${escape(schoolDateLabel(date))}</h3>${rows}</section>`;
    }).join('');
  }

  function countLabel(count, hasMore) {
    if (hasMore) return `${count}+ handovers`;
    return `${count} ${count === 1 ? 'handover' : 'handovers'}`;
  }

  function today(timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  window.EDUGNAY_PICKUP_HISTORY = Object.freeze({ render, countLabel, today });
})();
