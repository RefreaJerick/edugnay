(function () {
  const run = () => {
    if (typeof window.initScrollFades === 'function') window.initScrollFades();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
