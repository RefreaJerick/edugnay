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
    const resolvedTheme = mode === 'dark' || (mode === 'system' && system?.matches) ? 'dark' : 'light';
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themeMode = mode;
    document.querySelectorAll('[data-theme-control]').forEach(control => {
      const trigger = control.querySelector('[data-theme-trigger]');
      if (!trigger) return;
      const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
      const label = `Switch to ${nextTheme} mode`;
      const icon = nextTheme === 'dark' ? 'moon' : 'sun';
      trigger.setAttribute('aria-label', label);
      trigger.setAttribute('title', label);
      trigger.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
      window.lucide?.createIcons({ root: trigger });
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
    document.querySelectorAll('[data-theme-control]').forEach(control => {
      const trigger = control.querySelector('[data-theme-trigger]');
      if (!trigger) return;
      trigger.addEventListener('click', () => {
        const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
        setMode(currentTheme === 'dark' ? 'light' : 'dark');
      });
    });
    apply();
  });

  window.ACADEMIX_THEME = { getMode: () => mode, setMode };
})();
