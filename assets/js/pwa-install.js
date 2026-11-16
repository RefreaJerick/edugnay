/* Install Academix without storing school data for offline use. */
(() => {
  const appRoot = new URL('../../', document.currentScript.src);
  let installPrompt = null;
  let installed = false;
  let dialogTrigger = null;

  function isInstalled() {
    return installed || window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function installInstructions() {
    const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isAppleMobile) return 'Open Academix in Safari, tap Share, then choose Add to Home Screen.';
    return 'Open your browser menu and choose Install app or Add to Home Screen.';
  }

  function showDialog(message, trigger) {
    let dialog = document.getElementById('pwaInstallDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'pwaInstallDialog';
      dialog.className = 'pwa-install-dialog';
      dialog.setAttribute('aria-labelledby', 'pwaInstallTitle');
      dialog.setAttribute('aria-describedby', 'pwaInstallDescription');
      dialog.innerHTML = `
        <div class="pwa-dialog-heading">
          <span class="pwa-dialog-icon" aria-hidden="true"><i data-lucide="download"></i></span>
          <h2 class="pwa-dialog-title" id="pwaInstallTitle">Install Academix</h2>
          <button class="pwa-dialog-close" type="button" aria-label="Close install information">
            <i data-lucide="x" aria-hidden="true"></i>
          </button>
        </div>
        <p class="pwa-dialog-description" id="pwaInstallDescription"></p>`;
      dialog.querySelector('.pwa-dialog-close').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => {
        if (dialogTrigger?.isConnected) dialogTrigger.focus();
        dialogTrigger = null;
      });
      document.body.appendChild(dialog);
      window.lucide?.createIcons();
    }
    if (dialog.open) {
      dialog.querySelector('.pwa-dialog-description').textContent = message;
      return;
    }
    dialogTrigger = trigger;
    dialog.querySelector('.pwa-dialog-description').textContent = message;
    dialog.showModal();
    dialog.querySelector('.pwa-dialog-close').focus();
  }

  async function handleInstall(event) {
    const trigger = event.currentTarget;
    if (isInstalled()) {
      return showDialog(
        'Academix is already installed on this device. You can launch it from your home screen or app list.',
        trigger
      );
    }
    if (!installPrompt) return showDialog(installInstructions(), trigger);
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      showDialog(installInstructions(), trigger);
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installed = true;
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
    const installButtons = [...document.querySelectorAll('[data-install-app]')];
    installButtons.forEach(button => button.addEventListener('click', handleInstall));
  });

  window.addEventListener('load', () => {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register(new URL('push-sw.js', appRoot).href, { scope: appRoot.pathname })
        .catch(() => { /* Installation and push remain optional when registration fails. */ });
    }
  });
})();
