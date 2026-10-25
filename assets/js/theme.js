/* Apply the saved appearance before stylesheets paint, then wire the static controls. */
(() => {
  'use strict';

  const storageKey = 'edugnay_theme_v1';
  const modes = new Set(['light', 'dark', 'system']);
  const system = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let mode = 'light';
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (modes.has(saved)) mode = saved;
  } catch { /* Browser storage may be unavailable. */ }

  function apply() {
    document.documentElement.dataset.theme = mode === 'dark' || (mode === 'system' && system?.matches)
      ? 'dark' : 'light';
    document.documentElement.dataset.themeMode = mode;
    document.querySelectorAll('[data-theme-control]').forEach(control => {
      const trigger = control.querySelector('[data-theme-trigger]');
      if (trigger) trigger.setAttribute('aria-label', `Appearance: ${mode[0].toUpperCase() + mode.slice(1)}`);
      control.querySelectorAll('input[name="academix-theme"]').forEach(input => { input.checked = input.value === mode; });
    });
  }

  function setMode(next) {
    if (!modes.has(next)) return;
    mode = next;
    try { window.localStorage.setItem(storageKey, mode); } catch { /* Keep this tab usable. */ }
    apply();
  }

  apply();
  const onSystemChange = () => { if (mode === 'system') apply(); };
  if (system?.addEventListener) system.addEventListener('change', onSystemChange);
  else system?.addListener?.(onSystemChange);
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    mode = modes.has(event.newValue) ? event.newValue : 'light';
    apply();
  });
  window.addEventListener('beforeprint', () => { document.documentElement.dataset.theme = 'light'; });
  window.addEventListener('afterprint', apply);

  document.addEventListener('DOMContentLoaded', () => {
    const controls = [...document.querySelectorAll('[data-theme-control]')];
    const close = (control, restoreFocus = false) => {
      const menu = control.querySelector('[data-theme-menu]');
      const trigger = control.querySelector('[data-theme-trigger]');
      if (menu.hidden) return;
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    };
    controls.forEach(control => {
      const trigger = control.querySelector('[data-theme-trigger]');
      const menu = control.querySelector('[data-theme-menu]');
      trigger.addEventListener('click', () => {
        const opening = menu.hidden;
        controls.forEach(other => close(other));
        menu.hidden = !opening;
        trigger.setAttribute('aria-expanded', String(opening));
        if (opening) menu.querySelector('input:checked')?.focus();
      });
      menu.addEventListener('change', event => {
        if (event.target.matches('input[name="academix-theme"]')) {
          setMode(event.target.value);
          close(control, true);
        }
      });
      menu.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        close(control);
      });
    });
    document.addEventListener('pointerdown', event => {
      controls.forEach(control => { if (!control.contains(event.target)) close(control); });
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') controls.forEach(control => close(control, true));
    });
    apply();
  });

  window.ACADEMIX_THEME = { getMode: () => mode, setMode };
})();
