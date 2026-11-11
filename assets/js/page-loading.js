(function initializeAcademixPageLoading() {
  let state = 'pending';
  let loader = null;
  let timer = null;
  let body = null;
  let failureMessage = '';
  let readyRequested = false;

  function clearTimer() {
    if (timer) window.clearTimeout(timer);
    timer = null;
  }

  function showFailure() {
    if (!loader || state !== 'failed') return;
    loader.classList.add('is-error');
    loader.setAttribute('role', 'alert');
    loader.setAttribute('aria-live', 'assertive');
    loader.removeAttribute('aria-label');
    const message = document.createElement('span');
    message.className = 'academix-page-loader-message';
    message.textContent = failureMessage || 'This page could not be loaded.';
    const retry = document.createElement('button');
    retry.className = 'top-btn secondary academix-page-loader-retry';
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => window.location.reload());
    loader.append(message);
    loader.append(retry);
  }

  function initialize() {
    body = document.body;
    if (!body?.dataset.pageLoading) return;
    if (state === 'ready') {
      body.dataset.pageLoadingComplete = 'true';
      return;
    }

    const main = document.querySelector('main.main');
    if (!main) {
      state = 'ready';
      body.dataset.pageLoadingComplete = 'true';
      return;
    }

    loader = document.createElement('section');
    loader.className = 'academix-page-loader';
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-live', 'polite');
    loader.setAttribute('aria-atomic', 'true');
    loader.setAttribute('aria-label', body.dataset.pageLoading);
    loader.innerHTML = `
      <span class="academix-page-loader-mark" aria-hidden="true"></span>
    `;
    main.prepend(loader);

    if (state === 'failed') {
      showFailure();
      return;
    }
    state = 'loading';
    timer = window.setTimeout(fail, 25000);
  }

  function ready() {
    if (state === 'ready') return;
    if (document.documentElement.classList.contains('school-accent-pending')) {
      readyRequested = true;
      return;
    }
    readyRequested = false;
    state = 'ready';
    clearTimer();
    if (body) body.dataset.pageLoadingComplete = 'true';
    loader?.remove();
    loader = null;
  }

  function fail(message = '') {
    if (state !== 'loading' && state !== 'pending') return;
    state = 'failed';
    failureMessage = String(message || '');
    clearTimer();
    showFailure();
    document.dispatchEvent(new Event('edugnay:page-loading-failed'));
  }

  window.EDUGNAY_PAGE_LOADING = { ready, fail, isLoading: () => state === 'loading' };
  document.addEventListener('edugnay:school-accent-ready', () => {
    if (readyRequested && state !== 'failed') ready();
  });
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();
