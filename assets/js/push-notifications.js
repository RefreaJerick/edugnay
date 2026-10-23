/* Device push is optional; in-app notifications remain available without it. */
document.addEventListener('DOMContentLoaded', () => {
  const apiBase = String(window.EDUGNAY_APP_CONFIG?.apiBaseUrl || '').replace(/\/+$/, '');
  const appRoot = new URL('../../', window.location.href);
  const workerUrl = new URL('push-sw.js', appRoot);
  const support = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const panel = document.querySelector('.notif-panel-head');
  if (!panel || !apiBase) return;

  async function request(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      ...options, credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'Device notifications are unavailable.');
    }
    return response.status === 204 ? null : response.json();
  }

  function publicKeyBytes(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  const settingsTrigger = document.createElement('button');
  settingsTrigger.className = 'push-settings-trigger';
  settingsTrigger.type = 'button';
  settingsTrigger.setAttribute('aria-label', 'Notification settings');
  settingsTrigger.setAttribute('aria-haspopup', 'dialog');
  settingsTrigger.setAttribute('aria-expanded', 'false');
  settingsTrigger.setAttribute('aria-controls', 'pushSettingsDialog');
  settingsTrigger.title = 'Notification settings';
  settingsTrigger.innerHTML = '<i data-lucide="settings" aria-hidden="true"></i>';
  panel.appendChild(settingsTrigger);

  const dialog = document.createElement('dialog');
  dialog.className = 'push-settings-dialog';
  dialog.id = 'pushSettingsDialog';
  dialog.setAttribute('aria-labelledby', 'pushSettingsTitle');
  dialog.setAttribute('aria-describedby', 'pushSettingsDescription');
  dialog.innerHTML = `
    <div class="push-dialog-heading">
      <span class="push-icon" aria-hidden="true"><i data-lucide="bell"></i></span>
      <div class="push-dialog-copy">
        <h2 class="push-dialog-title" id="pushSettingsTitle">Device notifications</h2>
      </div>
      <button class="push-dialog-close" type="button" aria-label="Close notification settings">
        <i data-lucide="x" aria-hidden="true"></i>
      </button>
    </div>
    <p class="push-dialog-description" id="pushSettingsDescription">
      Alerts appear on this device. In-app notifications remain available.
    </p>
    <div class="push-dialog-status" role="status" aria-live="polite"></div>
    <button class="push-toggle" type="button" hidden></button>`;
  document.body.appendChild(dialog);
  window.lucide?.createIcons();
  const status = dialog.querySelector('.push-dialog-status');
  const button = dialog.querySelector('.push-toggle');
  const closeButton = dialog.querySelector('.push-dialog-close');
  let publicKey;
  let registration;
  let enabled = false;

  function render(message) {
    status.textContent = message || (enabled ? 'Enabled on this device' : 'Off on this device');
    button.textContent = enabled ? 'Turn off device notifications' : 'Enable device notifications';
    button.hidden = !publicKey || !support || (typeof Notification !== 'undefined' && Notification.permission === 'denied');
    button.disabled = false;
  }

  settingsTrigger.addEventListener('click', () => {
    dialog.showModal();
    settingsTrigger.setAttribute('aria-expanded', 'true');
    closeButton.focus();
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    settingsTrigger.setAttribute('aria-expanded', 'false');
    settingsTrigger.focus();
  });

  async function init() {
    if (!support || !window.isSecureContext) return render('Not supported in this browser or connection');
    if (Notification.permission === 'denied') return render('Blocked in browser settings');
    try {
      const config = await request('/notifications/push-key');
      publicKey = config.enabled ? config.publicKey : null;
      if (!publicKey) return render('Not configured yet');
      registration = await navigator.serviceWorker.register(workerUrl.href, { scope: appRoot.pathname });
      const subscription = await registration.pushManager.getSubscription();
      enabled = Boolean(subscription && (await request('/notifications/push-subscriptions/status', {
        method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint })
      })).enabled);
      render();
    } catch { render('Device notifications could not be loaded'); }
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (enabled) {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await request('/notifications/push-subscriptions', {
            method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint })
          });
          await subscription.unsubscribe();
        }
        enabled = false;
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return render('Notifications were not allowed');
        registration ||= await navigator.serviceWorker.register(workerUrl.href, { scope: appRoot.pathname });
        const subscription = await registration.pushManager.getSubscription() ||
          await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(publicKey) });
        await request('/notifications/push-subscriptions', {
          method: 'POST', body: JSON.stringify(subscription.toJSON())
        });
        enabled = true;
      }
      render();
    } catch (error) { render(error.message || 'Could not update device notifications'); }
  });

  async function openPushTarget() {
    const id = new URLSearchParams(location.search).get('pushNotice');
    if (!/^\d+$/.test(id || '')) return;
    try {
      const response = await request('/auth/me');
      if (!response.user) throw new Error('Sign-in required');
    } catch {
      const login = new URL('index.html', appRoot);
      login.searchParams.set('returnTo', location.pathname + location.search);
      location.replace(login.href);
      return;
    }
    await window.EDUGNAY_COMMUNICATION_READY?.catch(() => {});
    // Page scripts render the list after the same communication promise settles.
    await new Promise(resolve => setTimeout(resolve, 0));
    const item = [...document.querySelectorAll('.notif-item')].find(element => element.dataset.notificationId === id);
    if (item) { item.classList.add('push-highlight'); item.scrollIntoView({ block: 'center' }); }
  }

  init();
  openPushTarget();
});
