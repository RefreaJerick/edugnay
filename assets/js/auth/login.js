const API_BASE_URL = String(window.EDUGNAY_APP_CONFIG?.apiBaseUrl || '').trim().replace(/\/+$/, '');

    const AUTH_CONFIG = {
      frontendOnly: false,
      apiBaseUrl: API_BASE_URL,
      endpoints: {
        requestPasswordReset: '/auth/password-reset/request',
        confirmPasswordReset: '/auth/password-reset/confirm'
      }
    };

    const AUTH_VIEWS = ['signin', 'forgot', 'sent', 'reset', 'complete'];
    const DASHBOARD_BY_ROLE = {
      school_admin: './views/admin/edugnay-admin-dashboard.html',
      teacher: './views/teacher/edugnay-teacher-dashboard.html',
      student: './views/student/edugnay-student-dashboard.html',
      parent: './views/parent/edugnay-parent-dashboard.html',
      platform_admin: './views/platform/edugnay-platform-dashboard.html'
    };

    const AUTH_STATE = {
      pendingRecoveryEmail: '',
      resetToken: new URLSearchParams(window.location.search).get('token')
        || new URLSearchParams(window.location.search).get('resetToken')
        || ''
    };

    function showAuthView(viewName) {
      AUTH_VIEWS.forEach(name => {
        const view = document.querySelector(`[data-auth-view="${name}"]`);
        if (!view) return;
        const isActive = name === viewName;
        view.classList.toggle('active', isActive);
        view.setAttribute('aria-hidden', String(!isActive));
      });

      const activeView = document.querySelector(`[data-auth-view="${viewName}"]`);
      const firstInput = activeView?.querySelector('input');
      if (firstInput) window.setTimeout(() => firstInput.focus(), 0);
    }

    function openForgotPassword() {
      setAuthMessage('forgotMessage', '');
      showAuthView('forgot');
    }

    function setAuthMessage(elementId, message, isError = false) {
      const element = document.getElementById(elementId);
      if (!element) return;
      element.textContent = message;
      element.classList.toggle('error', isError);
    }

    function setSubmitting(button, isSubmitting, loadingLabel) {
      if (!button) return;
      if (isSubmitting) {
        button.dataset.originalLabel = button.textContent;
        button.textContent = loadingLabel;
        button.disabled = true;
        return;
      }
      button.textContent = button.dataset.originalLabel || button.textContent;
      button.disabled = false;
    }

    async function postAuthData(endpoint, payload) {
      const response = await fetch(`${AUTH_CONFIG.apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'The request could not be completed.');
      return data;
    }

    async function requestPasswordReset(event) {
      event.preventDefault();
      const form = event.target;
      const personalEmailInput = document.getElementById('resetEmailInput');
      const personalEmail = personalEmailInput.value.trim();
      const submitButton = form.querySelector('button[type="submit"]');

      if (!personalEmail || !personalEmailInput.checkValidity()) {
        setAuthMessage('forgotMessage', 'Enter a valid personal email address.', true);
        personalEmailInput.focus();
        return;
      }

      if (AUTH_CONFIG.frontendOnly) {
        setAuthMessage('forgotMessage', 'Password recovery is not available right now. Contact your school administrator.', true);
        return;
      }

      setAuthMessage('forgotMessage', '');
      setSubmitting(submitButton, true, 'Preparing Reset...');

      try {
        await postAuthData(AUTH_CONFIG.endpoints.requestPasswordReset, { personalEmail });
        AUTH_STATE.pendingRecoveryEmail = personalEmail;
        document.getElementById('resetEmailSummary').textContent = personalEmail;
        showAuthView('sent');
      } catch (error) {
        setAuthMessage('forgotMessage', 'Unable to process the request right now. Please try again.', true);
      } finally {
        setSubmitting(submitButton, false, 'Send Reset Link');
      }
    }

    function openResetPassword() {
      if (AUTH_CONFIG.frontendOnly) return;
      document.getElementById('resetPasswordForm').reset();
      setAuthMessage('resetPasswordMessage', '');
      showAuthView('reset');
    }

    function goBackFromReset() {
      showAuthView(AUTH_STATE.pendingRecoveryEmail ? 'sent' : 'signin');
    }

    async function completePasswordReset(event) {
      event.preventDefault();
      const form = event.target;
      const password = document.getElementById('newPasswordInput').value;
      const confirmation = document.getElementById('confirmPasswordInput').value;
      const submitButton = form.querySelector('button[type="submit"]');

      if (password.length < 12) {
        setAuthMessage('resetPasswordMessage', 'Your password must contain at least 12 characters.', true);
        return;
      }
      if (password !== confirmation) {
        setAuthMessage('resetPasswordMessage', 'The passwords do not match.', true);
        return;
      }
      if (!AUTH_STATE.resetToken) {
        setAuthMessage('resetPasswordMessage', 'This reset link is missing or invalid.', true);
        return;
      }

      setAuthMessage('resetPasswordMessage', '');
      setSubmitting(submitButton, true, 'Updating Password...');

      try {
        if (!AUTH_CONFIG.frontendOnly) {
          await postAuthData(AUTH_CONFIG.endpoints.confirmPasswordReset, {
            token: AUTH_STATE.resetToken,
            password
          });
        }
        form.reset();
        showAuthView('complete');
      } catch (error) {
        setAuthMessage('resetPasswordMessage', 'Unable to reset the password. The link may have expired.', true);
      } finally {
        setSubmitting(submitButton, false, 'Reset Password');
      }
    }

    function returnToSignIn() {
      AUTH_STATE.pendingRecoveryEmail = '';
      AUTH_STATE.resetToken = '';
      document.getElementById('passwordInput').value = '';
      setAuthMessage('signInMessage', '');
      if (window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      showAuthView('signin');
    }

    function clearPortalCachesForSignIn() {
      const prefixes = ['edugnay_teacher_sidebar_v1:', 'edugnay_student_sidebar_v1:', 'edugnay_parent_sidebar_v1:',
        'edugnay_profile_display_v1', 'edugnay_student_profile_display_v1', 'edugnay_school_accent_v1', 'edugnay_school_brand_v1'];
      try {
        for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
          const key = sessionStorage.key(index);
          if (prefixes.some(prefix => key?.startsWith(prefix))) sessionStorage.removeItem(key);
        }
      } catch { /* A storage failure must not block sign-in. */ }
    }

    function destinationForUser(user) {
      const dashboard = DASHBOARD_BY_ROLE[user.role];
      if (!dashboard) return null;
      const requestedPath = new URLSearchParams(window.location.search).get('returnTo');
      const folder = { school_admin: 'admin', platform_admin: 'platform' }[user.role] || user.role;
      const appRoot = new URL('./', window.location.href);
      const destination = requestedPath ? new URL(requestedPath, window.location.origin) : null;
      const expectedPath = new URL(`views/${folder}/edugnay-${folder}-notifications.html`, appRoot).pathname;
      return destination?.origin === window.location.origin && destination.pathname === expectedPath
        && /^\d+$/.test(destination.searchParams.get('pushNotice') || '')
        ? destination.href : dashboard;
    }

    async function checkEmail(event) {
      if (event) event.preventDefault();
      const form = document.getElementById('signInForm');
      const schoolEmailInput = document.getElementById('emailInput');
      const passwordInput = document.getElementById('passwordInput');
      const schoolEmail = schoolEmailInput.value.trim();
      const password = passwordInput.value;
      const submitButton = form.querySelector('button[type="submit"]');

      if (!schoolEmail || !schoolEmailInput.checkValidity()) {
        setAuthMessage('signInMessage', 'Enter your school email.', true);
        return;
      }
      if (!password) {
        setAuthMessage('signInMessage', 'Enter your password.', true);
        passwordInput.focus();
        return;
      }

      setAuthMessage('signInMessage', '');
      setSubmitting(submitButton, true, 'Signing in...');
      try {
        if (!AUTH_CONFIG.apiBaseUrl) {
          throw new Error('Sign-in isn’t available right now. Refresh and try again.');
        }

        const { user } = await postAuthData('/auth/login', { schoolEmail, password });
        clearPortalCachesForSignIn();
        const destination = destinationForUser(user);
        if (!destination) throw new Error('This account cannot access a portal. Contact your school administrator.');
        window.location.href = destination;
      } catch (error) {
        setAuthMessage('signInMessage', error.message || 'Unable to sign in right now. Please try again.', true);
        passwordInput.focus();
      } finally {
        setSubmitting(submitButton, false, 'Sign In');
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('resetFlowButton').hidden = !AUTH_CONFIG.frontendOnly;
      if (AUTH_STATE.resetToken) showAuthView('reset');
      if (!AUTH_STATE.resetToken && AUTH_CONFIG.apiBaseUrl) {
        fetch(`${AUTH_CONFIG.apiBaseUrl}/auth/me`, { credentials: 'include' })
          .then(response => response.ok ? response.json() : null)
          .then(data => {
            if (data?.user) {
              const destination = destinationForUser(data.user);
              if (destination) window.location.replace(destination);
            }
          }).catch(() => {});
      }
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p4b0dd68b8dbe: function(event) { openForgotPassword() },
    p4c65191a86f8: function(event) { showAuthView('signin') },
    p64d20c59e602: function(event) { openResetPassword() },
    pa083731782c3: function(event) { goBackFromReset() },
    pab59cd8c26d0: function(event) { returnToSignIn() },
  },
  submit: {
    p2649b5ce3f8e: function(event) { completePasswordReset(event) },
    p5018c1f2d823: function(event) { checkEmail(event) },
    pbc5d395dba2e: function(event) { requestPasswordReset(event) },
  },
});
