/* The frontend and API are served from the same Express origin. */
(() => {
  const appOrigin = window.location.origin;
  window.EDUGNAY_APP_CONFIG = Object.freeze({
    frontendUrl: appOrigin,
    apiBaseUrl: `${appOrigin}/api`
  });
})();
