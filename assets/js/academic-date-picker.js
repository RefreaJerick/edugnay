/* Shared single-date, date-time, and month picker for Academix forms. */
(function () {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const enhanced = new WeakMap();
  let popup = null;
  let active = null;
  let observer = null;
  let nextId = 0;

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function validMonth(value) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
  }

  function parseDateTime(value) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
    if (!match || !validDate(match[1])) return null;
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    return hour <= 23 && minute <= 59 ? { date: match[1], hour, minute } : null;
  }

  function parseTime(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value || '');
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
  }

  function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function moveDate(value, days) {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function displayDate(value) {
    return validDate(value)
      ? `${MONTHS[Number(value.slice(5, 7)) - 1].slice(0, 3)} ${value.slice(8, 10)}, ${value.slice(0, 4)}`
      : '';
  }

  function displayDateTime(value) {
    const parsed = parseDateTime(value);
    if (!parsed) return '';
    const hour12 = parsed.hour % 12 || 12;
    return `${displayDate(parsed.date)} · ${String(hour12).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')} ${parsed.hour >= 12 ? 'PM' : 'AM'}`;
  }

  function displayTime(value) {
    const parsed = parseTime(value);
    if (!parsed) return '';
    const hour12 = parsed.hour % 12 || 12;
    return `${String(hour12).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')} ${parsed.hour >= 12 ? 'PM' : 'AM'}`;
  }

  function boundDate(value) {
    return /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0, 10) : '';
  }

  function yearBounds(state) {
    const minimum = state.type === 'month'
      ? (validMonth(state.input.min) ? Number(state.input.min.slice(0, 4)) : 1)
      : (boundDate(state.input.min) ? Number(state.input.min.slice(0, 4)) : 1);
    const maximum = state.type === 'month'
      ? (validMonth(state.input.max) ? Number(state.input.max.slice(0, 4)) : 9999)
      : (boundDate(state.input.max) ? Number(state.input.max.slice(0, 4)) : 9999);
    return { min: Math.max(1, minimum), max: Math.min(9999, maximum) };
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

  function setCalendarYear(state, value) {
    const year = Number(value);
    const bounds = yearBounds(state);
    if (!Number.isInteger(year) || year < bounds.min || year > bounds.max || state.type === 'time') return false;

    if (state.type === 'month') {
      let month = state.date.slice(0, 7);
      month = `${String(year).padStart(4, '0')}-${month.slice(5, 7)}`;
      const minimum = validMonth(state.input.min) ? state.input.min : '';
      const maximum = validMonth(state.input.max) ? state.input.max : '';
      if (minimum && month < minimum) month = minimum;
      if (maximum && month > maximum) month = maximum;
      state.monthValue = month;
      state.date = `${month}-01`;
    } else {
      let date = dateForYear(state.date, year);
      const minimum = boundDate(state.input.min);
      const maximum = boundDate(state.input.max);
      if (minimum && date < minimum) date = minimum;
      if (maximum && date > maximum) date = maximum;
      state.date = date;
    }
    state.error = '';
    return true;
  }

  function selectedHour(state) {
    if (!Number.isInteger(state.hour12) || state.hour12 < 1 || state.hour12 > 12
      || !['am', 'pm'].includes(state.period)) return NaN;
    return state.hour12 % 12 + (state.period === 'pm' ? 12 : 0);
  }

  function valueFor(state) {
    if (state.cleared) return '';
    if (state.type === 'month') return state.monthValue || '';
    if (state.type === 'time') {
      const hour = selectedHour(state);
      if (!Number.isInteger(hour) || !Number.isInteger(state.minute) || state.minute < 0 || state.minute > 59) return '';
      return `${String(hour).padStart(2, '0')}:${String(state.minute).padStart(2, '0')}`;
    }
    if (!validDate(state.date)) return '';
    if (state.type === 'date') return state.date;
    const hour = selectedHour(state);
    if (!Number.isInteger(hour) || !Number.isInteger(state.minute) || state.minute < 0 || state.minute > 59) return '';
    return `${state.date}T${String(hour).padStart(2, '0')}:${String(state.minute).padStart(2, '0')}`;
  }

  function inBounds(value, min, max) {
    return (!min || value >= min) && (!max || value <= max);
  }

  function isValidValue(state, value) {
    if (!value) return state.cleared && !state.input.required;
    if (state.type === 'date') return validDate(value) && inBounds(value, state.input.min, state.input.max);
    if (state.type === 'month') return validMonth(value) && inBounds(value, state.input.min, state.input.max);
    if (state.type === 'time') {
      const parsed = parseTime(value);
      if (!parsed) return false;
      const minutes = parsed.hour * 60 + parsed.minute;
      const min = state.input.min ? parseTime(state.input.min) : null;
      const max = state.input.max ? parseTime(state.input.max) : null;
      return (!state.input.min || Boolean(min && minutes >= min.hour * 60 + min.minute))
        && (!state.input.max || Boolean(max && minutes <= max.hour * 60 + max.minute));
    }
    const parsed = parseDateTime(value);
    return Boolean(parsed && inBounds(value, state.input.min, state.input.max));
  }

  function getInputLabel(input) {
    const label = input.labels?.[0] || (input.previousElementSibling?.tagName === 'LABEL' ? input.previousElementSibling : null);
    const text = (label?.textContent || '').replace(/\s+/g, ' ').trim();
    if (label && !label.id) label.id = `academic-date-label-${++nextId}`;
    return { label, text };
  }

  function setupPopup() {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.className = 'academic-range-popup academic-date-popup';
    popup.id = 'academicDatePickerPopup';
    popup.hidden = true;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Choose a date');
    popup.innerHTML = `
      <div class="academic-range-heading"><strong data-date-title></strong><span data-date-step></span></div>
      <div class="academic-range-navigation">
        <button type="button" data-date-nav="-12" aria-label="Previous year"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m11 17-5-5 5-5m7 10-5-5 5-5"/></svg></button>
        <button type="button" data-date-nav="-1" aria-label="Previous month"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
        <div class="academic-range-month-year"><strong data-date-month></strong><input class="academic-range-year-input" type="number" data-date-year min="1" max="9999" step="1" inputmode="numeric" aria-label="Year"></div>
        <button type="button" data-date-nav="1" aria-label="Next month"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
        <button type="button" data-date-nav="12" aria-label="Next year"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 17 5-5-5-5m2 10 5-5-5-5"/></svg></button>
      </div>
      <div class="academic-range-weekdays" aria-hidden="true">${WEEKDAYS.map(day => `<span>${day}</span>`).join('')}</div>
      <div class="academic-range-days" role="group" aria-label="Calendar dates"></div>
      <div class="academic-month-grid" role="group" aria-label="Months" hidden></div>
      <div class="academic-date-time" hidden>
        <label>Hour<input type="number" data-time-hour min="1" max="12" inputmode="numeric" placeholder="hh"></label>
        <span aria-hidden="true">:</span>
        <label>Minute<input type="number" data-time-minute min="0" max="59" inputmode="numeric" placeholder="mm"></label>
        <div class="academic-time-period" role="group" aria-label="AM or PM"><button type="button" data-time-period="am">AM</button><button type="button" data-time-period="pm">PM</button></div>
      </div>
      <div class="academic-range-selection"><span data-date-selection-label>Selected date</span><strong data-date-selection aria-live="polite"></strong></div>
      <p class="academic-range-error" data-date-error role="status" hidden></p>
      <div class="academic-range-actions"><button type="button" class="academic-date-clear" data-date-action="clear">Clear</button><button type="button" class="academic-range-cancel" data-date-action="cancel">Cancel</button><button type="button" class="academic-range-apply" data-date-action="apply">Apply</button></div>`;
    document.body.appendChild(popup);
    popup.addEventListener('click', onPopupClick);
    popup.addEventListener('input', onPopupInput);
    popup.addEventListener('change', onPopupChange);
    popup.addEventListener('keydown', onPopupKeydown);
    popup.addEventListener('focusout', () => setTimeout(() => {
      if (active && !popup.contains(document.activeElement)) close(false);
    }, 0));
    document.addEventListener('pointerdown', event => {
      if (active && !popup.contains(event.target) && !active.button.contains(event.target)) close(false);
    });
    document.addEventListener('academix:calendar-open', event => {
      if (event.detail?.source !== 'date') close(false);
    });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return popup;
  }

  function position() {
    if (!active || !active.button.isConnected) {
      if (active) close(false);
      return;
    }
    const rect = active.button.getBoundingClientRect();
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

  function currentDateFor(input) {
    const { type, value, min, max } = input;
    let date = type === 'month' && validMonth(value) ? `${value}-01`
      : type === 'datetime-local' ? parseDateTime(value)?.date
        : validDate(value) ? value : '';
    if (type === 'month') {
      const minMonth = validMonth(min) ? min : '';
      const maxMonth = validMonth(max) ? max : '';
      if (!date) date = `${today().slice(0, 7)}-01`;
      if (minMonth && date.slice(0, 7) < minMonth) date = `${minMonth}-01`;
      if (maxMonth && date.slice(0, 7) > maxMonth) date = `${maxMonth}-01`;
      return date;
    }
    const minDate = boundDate(min);
    const maxDate = boundDate(max);
    if (!date) date = today();
    if (minDate && date < minDate) date = minDate;
    if (maxDate && date > maxDate) date = maxDate;
    return date;
  }

  function setTimeDraft(state, parsed) {
    state.hour12 = parsed ? parsed.hour % 12 || 12 : NaN;
    state.minute = parsed?.minute ?? NaN;
    state.period = parsed ? (parsed.hour >= 12 ? 'pm' : 'am') : '';
    state.timeTouched = false;
  }

  function loadDraft(state) {
    const value = state.input.value;
    state.cleared = !value;
    if (state.type === 'time') {
      state.date = today();
      setTimeDraft(state, parseTime(value));
      return;
    }
    if (state.type === 'month' && validMonth(value)) {
      state.monthValue = value;
      state.date = `${value}-01`;
      return;
    }
    if (state.type === 'datetime-local') {
      const parsed = parseDateTime(value);
      state.date = parsed?.date || currentDateFor(state.input);
      setTimeDraft(state, parsed);
      return;
    }
    state.date = validDate(value) ? value : currentDateFor(state.input);
  }

  function makeValueForDate(state, date) {
    if (state.type === 'date') return date;
    if (state.type === 'datetime-local') {
      const draft = { ...state, date, cleared: false };
      return valueFor(draft);
    }
    return date.slice(0, 7);
  }

  function dateDisabled(state, date) {
    if (state.type === 'month') return !inBounds(date.slice(0, 7), state.input.min, state.input.max);
    const minDate = boundDate(state.input.min);
    const maxDate = boundDate(state.input.max);
    return (minDate && date < minDate) || (maxDate && date > maxDate);
  }

  function monthDisabled(state, value) {
    return !inBounds(value, state.input.min, state.input.max);
  }

  function timeFromDraft(state) {
    return {
      hour12: Number.isInteger(state.hour12) && state.hour12 >= 1 && state.hour12 <= 12 ? String(state.hour12) : '',
      minute: Number.isInteger(state.minute) && state.minute >= 0 && state.minute <= 59 ? String(state.minute).padStart(2, '0') : '',
      period: state.period || ''
    };
  }

  function draftSummary(state) {
    const value = valueFor(state);
    if (!value) return state.type === 'time' ? 'Select a time'
      : state.type === 'datetime-local' ? 'Select date and time'
        : state.type === 'month' ? 'Select month' : 'Select date';
    if (state.type === 'time') return displayTime(value);
    if (state.type === 'month') {
      const month = Number(value.slice(5, 7)) - 1;
      return `${MONTHS[month]} ${value.slice(0, 4)}`;
    }
    return state.type === 'datetime-local' ? displayDateTime(value) : displayDate(value);
  }

  function validationMessage(state, value) {
    if (state.error) return state.error;
    if ((state.type === 'time' || state.type === 'datetime-local') && !value) {
      if (!state.timeTouched) return '';
      if (!Number.isInteger(state.hour12) || state.hour12 < 1 || state.hour12 > 12) return 'Enter an hour from 1 to 12.';
      if (!Number.isInteger(state.minute) || state.minute < 0 || state.minute > 59) return 'Enter a minute from 00 to 59.';
      if (!state.period) return 'Choose AM or PM.';
      return 'Enter a valid time.';
    }
    if (state.input.required && !value && state.cleared) return state.type === 'time' ? 'Choose a time before continuing.' : 'Choose a date before continuing.';
    if (value && !isValidValue(state, value)) {
      return state.type === 'time' ? 'Choose a valid time within the allowed range.' : 'Choose a value within the allowed date and time limits.';
    }
    return '';
  }

  function canApply(state, value) {
    if ((state.type === 'time' || state.type === 'datetime-local') && !value && !state.input.value) return false;
    return isValidValue(state, value);
  }

  function render(focusActive = false) {
    if (!active) return;
    const state = active;
    const month = Number(state.date.slice(5, 7)) - 1;
    const year = Number(state.date.slice(0, 4));
    const isMonth = state.type === 'month';
    const isTimeOnly = state.type === 'time';
    popup.classList.toggle('is-time-only', isTimeOnly);
    popup.querySelector('[data-date-title]').textContent = state.label || (isTimeOnly ? 'Choose a time' : 'Choose a date');
    popup.querySelector('[data-date-step]').textContent = isTimeOnly ? 'Choose time' : isMonth ? 'Choose month' : state.type === 'datetime-local' ? 'Choose date and time' : 'Choose date';
    popup.setAttribute('aria-label', isTimeOnly ? `Choose time${state.label ? ` for ${state.label.toLowerCase()}` : ''}` : isMonth ? 'Choose reporting month' : state.type === 'datetime-local' ? 'Choose date and time' : 'Choose a date');
    popup.querySelector('[data-date-month]').textContent = isMonth ? '' : MONTHS[month];
    const yearField = popup.querySelector('[data-date-year]');
    const bounds = yearBounds(state);
    yearField.min = String(bounds.min);
    yearField.max = String(bounds.max);
    yearField.value = String(year).padStart(4, '0');
    yearField.hidden = isTimeOnly;
    popup.querySelector('.academic-range-navigation').hidden = isTimeOnly;
    popup.querySelectorAll('[data-date-nav]').forEach(button => {
      const value = Number(button.dataset.dateNav);
      button.hidden = isTimeOnly || (isMonth && Math.abs(value) === 1);
      button.setAttribute('aria-label', `${value < 0 ? 'Previous' : 'Next'} ${Math.abs(value) === 12 ? 'year' : 'month'}`);
    });
    popup.querySelector('.academic-range-weekdays').hidden = isMonth || isTimeOnly;
    popup.querySelector('.academic-range-days').hidden = isMonth || isTimeOnly;
    popup.querySelector('.academic-month-grid').hidden = !isMonth;
    popup.querySelector('.academic-date-time').hidden = state.type !== 'datetime-local' && !isTimeOnly;
    popup.querySelector('[data-date-selection-label]').textContent = isTimeOnly ? 'Selected time' : state.type === 'datetime-local' ? 'Selected date and time' : isMonth ? 'Selected month' : 'Selected date';
    popup.querySelector('[data-date-selection]').textContent = draftSummary(state);

    const time = timeFromDraft(state);
    popup.querySelector('[data-time-hour]').value = time.hour12;
    popup.querySelector('[data-time-minute]').value = time.minute;
    popup.querySelectorAll('[data-time-period]').forEach(button => {
      const selected = button.dataset.timePeriod === time.period;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-active', selected);
    });

    const days = popup.querySelector('.academic-range-days');
    days.replaceChildren();
    if (!isMonth && !isTimeOnly) {
      const firstWeekday = (utcDate(year, month, 1).getUTCDay() + 6) % 7;
      const count = utcDate(year, month + 1, 0).getUTCDate();
      for (let blank = 0; blank < firstWeekday; blank += 1) {
        const spacer = document.createElement('span');
        spacer.setAttribute('aria-hidden', 'true');
        days.appendChild(spacer);
      }
      for (let day = 1; day <= count; day += 1) {
        const value = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = String(day);
        button.dataset.date = value;
        button.setAttribute('aria-label', `${MONTHS[month]} ${day}, ${year}${value === state.date && !state.cleared ? ', selected' : ''}`);
        button.setAttribute('aria-pressed', String(value === state.date && !state.cleared));
        button.tabIndex = value === state.date ? 0 : -1;
        button.disabled = dateDisabled(state, value);
        if (value === state.date && !state.cleared) button.classList.add('is-endpoint');
        if (value === today()) {
          button.classList.add('is-today');
          button.setAttribute('aria-current', 'date');
        }
        days.appendChild(button);
      }
    }

    const months = popup.querySelector('.academic-month-grid');
    months.replaceChildren();
    if (isMonth) {
      for (let index = 0; index < 12; index += 1) {
        const value = `${year}-${String(index + 1).padStart(2, '0')}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = MONTHS[index];
        button.dataset.month = value;
        button.setAttribute('aria-pressed', String(value === state.monthValue && !state.cleared));
        button.setAttribute('aria-label', `${MONTHS[index]} ${year}${value === state.monthValue && !state.cleared ? ', selected' : ''}`);
        button.tabIndex = index === month ? 0 : -1;
        button.disabled = monthDisabled(state, value);
        if (value === state.monthValue && !state.cleared) button.classList.add('is-endpoint');
        months.appendChild(button);
      }
    }

    const value = valueFor(state);
    const valid = canApply(state, value);
    const error = popup.querySelector('[data-date-error]');
    const message = validationMessage(state, value);
    error.textContent = message;
    error.hidden = !message;
    popup.querySelector('[data-date-action="clear"]').hidden = state.input.required;
    popup.querySelector('[data-date-action="apply"]').disabled = !valid || Boolean(state.error);
    position();
    if (focusActive) {
      const target = isTimeOnly
        ? popup.querySelector('[data-time-hour]')
        : (isMonth
        ? months.querySelector('[tabindex="0"]:not(:disabled)')
        : days.querySelector('[tabindex="0"]:not(:disabled)'))
        || popup.querySelector(isMonth ? '.academic-month-grid button:not(:disabled)' : '.academic-range-days button:not(:disabled)')
        || popup.querySelector('[data-date-nav]:not([hidden])');
      target?.focus();
    }
  }

  function chooseDate(value) {
    active.date = value;
    active.cleared = false;
    active.error = '';
    if (active.type === 'month') active.monthValue = value.slice(0, 7);
    render(true);
  }

  function onPopupClick(event) {
    const day = event.target.closest('[data-date]');
    if (day && !day.disabled) return chooseDate(day.dataset.date);
    const month = event.target.closest('[data-month]');
    if (month && !month.disabled) {
      active.monthValue = month.dataset.month;
      active.date = `${active.monthValue}-01`;
      active.cleared = false;
      active.error = '';
      render(true);
      return;
    }
    const nav = event.target.closest('[data-date-nav]');
    if (nav) {
      const next = utcDate(Number(active.date.slice(0, 4)), Number(active.date.slice(5, 7)) - 1 + Number(nav.dataset.dateNav), 1);
      active.date = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
      if (active.type === 'month' && active.monthValue) active.monthValue = `${next.getUTCFullYear()}-${active.monthValue.slice(5, 7)}`;
      active.error = '';
      render();
      nav.focus();
      return;
    }
    const period = event.target.closest('[data-time-period]');
    if (period) {
      active.period = period.dataset.timePeriod;
      active.cleared = false;
      active.timeTouched = true;
      active.error = '';
      render();
      period.focus();
      return;
    }
    const action = event.target.closest('[data-date-action]')?.dataset.dateAction;
    if (action === 'clear') {
      active.cleared = true;
      if (active.type === 'time' || active.type === 'datetime-local') setTimeDraft(active, null);
      active.error = '';
      render();
    } else if (action === 'cancel') close();
    else if (action === 'apply') apply();
  }

  function onPopupInput(event) {
    if (!active) return;
    if (event.target.matches('[data-date-year]')) {
      if (!/^\d{4}$/.test(event.target.value)) return;
      if (!setCalendarYear(active, event.target.value)) {
        const bounds = yearBounds(active);
        active.error = `Enter a year from ${bounds.min} to ${bounds.max}.`;
      }
      render();
      event.target.focus();
      return;
    }
    if (event.target.matches('[data-time-hour]')) {
      const entered = event.target.value === '' ? NaN : Number(event.target.value);
      if (Number.isInteger(entered) && entered >= 1 && entered <= 12) {
        active.hour12 = entered;
        const minuteInput = popup.querySelector('[data-time-minute]');
        if (minuteInput.value === '') {
          active.minute = 0;
          minuteInput.value = '00';
        }
      } else active.hour12 = NaN;
    } else if (event.target.matches('[data-time-minute]')) {
      const entered = event.target.value === '' ? NaN : Number(event.target.value);
      active.minute = Number.isInteger(entered) && entered >= 0 && entered <= 59 ? entered : NaN;
    } else return;
    active.cleared = false;
    active.timeTouched = true;
    active.error = '';
    const value = valueFor(active);
    popup.querySelector('[data-date-selection]').textContent = draftSummary(active);
    const message = validationMessage(active, value);
    const error = popup.querySelector('[data-date-error]');
    error.textContent = message;
    error.hidden = !message;
    popup.querySelector('[data-date-action="apply"]').disabled = !canApply(active, value);
  }

  function onPopupChange(event) {
    if (!active) return;
    if (event.target.matches('[data-date-year]')) {
      const year = event.target.value;
      const currentYear = Number(active.date.slice(0, 4));
      if (/^\d{1,4}$/.test(year) && Number(year) === currentYear) {
        active.error = '';
        render();
        event.target.focus();
        return;
      }
      if (/^\d{1,4}$/.test(year) && setCalendarYear(active, year)) {
        render();
        event.target.focus();
        return;
      }
      const bounds = yearBounds(active);
      active.error = `Enter a year from ${bounds.min} to ${bounds.max}.`;
      event.target.value = String(currentYear).padStart(4, '0');
      const error = popup.querySelector('[data-date-error]');
      error.textContent = active.error;
      error.hidden = false;
      popup.querySelector('[data-date-action="apply"]').disabled = true;
      return;
    }
    onPopupInput(event);
  }

  function moveMonth(delta) {
    const date = utcDate(Number(active.date.slice(0, 4)), Number(active.date.slice(5, 7)) - 1 + delta, 1);
    const desiredDay = Number(active.date.slice(8, 10));
    const last = utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 0).getUTCDate();
    active.date = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(desiredDay, last)).padStart(2, '0')}`;
    if (active.type === 'month') active.monthValue = active.date.slice(0, 7);
    active.cleared = false;
    render(true);
  }

  function onPopupKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (!active) return;
    const monthButton = event.target.closest('[data-month]');
    if (monthButton) {
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[event.key];
      if (delta) {
        event.preventDefault();
        const month = Number(monthButton.dataset.month.slice(5, 7)) - 1 + delta;
        const yearDelta = Math.floor(month / 12);
        const nextMonth = (month % 12 + 12) % 12;
        const year = Number(monthButton.dataset.month.slice(0, 4)) + yearDelta;
        active.monthValue = `${year}-${String(nextMonth + 1).padStart(2, '0')}`;
        active.date = `${active.monthValue}-01`;
        render(true);
      }
      return;
    }
    const day = event.target.closest('[data-date]');
    if (day && active.type !== 'month') {
      const shift = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
      if (shift) {
        event.preventDefault();
        const next = moveDate(day.dataset.date, shift);
        if (!dateDisabled(active, next)) chooseDate(next);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const weekday = (new Date(`${day.dataset.date}T00:00:00Z`).getUTCDay() + 6) % 7;
        const next = moveDate(day.dataset.date, event.key === 'Home' ? -weekday : 6 - weekday);
        if (!dateDisabled(active, next)) chooseDate(next);
      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        moveMonth(event.key === 'PageUp' ? -1 : 1);
      }
    }
  }

  function sync(state) {
    if (!state || !state.button.isConnected) return;
    const input = state.input;
    const disabled = input.matches(':disabled') || input.hidden;
    state.button.disabled = disabled;
    state.wrapper.hidden = input.hidden;
    state.wrapper.classList.toggle('is-disabled', disabled);
    const value = input.value;
    let label = '';
    if (input.type === 'date') label = displayDate(value);
    else if (input.type === 'datetime-local') label = displayDateTime(value);
    else if (input.type === 'time') label = displayTime(value);
    else if (input.type === 'month' && validMonth(value)) label = `${MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;
    const placeholder = input.placeholder || (input.type === 'time' ? 'Select time' : input.type === 'datetime-local' ? 'Select date and time' : input.type === 'month' ? 'Select month' : 'Select date');
    state.button.querySelector('span').textContent = label || placeholder;
    state.button.classList.toggle('is-empty', !label);
    state.button.setAttribute('aria-required', String(input.required));
    if (input.getAttribute('aria-invalid') === 'true') state.button.setAttribute('aria-invalid', 'true');
    else state.button.removeAttribute('aria-invalid');
    if (disabled || input.validity?.valid) {
      state.errorNode.hidden = true;
      state.errorNode.textContent = '';
      state.wrapper.classList.remove('has-error');
      state.button.removeAttribute('aria-invalid');
    }
    if (active?.input === input && disabled) close(false);
  }

  function wrapValueSetter(input, state) {
    const descriptor = window.HTMLInputElement && Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (!descriptor?.get || !descriptor?.set) return;
    try {
      Object.defineProperty(input, 'value', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() { return descriptor.get.call(this); },
        set(value) {
          descriptor.set.call(this, value);
          sync(state);
        }
      });
    } catch (_) {
      // Native input and change events still keep the visible field in sync.
    }
  }

  function open(state) {
    setupPopup();
    if (active?.button === state.button) return close();
    close(false);
    document.dispatchEvent(new CustomEvent('academix:calendar-open', { detail: { source: 'date' } }));
    active = state;
    loadDraft(state);
    state.error = '';
    popup.hidden = false;
    state.button.setAttribute('aria-expanded', 'true');
    render(true);
  }

  function close(returnFocus = true) {
    if (!active) return;
    const button = active.button;
    popup.hidden = true;
    active = null;
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus && button.isConnected) button.focus();
  }

  function apply() {
    const state = active;
    if (!state) return;
    const value = valueFor(state);
    if (!isValidValue(state, value)) {
      state.error = state.input.required && !value
        ? (state.type === 'time' ? 'Choose a time before continuing.' : 'Choose a date before continuing.')
        : (state.type === 'time' ? 'Choose a valid time within the allowed range.' : 'Choose a value within the allowed range.');
      render();
      return;
    }
    if (state.input.value !== value) {
      state.input.value = value;
      state.input.dispatchEvent(new Event('input', { bubbles: true }));
      state.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    state.wrapper.classList.remove('has-error');
    state.button.removeAttribute('aria-invalid');
    state.errorNode.hidden = true;
    close();
  }

  function initialize(input) {
    if (!(input instanceof window.HTMLInputElement) || !['date', 'time', 'datetime-local', 'month'].includes(input.type)
      || input.dataset.academicDateEnhanced || input.closest('[data-academic-range]')) return;
    const { label, text } = getInputLabel(input);
    const wrapper = document.createElement('span');
    wrapper.className = 'academic-date-control';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `academic-date-field${input.classList.contains('date-input') || input.dataset.academicDateCompact === 'true' ? ' is-compact' : ''}${input.type === 'time' ? ' is-time-only' : ''}`;
    button.id = `academic-date-trigger-${++nextId}`;
    const icon = input.type === 'time'
      ? '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
      : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></svg>';
    button.innerHTML = `<span></span>${icon}`;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'academicDatePickerPopup');
    button.setAttribute('aria-label', text || input.getAttribute('aria-label') || (input.type === 'time' ? 'Choose time' : input.type === 'month' ? 'Choose reporting month' : input.type === 'datetime-local' ? 'Choose date and time' : 'Choose date'));
    if (label) button.setAttribute('aria-labelledby', label.id);
    const describedBy = input.getAttribute('aria-describedby');
    if (describedBy) button.setAttribute('aria-describedby', describedBy);

    const errorNode = document.createElement('span');
    errorNode.className = 'academic-date-error';
    errorNode.id = `academic-date-error-${++nextId}`;
    errorNode.hidden = true;
    button.setAttribute('aria-describedby', [describedBy, errorNode.id].filter(Boolean).join(' '));

    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(input, button, errorNode);

    const state = { input, wrapper, button, errorNode, type: input.type, label: text };
    enhanced.set(input, state);
    input.dataset.academicDateEnhanced = 'true';
    input.addEventListener('input', () => sync(state));
    input.addEventListener('change', () => sync(state));
    input.addEventListener('invalid', event => {
      event.preventDefault();
      const message = input.validationMessage || 'Choose a valid date.';
      errorNode.textContent = message;
      errorNode.hidden = false;
      button.setAttribute('aria-invalid', 'true');
      wrapper.classList.add('has-error');
      button.focus();
    });
    button.addEventListener('click', () => open(state));
    wrapValueSetter(input, state);
    sync(state);

    const form = input.form;
    if (form && !form.dataset.academicDateResetBound) {
      form.dataset.academicDateResetBound = 'true';
      form.addEventListener('reset', () => setTimeout(() => {
        form.querySelectorAll('[data-academic-date-enhanced]').forEach(field => {
          const current = enhanced.get(field);
          if (current) {
            current.errorNode.hidden = true;
            current.errorNode.textContent = '';
            current.wrapper.classList.remove('has-error');
            current.button.removeAttribute('aria-invalid');
            sync(current);
          }
        });
      }, 0));
    }
    input.classList.add('academic-date-native-input');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    if (label) Array.from(input.labels || []).forEach(associatedLabel => { associatedLabel.htmlFor = button.id; });
  }

  function scan(root) {
    if (!root) return;
    if (root.matches?.('input[type="date"], input[type="time"], input[type="datetime-local"], input[type="month"]')) initialize(root);
    root.querySelectorAll?.('input[type="date"], input[type="time"], input[type="datetime-local"], input[type="month"]').forEach(initialize);
  }

  function start() {
    scan(document);
    if (observer || !document.body || !('MutationObserver' in window)) return;
    observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') record.addedNodes.forEach(node => { if (node.nodeType === 1) scan(node); });
        else if (record.target.matches?.('input[data-academic-date-enhanced]')) {
          sync(enhanced.get(record.target));
          if (active?.input === record.target && ['min', 'max', 'required', 'step'].includes(record.attributeName)) render();
        }
        else if (record.attributeName === 'disabled') {
          record.target.querySelectorAll?.('input[data-academic-date-enhanced]').forEach(input => sync(enhanced.get(input)));
        }
      }
      if (active && !active.button.isConnected) close(false);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'min', 'max', 'required', 'step'] });
  }

  window.initAcademicDatePickers = scan;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
