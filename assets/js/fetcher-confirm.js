window.confirmFetcherAction = (() => {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop dashboard-modal-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `<section class="modal fetcher-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="fetcherConfirmTitle" aria-describedby="fetcherConfirmMessage" style="max-width:400px">
    <div class="modal-head"><div class="modal-heading"><span class="modal-heading-icon" data-heading-icon aria-hidden="true"><i data-lucide="shield-check"></i></span><div class="modal-heading-copy"><h2 class="modal-title" id="fetcherConfirmTitle"></h2><div class="modal-sub" id="fetcherConfirmSub"></div></div></div><button type="button" class="modal-close" data-close aria-label="Close confirmation"><i data-lucide="x"></i></button></div>
    <div class="modal-body"><div class="modal-context" data-context><div class="ctx-icon" data-context-icon><i data-lucide="shield-check"></i></div><div><div class="ctx-label" id="fetcherConfirmContextLabel"></div><div class="ctx-val" id="fetcherConfirmContextValue"></div></div></div><p class="confirm-remove-message" id="fetcherConfirmMessage"></p></div>
    <div class="modal-foot"><button type="button" class="btn btn-cancel" data-cancel>Cancel</button><button type="button" class="btn btn-save" data-confirm></button></div>
  </section>`;
  document.body.appendChild(backdrop);
  window.lucide?.createIcons();
  const title = backdrop.querySelector('#fetcherConfirmTitle');
  const subtitle = backdrop.querySelector('#fetcherConfirmSub');
  const message = backdrop.querySelector('#fetcherConfirmMessage');
  const context = backdrop.querySelector('[data-context]');
  const contextLabelElement = backdrop.querySelector('#fetcherConfirmContextLabel');
  const contextValueElement = backdrop.querySelector('#fetcherConfirmContextValue');
  const headingIcon = backdrop.querySelector('[data-heading-icon]');
  const contextIcon = backdrop.querySelector('[data-context-icon]');
  const confirm = backdrop.querySelector('[data-confirm]');
  const cancel = backdrop.querySelector('[data-cancel]');
  const closeButton = backdrop.querySelector('[data-close]');
  let active = null;

  function close() {
    backdrop.classList.remove('open');
    backdrop.hidden = true;
    const { trigger, resolve } = active;
    active = null;
    const focusTarget = trigger?.isConnected && trigger.getClientRects().length
      ? trigger : [...document.querySelectorAll('main button:not(:disabled):not([hidden])')]
        .find(button => button.getClientRects().length);
    focusTarget?.focus();
    resolve();
  }

  function onKeydown(event) {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!active.busy) close();
    } else if (event.key === 'Tab') {
      const controls = [closeButton, cancel, confirm].filter(button => !button.disabled);
      if (!controls.length) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      const index = controls.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
      event.stopImmediatePropagation();
    }
  }
  document.addEventListener('keydown', onKeydown, true);
  backdrop.addEventListener('click', event => { if (event.target === backdrop && active && !active.busy) close(); });
  closeButton.addEventListener('click', () => { if (active && !active.busy) close(); });
  cancel.addEventListener('click', () => { if (active && !active.busy) close(); });
  confirm.addEventListener('click', async () => {
    if (!active || active.busy) return;
    const current = active;
    current.busy = true;
    backdrop.setAttribute('aria-busy', 'true');
    for (const button of [closeButton, cancel, confirm]) button.disabled = true;
    try { await current.onConfirm(); }
    catch (error) { showAppToast(error.message || 'The action could not be completed.', 'error'); }
    finally {
      backdrop.removeAttribute('aria-busy');
      for (const button of [closeButton, cancel, confirm]) button.disabled = false;
      if (active === current) close();
    }
  });

  return ({ title: heading, subtitle: subheading, contextLabel, contextValue, icon = 'shield-check', message: body, confirmLabel, destructive = false, trigger, onConfirm }) => {
    if (active) return Promise.resolve();
    title.textContent = heading;
    subtitle.textContent = subheading;
    contextLabelElement.textContent = contextLabel;
    contextValueElement.textContent = contextValue;
    message.textContent = body;
    confirm.textContent = confirmLabel;
    confirm.className = destructive ? 'btn btn-danger' : 'btn btn-save';
    headingIcon.classList.toggle('danger', destructive);
    context.classList.toggle('confirm-remove-context', destructive);
    for (const target of [headingIcon, contextIcon]) target.innerHTML = `<i data-lucide="${['shield-check', 'shield-x', 'refresh-cw', 'badge-check'].includes(icon) ? icon : 'shield-check'}"></i>`;
    window.lucide?.createIcons();
    backdrop.hidden = false;
    backdrop.classList.add('open');
    closeButton.focus();
    return new Promise(resolve => { active = { trigger, onConfirm, resolve, busy: false }; });
  };
})();
