/* Calendar for grading-period date pairs. The existing date inputs remain the saved values. */
(function () {
  'use strict';

  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let popup;
  let openRange = null;
  const rangesByButton = new WeakMap();

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function displayDate(value) {
    return validDate(value)
      ? `${months[Number(value.slice(5, 7)) - 1].slice(0, 3)} ${value.slice(8, 10)}, ${value.slice(0, 4)}`
      : '';
  }

  function moveDate(value, days) {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function formatLongDate(value) {
    const date = new Date(`${value}T00:00:00Z`);
    return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
  }

  function yearBounds(range) {
    return {
      min: validDate(range.yearStart) ? Number(range.yearStart.slice(0, 4)) : 1,
      max: validDate(range.yearEnd) ? Number(range.yearEnd.slice(0, 4)) : 9999
    };
  }

  function dateForYear(value, year) {
    const month = Number(value.slice(5, 7)) - 1;
    const day = Number(value.slice(8, 10));
    const lastDay = new Date(0);
    lastDay.setUTCHours(0, 0, 0, 0);
    lastDay.setUTCFullYear(year, month + 1, 0);
    return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day, lastDay.getUTCDate())).padStart(2, '0')}`;
  }

  function utcDate(year, month, day) {
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month, day);
    return date;
  }

  function setCalendarYear(range, value) {
    const year = Number(value);
    const bounds = yearBounds(range);
    if (!Number.isInteger(year) || year < bounds.min || year > bounds.max) return false;
    let date = dateForYear(range.active, year);
    if (validDate(range.yearStart) && date < range.yearStart) date = range.yearStart;
    if (validDate(range.yearEnd) && date > range.yearEnd) date = range.yearEnd;
    range.active = date;
    range.year = Number(date.slice(0, 4));
    range.month = Number(date.slice(5, 7)) - 1;
    range.error = '';
    return true;
  }

  function inclusiveDayCount(range) {
    if (!canApply(range)) return null;
    const start = new Date(`${range.start}T00:00:00Z`).getTime();
    const end = new Date(`${range.end}T00:00:00Z`).getTime();
    return Math.floor((end - start) / 86400000) + 1;
  }

  function updateSelectionSummary(range, selection, counter) {
    const start = validDate(range.start) ? displayDate(range.start) : 'Select start date';
    const end = validDate(range.end) ? displayDate(range.end) : 'Select end date';
    selection.textContent = `${start} – ${end}`;
    const count = inclusiveDayCount(range);
    counter.textContent = count === null ? '' : `${count} ${count === 1 ? 'day' : 'days'}`;
    counter.hidden = count === null;
  }

  function ensurePopup() {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.className = 'academic-range-popup';
    popup.hidden = true;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Choose grading-period dates');
    popup.innerHTML = `
      <div class="academic-range-heading"><strong data-range-title></strong><span data-range-step></span></div>
      <div class="academic-range-navigation">
        <button type="button" data-range-nav="-12" aria-label="Previous year"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m11 17-5-5 5-5m7 10-5-5 5-5"/></svg></button>
        <button type="button" data-range-nav="-1" aria-label="Previous month"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
        <div class="academic-range-month-year"><strong data-range-month></strong><input class="academic-range-year-input" type="number" data-range-year min="1" max="9999" step="1" inputmode="numeric" aria-label="Year"></div>
        <button type="button" data-range-nav="1" aria-label="Next month"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
        <button type="button" data-range-nav="12" aria-label="Next year"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 17 5-5-5-5m2 10 5-5-5-5"/></svg></button>
      </div>
      <div class="academic-range-weekdays" aria-hidden="true">${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
      <div class="academic-range-days" role="group" aria-label="Calendar dates"></div>
      <div class="academic-range-selection"><span>Selected dates</span><strong data-range-selection></strong></div>
      <p class="academic-range-error" data-range-error role="status" hidden></p>
      <div class="academic-range-actions"><span class="academic-range-day-count" data-range-day-count aria-live="polite" hidden></span><button type="button" class="academic-range-cancel" data-range-action="cancel">Cancel</button><button type="button" class="academic-range-apply" data-range-action="apply">Apply</button></div>`;
    document.body.appendChild(popup);
    popup.addEventListener('click', onPopupClick);
    popup.addEventListener('input', onPopupInput);
    popup.addEventListener('change', onPopupChange);
    popup.addEventListener('keydown', onPopupKeydown);
    document.addEventListener('pointerdown', event => {
      if (openRange && !popup.contains(event.target) && !openRange.trigger.contains(event.target)) close(false);
    });
    document.addEventListener('academix:calendar-open', event => {
      if (event.detail?.source !== 'range') close(false);
    });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    if ('MutationObserver' in window) {
      new MutationObserver(() => {
        if (openRange && !openRange.trigger.isConnected) close(false);
      }).observe(document.body, { childList: true, subtree: true });
    }
    return popup;
  }

  function withinSchoolYear(value, yearStart, yearEnd) {
    return (!validDate(yearStart) || value >= yearStart) && (!validDate(yearEnd) || value <= yearEnd);
  }

  function canApply(range) {
    return validDate(range.start) && validDate(range.end) && range.end > range.start
      && withinSchoolYear(range.start, range.yearStart, range.yearEnd)
      && withinSchoolYear(range.end, range.yearStart, range.yearEnd);
  }

  function nextSelection(range, value) {
    if (!withinSchoolYear(value, range.yearStart, range.yearEnd)) return range;
    const next = { ...range, active: value, error: '' };
    if (range.step === 'start' || !range.start) {
      next.start = value;
      next.end = '';
      next.step = 'end';
    } else if (value <= range.start) {
      next.error = 'Choose an end date after the start date.';
    } else {
      next.end = value;
    }
    return next;
  }

  function position() {
    if (!openRange || !openRange.trigger.isConnected) {
      if (openRange) close(false);
      return;
    }
    const rect = openRange.trigger.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const top = below >= height || below >= above
      ? Math.min(rect.bottom + 6, window.innerHeight - height - 12)
      : Math.max(12, rect.top - height - 6);
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.max(12, top)}px`;
  }

  function render(focusDay = false) {
    if (!openRange) return;
    const range = openRange;
    popup.querySelector('[data-range-title]').textContent = range.name;
    popup.querySelector('[data-range-step]').textContent = range.step === 'start' ? 'Choose start date' : 'Choose end date';
    popup.querySelector('[data-range-month]').textContent = months[range.month];
    const yearField = popup.querySelector('[data-range-year]');
    const bounds = yearBounds(range);
    yearField.min = String(bounds.min);
    yearField.max = String(bounds.max);
    yearField.value = String(range.year).padStart(4, '0');
    updateSelectionSummary(range, popup.querySelector('[data-range-selection]'), popup.querySelector('[data-range-day-count]'));
    const error = popup.querySelector('[data-range-error]');
    error.textContent = range.error || '';
    error.hidden = !range.error;
    popup.querySelector('[data-range-action="apply"]').disabled = !canApply(range) || Boolean(range.error);

    const grid = popup.querySelector('.academic-range-days');
    grid.replaceChildren();
    const firstWeekday = (utcDate(range.year, range.month, 1).getUTCDay() + 6) % 7;
    const daysInMonth = utcDate(range.year, range.month + 1, 0).getUTCDate();
    for (let blank = 0; blank < firstWeekday; blank += 1) {
      const spacer = document.createElement('span');
      spacer.setAttribute('aria-hidden', 'true');
      grid.appendChild(spacer);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const value = `${String(range.year).padStart(4, '0')}-${String(range.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(day);
      button.dataset.date = value;
      button.setAttribute('aria-label', `${formatLongDate(value)}${value === range.start ? ', start date' : value === range.end ? ', end date' : range.start && range.end && value > range.start && value < range.end ? ', in selected range' : ''}`);
      button.setAttribute('aria-pressed', value === range.start || value === range.end ? 'true' : 'false');
      button.tabIndex = value === range.active ? 0 : -1;
      button.disabled = !withinSchoolYear(value, range.yearStart, range.yearEnd);
      if (value === range.start || value === range.end) button.classList.add('is-endpoint');
      else if (range.start && range.end && value > range.start && value < range.end) button.classList.add('is-in-range');
      if (value === today()) {
        button.classList.add('is-today');
        button.setAttribute('aria-current', 'date');
      }
      grid.appendChild(button);
    }
    position();
    if (focusDay) grid.querySelector('[tabindex="0"]:not(:disabled)')?.focus();
  }

  function choose(value) {
    Object.assign(openRange, nextSelection(openRange, value));
    render(true);
  }

  function onPopupClick(event) {
    const day = event.target.closest('[data-date]');
    if (day && !day.disabled) return choose(day.dataset.date);
    const nav = event.target.closest('[data-range-nav]');
    if (nav) {
      const next = utcDate(openRange.year, openRange.month + Number(nav.dataset.rangeNav), 1);
      openRange.year = next.getUTCFullYear();
      openRange.month = next.getUTCMonth();
      openRange.active = `${String(openRange.year).padStart(4, '0')}-${String(openRange.month + 1).padStart(2, '0')}-01`;
      if (validDate(openRange.yearStart) && openRange.active.slice(0, 7) === openRange.yearStart.slice(0, 7)
        && openRange.active < openRange.yearStart) openRange.active = openRange.yearStart;
      render();
      nav.focus();
    }
    const action = event.target.closest('[data-range-action]')?.dataset.rangeAction;
    if (action === 'cancel') close();
    if (action === 'apply') apply();
  }

  function onPopupChange(event) {
    if (!openRange || !event.target.matches('[data-range-year]')) return;
    const bounds = yearBounds(openRange);
    const year = event.target.value;
    const currentYear = openRange.year;
    if (/^\d{1,4}$/.test(year) && Number(year) === currentYear) {
      openRange.error = '';
      render();
      event.target.focus();
      return;
    }
    if (/^\d{1,4}$/.test(year) && setCalendarYear(openRange, year)) {
      render();
      event.target.focus();
      return;
    }
    openRange.error = `Enter a year from ${bounds.min} to ${bounds.max}.`;
    event.target.value = String(currentYear).padStart(4, '0');
    const error = popup.querySelector('[data-range-error]');
    error.textContent = openRange.error;
    error.hidden = false;
    popup.querySelector('[data-range-action="apply"]').disabled = true;
  }

  function onPopupInput(event) {
    if (!openRange || !event.target.matches('[data-range-year]') || !/^\d{4}$/.test(event.target.value)) return;
    if (!setCalendarYear(openRange, event.target.value)) {
      const bounds = yearBounds(openRange);
      openRange.error = `Enter a year from ${bounds.min} to ${bounds.max}.`;
    }
    render();
    event.target.focus();
  }

  function onPopupKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const day = event.target.closest('[data-date]');
    if (!day) return;
    const shift = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    let next = shift ? moveDate(day.dataset.date, shift) : null;
    if (event.key === 'Home') next = moveDate(day.dataset.date, -((new Date(`${day.dataset.date}T00:00:00Z`).getUTCDay() + 6) % 7));
    if (event.key === 'End') next = moveDate(day.dataset.date, 6 - ((new Date(`${day.dataset.date}T00:00:00Z`).getUTCDay() + 6) % 7));
    if (!next) return;
    event.preventDefault();
    if (!withinSchoolYear(next, openRange.yearStart, openRange.yearEnd)) return;
    openRange.active = next;
    openRange.year = Number(next.slice(0, 4));
    openRange.month = Number(next.slice(5, 7)) - 1;
    render(true);
  }

  function updateFields(range) {
    const start = validDate(range.startInput.value) ? displayDate(range.startInput.value) : '';
    const end = validDate(range.endInput.value) ? displayDate(range.endInput.value) : '';
    const label = !start && !end ? 'Select start and end dates'
      : `${start || 'Select start date'} – ${end || 'Select end date'}`;
    range.button.querySelector('span').textContent = label;
    range.button.setAttribute('aria-label', `Date range for ${range.name}: ${label}`);
    range.button.disabled = range.startInput.disabled || range.endInput.disabled;
    range.button.classList.toggle('is-empty', !start && !end);
  }

  function apply() {
    const range = openRange;
    if (!range || popup.querySelector('[data-range-action="apply"]').disabled) return;
    for (const [input, value] of [[range.startInput, range.start], [range.endInput, range.end]]) {
      if (input.value === value) continue;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    updateFields(range);
    close();
  }

  function close(returnFocus = true) {
    if (!openRange) return;
    const trigger = openRange.trigger;
    popup.hidden = true;
    openRange = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus && trigger.isConnected) trigger.focus();
  }

  function open(range, trigger, config) {
    ensurePopup();
    if (openRange?.trigger === trigger) return close();
    close(false);
    document.dispatchEvent(new CustomEvent('academix:calendar-open', { detail: { source: 'range' } }));
    const start = validDate(range.startInput.value) ? range.startInput.value : '';
    const end = validDate(range.endInput.value) ? range.endInput.value : '';
    const yearStart = document.querySelector(config.yearStartSelector)?.value || '';
    const yearEnd = document.querySelector(config.yearEndSelector)?.value || '';
    let active = start || end || (validDate(yearStart) ? yearStart : today());
    if (validDate(yearStart) && active < yearStart) active = yearStart;
    if (validDate(yearEnd) && active > yearEnd) active = yearEnd;
    openRange = { ...range, trigger, start, end, yearStart, yearEnd,
      step: 'start', active,
      year: Number(active.slice(0, 4)), month: Number(active.slice(5, 7)) - 1, error: '' };
    popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    render(true);
  }

  function makeButton(range, config) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'academic-range-field';
    button.innerHTML = '<span></span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></svg>';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    range.group.appendChild(button);
    rangesByButton.set(button, range);
    button.addEventListener('click', () => open(range, button, config));
    range.startInput.addEventListener('change', () => updateFields(range));
    range.endInput.addEventListener('change', () => updateFields(range));
    return button;
  }

  window.initAcademicRangePickers = function initAcademicRangePickers(root, config) {
    if (!root || !config) return;
    if (openRange && !openRange.trigger.isConnected) close(false);
    root.querySelectorAll(config.rowSelector).forEach(row => {
      const startInput = row.querySelector(config.startSelector);
      const endInput = row.querySelector(config.endSelector);
      const group = row.querySelector('[data-academic-range]');
      const fallback = group?.querySelector('.academic-range-native-pair');
      if (!startInput || !endInput || !fallback || startInput.dataset.academicRangeEnhanced) return;
      const name = row.querySelector(config.nameSelector)?.value || 'Grading period';
      const range = { startInput, endInput, name, group };
      range.button = makeButton(range, config);
      updateFields(range);
      startInput.required = false;
      endInput.required = false;
      fallback.hidden = true;
      startInput.dataset.academicRangeEnhanced = 'true';
      const form = row.closest('form');
      if (form && !form.dataset.academicRangeResetBound) {
        form.dataset.academicRangeResetBound = 'true';
        form.addEventListener('reset', () => setTimeout(() => {
          form.querySelectorAll('.academic-range-field').forEach(button => {
            const current = rangesByButton.get(button);
            if (current) updateFields(current);
          });
        }, 0));
      }
    });
  };
})();
