/* Apply the saved appearance before stylesheets paint, then wire the static controls. */
(() => {
  'use strict';

  const storageKey = 'edugnay_theme_v1';
  const schoolAccentCacheKey = 'edugnay_school_accent_v1';
  const profileSnapshotKey = 'edugnay_profile_display_v1';
  const modes = new Set(['light', 'dark', 'system']);
  const schoolAccents = new Set(['default-blue', 'deep-teal', 'forest-green', 'plum', 'burgundy']);
  const schoolRoleByFolder = { admin: 'school_admin', teacher: 'teacher', student: 'student', parent: 'parent' };
  const schoolPageFolder = window.location?.pathname?.match(/\/views\/(admin|teacher|student|parent)\//i)?.[1]?.toLowerCase() || null;
  const schoolPageRole = schoolPageFolder ? schoolRoleByFolder[schoolPageFolder] : null;
  const system = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const root = document.documentElement;
  let pendingAccentTimer = null;
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

  function setSchoolAccent(palette) {
    if (!palette) {
      delete root.dataset.schoolAccent;
      try { window.sessionStorage?.removeItem(schoolAccentCacheKey); } catch { /* Keep the page usable if storage is unavailable. */ }
      releasePendingSchoolAccent();
      return;
    }
    const safePalette = schoolAccents.has(palette) ? palette : 'default-blue';
    root.dataset.schoolAccent = safePalette;
    releasePendingSchoolAccent();
  }

  function releasePendingSchoolAccent() {
    root.classList?.remove('school-accent-pending');
    if (pendingAccentTimer !== null) window.clearTimeout(pendingAccentTimer);
    pendingAccentTimer = null;
    document.dispatchEvent(new Event('edugnay:school-accent-ready'));
  }

  function readCachedSchoolAccent() {
    if (!schoolPageRole) return null;
    try {
      const snapshot = JSON.parse(window.sessionStorage?.getItem(profileSnapshotKey) || 'null');
      if (snapshot?.version !== 1 || snapshot.role !== schoolPageRole || !snapshot.userId || !snapshot.schoolId) return null;
      const cached = JSON.parse(window.sessionStorage?.getItem(schoolAccentCacheKey) || 'null');
      if (cached?.version !== 1 || String(cached.schoolId) !== String(snapshot.schoolId)
        || !schoolAccents.has(cached.palette)) return null;
      return cached;
    } catch { return null; }
  }

  function cacheSchoolAccent(schoolId, palette) {
    if (!schoolPageRole || schoolId === undefined || schoolId === null || !String(schoolId).trim()) return;
    try {
      window.sessionStorage?.setItem(schoolAccentCacheKey, JSON.stringify({
        version: 1,
        schoolId: String(schoolId),
        palette: schoolAccents.has(palette) ? palette : 'default-blue'
      }));
    } catch { /* A cache failure must not block school context. */ }
  }

  document.addEventListener('edugnay:school-context-updated', event => {
    if (!schoolPageRole) return;
    const school = event.detail;
    setSchoolAccent(school?.accentPalette || (school?.id ? 'default-blue' : null));
    if (school?.id) cacheSchoolAccent(school.id, school.accentPalette || 'default-blue');
  });
  document.addEventListener('edugnay:page-loading-failed', releasePendingSchoolAccent);

  const cachedSchoolAccent = readCachedSchoolAccent();
  if (schoolPageRole && cachedSchoolAccent) {
    setSchoolAccent(cachedSchoolAccent.palette);
  } else if (schoolPageRole) {
    root.classList?.add('school-accent-pending');
    pendingAccentTimer = window.setTimeout(releasePendingSchoolAccent, 25000);
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
    if (schoolPageRole && root.classList?.contains('school-accent-pending')) {
      const schoolReady = window.EDUGNAY_SCHOOL_READY;
      if (schoolReady && typeof schoolReady.then === 'function') {
        Promise.resolve(schoolReady).then(school => {
          if (!root.dataset.schoolAccent && school?.id) {
            setSchoolAccent(school.accentPalette || 'default-blue');
            cacheSchoolAccent(school.id, school.accentPalette || 'default-blue');
          } else {
            releasePendingSchoolAccent();
          }
        }).catch(releasePendingSchoolAccent);
      } else {
        releasePendingSchoolAccent();
      }
    }
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

  window.ACADEMIX_THEME = { getMode: () => mode, setMode, setSchoolAccent };
})();
