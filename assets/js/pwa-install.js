/* Install Academix without storing school data for offline use. */
(() => {
  const appRoot = new URL('../../', document.currentScript.src);
  let installPrompt = null;
  let installButtons = [];
  let installed = false;

  function isInstalled() {
    return installed || window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function updateButtons() {
    installButtons.forEach(button => { button.hidden = isInstalled(); });
  }

  function installInstructions() {
    const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isAppleMobile) return 'Open Academix in Safari, tap Share, then choose Add to Home Screen.';
    return 'Open your browser menu and choose Install app or Add to Home Screen.';
  }

  function showInstructions() {
    let dialog = document.getElementById('pwaInstallDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'pwaInstallDialog';
      dialog.className = 'pwa-install-dialog';
      dialog.setAttribute('aria-labelledby', 'pwaInstallTitle');
      dialog.innerHTML = '<h2 id="pwaInstallTitle">Install Academix</h2><p></p><button type="button">Close</button>';
      dialog.querySelector('button').addEventListener('click', () => dialog.close());
      document.body.appendChild(dialog);
    }
    dialog.querySelector('p').textContent = installInstructions();
    dialog.showModal();
    dialog.querySelector('button').focus();
  }

  async function handleInstall() {
    if (isInstalled()) return updateButtons();
    if (!installPrompt) return showInstructions();
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      showInstructions();
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installed = true;
    updateButtons();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const dropdown = document.getElementById('tbProfileDropdown');
    if (dropdown) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tb-dropdown-item';
      button.setAttribute('data-install-app', '');
      button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/></svg><span>Install Academix</span>';
      dropdown.insertBefore(button, dropdown.querySelector('.tb-dropdown-divider'));
    }
    installButtons = [...document.querySelectorAll('[data-install-app]')];
    installButtons.forEach(button => button.addEventListener('click', handleInstall));
    updateButtons();
  });

  window.addEventListener('load', () => {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register(new URL('push-sw.js', appRoot).href, { scope: appRoot.pathname })
        .catch(() => { /* Installation and push remain optional when registration fails. */ });
    }
  });
})();
