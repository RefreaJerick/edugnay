(() => {
  const FORM_RESET_LISTENERS = new WeakSet();

  function getFieldLabel(input) {
    const nearbyLabel = input.closest('.form-group, .onboarding-field')?.querySelector('label');
    const label = input.labels?.[0] || nearbyLabel;
    const labelText = label?.textContent.replace(/\s+/g, ' ').trim();
    return labelText || input.getAttribute('aria-label') || input.name || 'password';
  }

  function setVisibility(input, visible) {
    const wrapper = input.closest('.password-field');
    const button = wrapper?.querySelector('.password-toggle');
    if (!button) {
      input.type = 'password';
      return;
    }

    const fieldLabel = button.dataset.fieldLabel;
    const showIcon = button.querySelector('[data-password-icon="show"]');
    const hideIcon = button.querySelector('[data-password-icon="hide"]');

    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${fieldLabel}`);
    button.title = `${visible ? 'Hide' : 'Show'} ${fieldLabel}`;
    showIcon.hidden = visible;
    hideIcon.hidden = !visible;
  }

  function watchFormReset(form) {
    if (!form || FORM_RESET_LISTENERS.has(form)) return;
    FORM_RESET_LISTENERS.add(form);
    form.addEventListener('reset', () => {
      form.querySelectorAll('input[data-password-toggle-enhanced]').forEach(input => setVisibility(input, false));
    });
  }

  function makeIcon(name, state) {
    const wrapper = document.createElement('span');
    wrapper.className = 'password-toggle-icon';
    wrapper.dataset.passwordIcon = state;
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.hidden = state === 'hide';

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', name);
    wrapper.append(icon);
    return wrapper;
  }

  function enhancePasswordInput(input) {
    if (!input.parentNode || input.dataset.passwordToggleEnhanced === 'true') return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'password-field';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(input);

    const fieldLabel = getFieldLabel(input);
    const button = document.createElement('button');
    button.className = 'password-toggle';
    button.type = 'button';
    button.setAttribute('aria-label', `Show ${fieldLabel}`);
    if (input.id) button.setAttribute('aria-controls', input.id);
    button.title = `Show ${fieldLabel}`;
    button.dataset.fieldLabel = fieldLabel;
    button.append(makeIcon('eye', 'show'), makeIcon('eye-off', 'hide'));
    wrapper.append(button);

    input.dataset.passwordToggleEnhanced = 'true';
    button.addEventListener('click', () => setVisibility(input, input.type === 'password'));
    watchFormReset(input.form);
    return button;
  }

  function initialize() {
    if (!window.lucide?.createIcons) return;

    const buttons = Array.from(document.querySelectorAll('input[type="password"]'))
      .map(enhancePasswordInput)
      .filter(Boolean);

    if (buttons.length) window.lucide.createIcons();
  }

  window.EDUGNAY_PASSWORD_TOGGLE = Object.freeze({
    hide(input) {
      if (input instanceof HTMLInputElement) setVisibility(input, false);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
