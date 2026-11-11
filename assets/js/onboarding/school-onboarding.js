const SCHOOL_LEVELS = window.EDUGNAY_CONFIG.grades.map(item => ({ value: item.key, label: item.label }));
    const ONBOARDING_FEATURES = [
      {
        id: 'school-management',
        title: 'Configure and operate your school',
        description: 'Manage accounts, sections, academic periods, grading rules, and portal access from one school workspace.',
        previewLabel: 'School Management preview',
        imageSrc: '../../assets/images/onboarding/class-management.png',
        imageAlt: ''
      },
      {
        id: 'teaching-tools',
        title: 'Handle daily classroom work',
        description: 'Teachers can manage sections, assignments, score recording, and reviewable QR attendance in one workflow.',
        previewLabel: 'Teaching Tools preview',
        imageSrc: '../../assets/images/onboarding/teacher-attendance.png',
        imageAlt: ''
      },
      {
        id: 'student-progress',
        title: 'Keep families informed',
        description: 'Turn stored attendance, grades, assignments, and teacher insights into reviewable student progress reports.',
        previewLabel: 'Student Progress preview',
        imageSrc: '../../assets/images/onboarding/parent-narrative-report.png',
        imageAlt: ''
      },
      {
        id: 'ai-reports',
        title: 'Prepare reviewable AI reports',
        description: 'Teachers can use stored student records and their own notes to prepare AI-assisted narrative reports before sharing them with families.',
        previewLabel: 'AI Reports preview',
        imageSrc: '../../assets/images/onboarding/ai-report-review.png',
        imageAlt: ''
      },
      {
        id: 'school-forms',
        title: 'Prepare standardized school forms',
        description: 'Use data already stored in the system to prepare supported school forms for preview and XLSX download.',
        previewLabel: 'School Forms preview',
        imageSrc: '../../assets/images/onboarding/sf-templates.png',
        imageAlt: ''
      }
    ];

    const FEATURE_PREVIEW_INTERVAL = 6000;
    const termDrafts = {};
    let featurePreviewTimer = null;
    let featurePreviewAutoPlayStopped = false;

    function renderOnboardingFeaturePreviews() {
      const previewTrack = document.getElementById('onboardingFeaturePreviewTrack');
      const featureCount = String(ONBOARDING_FEATURES.length).padStart(2, '0');

      previewTrack.innerHTML = ONBOARDING_FEATURES.map((feature, index) => {
        const featureIndex = String(index + 1).padStart(2, '0');
        const hasPreviewImage = Boolean(feature.imageSrc);
        const previewContent = hasPreviewImage
          ? `<div class="onboarding-showcase-preview-media">
              <img class="onboarding-showcase-preview-image" src="${feature.imageSrc}" alt="${feature.imageAlt || `${feature.previewLabel} screenshot`}" decoding="async" />
            </div>`
          : `<div class="onboarding-showcase-placeholder" role="img" aria-label="${feature.previewLabel} screenshot placeholder">
              <i data-lucide="image" aria-hidden="true"></i>
              <strong>${feature.previewLabel}</strong>
              <span>Screenshot will be added here.</span>
            </div>`;

        return `<article class="onboarding-showcase-preview-slide" id="onboardingFeatureSlide-${feature.id}" data-feature-id="${feature.id}" aria-label="Feature ${featureIndex} of ${featureCount}: ${feature.previewLabel}">
          <div class="onboarding-showcase-preview-copy">
            <span class="onboarding-showcase-preview-index">${featureIndex} / ${featureCount}</span>
            <h2>${feature.title}</h2>
            <p>${feature.description}</p>
          </div>
          <div class="onboarding-showcase-preview-stage">${previewContent}</div>
        </article>`;
      }).join('');
    }

    function selectOnboardingFeature(featureId) {
      const feature = ONBOARDING_FEATURES.find(item => item.id === featureId);
      const selectedTab = document.getElementById(`onboardingFeatureTab-${featureId}`);
      const selectedSlide = Array.from(document.querySelectorAll('.onboarding-showcase-preview-slide'))
        .find(slide => slide.dataset.featureId === featureId);
      if (!feature || !selectedTab || !selectedSlide) return;

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const preview = document.getElementById('onboardingFeaturePreview');
      preview.setAttribute('aria-labelledby', selectedTab.id);

      document.querySelectorAll('.onboarding-feature-tab').forEach(tab => {
        const selected = tab === selectedTab;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });

      document.querySelectorAll('.onboarding-showcase-preview-slide').forEach(slide => {
        slide.classList.toggle('is-active', slide === selectedSlide);
      });

      const tabStrip = selectedTab.parentElement;
      const tabBounds = selectedTab.getBoundingClientRect();
      const stripBounds = tabStrip.getBoundingClientRect();
      const behavior = reducedMotion ? 'auto' : 'smooth';
      if (tabBounds.left < stripBounds.left) {
        tabStrip.scrollBy({ left: tabBounds.left - stripBounds.left, behavior });
      } else if (tabBounds.right > stripBounds.right) {
        tabStrip.scrollBy({ left: tabBounds.right - stripBounds.right, behavior });
      }
    }

    function showNextOnboardingFeature() {
      const activeTab = document.querySelector('.onboarding-feature-tab[aria-selected="true"]');
      const currentIndex = ONBOARDING_FEATURES.findIndex(feature => activeTab?.id === `onboardingFeatureTab-${feature.id}`);
      const nextFeature = ONBOARDING_FEATURES[(currentIndex + 1) % ONBOARDING_FEATURES.length];

      selectOnboardingFeature(nextFeature.id);
    }

    function stopOnboardingFeatureAutoPlay() {
      if (featurePreviewTimer) window.clearInterval(featurePreviewTimer);
      featurePreviewTimer = null;
      featurePreviewAutoPlayStopped = true;
    }

    function startOnboardingFeatureAutoPlay() {
      if (featurePreviewAutoPlayStopped || featurePreviewTimer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      featurePreviewTimer = window.setInterval(showNextOnboardingFeature, FEATURE_PREVIEW_INTERVAL);
    }

    function initOnboardingFeatureAutoPlay() {
      const featureTabs = document.querySelector('.onboarding-feature-tabs');
      featureTabs?.addEventListener('pointerdown', stopOnboardingFeatureAutoPlay);
      featureTabs?.addEventListener('focusin', stopOnboardingFeatureAutoPlay);
      window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
        if (event.matches) stopOnboardingFeatureAutoPlay();
      });
      startOnboardingFeatureAutoPlay();
    }

    function handleOnboardingFeatureTabKeydown(event) {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;

      event.preventDefault();
      const tabs = Array.from(document.querySelectorAll('.onboarding-feature-tab'));
      const currentIndex = tabs.indexOf(event.currentTarget);
      let nextIndex = currentIndex;

      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;

      const nextTab = tabs[nextIndex];
      nextTab.focus();
      selectOnboardingFeature(nextTab.id.replace('onboardingFeatureTab-', ''));
    }

    function initOnboardingReveal() {
      const revealItems = document.querySelectorAll('.onboarding-reveal');
      if (!revealItems.length) return;

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion || !('IntersectionObserver' in window)) {
        revealItems.forEach(item => item.classList.add('is-visible'));
        return;
      }

      document.body.classList.add('onboarding-reveal-ready');
      const revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        });
      }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

      revealItems.forEach(item => revealObserver.observe(item));
    }

    function populateSchoolLevels() {
      const options = document.getElementById('schoolLevelOptions');
      options.innerHTML = SCHOOL_LEVELS.map(level => `
        <label class="onboarding-level-option">
          <input type="checkbox" name="schoolLevels" value="${level.value}">
          <span>${level.label}</span>
        </label>`).join('');
      options.addEventListener('change', () => {
        document.getElementById('schoolLevelsError').hidden = options.querySelectorAll('input:checked').length > 0;
        captureAcademicTermDrafts();
        renderAcademicTermConfigurations();
      });
    }

    function selectedSchoolLevels() {
      const selected = new Set(Array.from(document.querySelectorAll('#schoolLevelOptions input:checked')).map(input => input.value));
      return SCHOOL_LEVELS.map(level => level.value).filter(level => selected.has(level));
    }

    let registrationResubmitMode = false;
    let registrationDetailsLoaded = false;

    try {
      registrationResubmitMode = sessionStorage.getItem('edugnay_registration_resubmit_mode') === 'true';
    } catch {}

    function validateSavedRegistrationDetails(application) {
      const school = application?.school;
      const administrator = application?.initialAdministrator;
      const schoolLevels = application?.schoolLevels;
      const termConfigs = application?.academicTermConfigs;
      const periodCounts = { quarterly: 4, three_term: 3, semester: 2 };
      const validLevels = new Set(SCHOOL_LEVELS.map(level => level.value));
      const validDate = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      };
      const incompleteError = () => {
        const error = new Error('The saved application is incomplete. Contact Platform Admin for help; do not register again.');
        error.retryable = false;
        return error;
      };

      if (!school || !String(school.name || '').trim() || !String(school.email || '').trim()
        || !String(school.schoolEmailDomain || '').trim()
        || !String(application.notificationEmail || '').trim()
        || !String(administrator?.firstName || '').trim()
        || !String(administrator?.lastName || '').trim()
        || !String(application.administratorSchoolEmail || '').trim()
        || !String(application.currentSchoolYearLabel || '').trim()
        || !validDate(application.schoolYearStartDate)
        || !validDate(application.schoolYearEndDate)
        || application.schoolYearStartDate >= application.schoolYearEndDate
        || !Array.isArray(schoolLevels) || !schoolLevels.length
        || schoolLevels.some(level => !validLevels.has(level))
        || !Array.isArray(termConfigs) || termConfigs.length !== schoolLevels.length) {
        throw incompleteError();
      }

      const seenLevels = new Set();
      for (const config of termConfigs) {
        const expectedPeriods = periodCounts[config?.gradingPeriodType];
        if (!config || !schoolLevels.includes(config.schoolLevel) || seenLevels.has(config.schoolLevel)
          || !expectedPeriods || !Array.isArray(config.academicPeriods)
          || config.academicPeriods.length !== expectedPeriods
          || config.academicPeriods.some(period => !String(period?.name || '').trim()
            || !validDate(period.plannedStartDate) || !validDate(period.plannedEndDate))) {
          throw incompleteError();
        }
        seenLevels.add(config.schoolLevel);
      }

      if (seenLevels.size !== schoolLevels.length) {
        throw incompleteError();
      }
      return true;
    }

    async function loadRejectedRegistration() {
      const form = document.getElementById('schoolOnboardingForm');
      const fields = document.getElementById('registrationFormFields');
      const error = document.getElementById('registrationLoadError');
      const retry = document.getElementById('registrationLoadRetry');
      const notice = document.getElementById('registrationResubmitNotice');
      const submit = document.getElementById('schoolOnboardingSubmit');
      registrationDetailsLoaded = false;
      fields.hidden = true;
      error.hidden = true;
      retry.hidden = true;
      notice.hidden = true;
      submit.disabled = true;
      form.setAttribute('aria-busy', 'true');
      try {
        let token = '';
        try { token = sessionStorage.getItem('edugnay_registration_status_token') || ''; }
        catch {
          const tokenError = new Error('This browser could not open the saved application. Contact Platform Admin for help. Please do not submit again.');
          tokenError.retryable = false;
          throw tokenError;
        }
        if (!token) {
          const tokenError = new Error('This browser does not have the saved application. If you already submitted, contact Platform Admin for help. Please do not submit again.');
          tokenError.retryable = false;
          throw tokenError;
        }
        let application;
        try {
          application = await window.EDUGNAY_API.getRegistrationDetails(token);
        } catch (requestError) {
          if (requestError?.status === 404) {
            const tokenError = new Error('This saved application link is missing or has expired. If you already submitted, contact Platform Admin for help. Please do not submit again.');
            tokenError.retryable = false;
            throw tokenError;
          }
          if (requestError?.status === 409) {
            const statusError = new Error('This application is no longer eligible for revision. Contact Platform Admin for help.');
            statusError.retryable = false;
            throw statusError;
          }
          throw requestError;
        }
        validateSavedRegistrationDetails(application);

        const school = application.school;
        const values = {
          schoolName: school.name,
          schoolId: school.depedSchoolId ?? '',
          schoolAddress: school.addressLine ?? '',
          schoolEmail: school.email,
          schoolPhone: school.phone ?? '',
          schoolWebsite: school.website ?? '',
          notificationEmail: application.notificationEmail,
          adminName: [application.initialAdministrator?.firstName, application.initialAdministrator?.lastName].filter(Boolean).join(' '),
          schoolYear: application.currentSchoolYearLabel,
          schoolYearStartDate: application.schoolYearStartDate,
          schoolYearEndDate: application.schoolYearEndDate
        };
        Object.entries(values).forEach(([id, value]) => { document.getElementById(id).value = value; });
        const adminPasswordInput = document.getElementById('adminPassword');
        adminPasswordInput.value = '';
        window.EDUGNAY_PASSWORD_TOGGLE?.hide(adminPasswordInput);
        document.getElementById('schoolLogo').value = '';
        document.getElementById('schoolLogoHelp').textContent = 'The current logo will be kept unless you choose a replacement.';
        document.querySelectorAll('#schoolLevelOptions input').forEach(input => {
          input.checked = application.schoolLevels.includes(input.value);
        });
        Object.keys(termDrafts).forEach(level => delete termDrafts[level]);
        (application.academicTermConfigs || []).forEach(config => {
          termDrafts[config.schoolLevel] = {
            gradingPeriodType: config.gradingPeriodType,
            academicPeriods: config.academicPeriods || []
          };
        });
        document.getElementById('schoolLevelsError').hidden = application.schoolLevels.length > 0;
        renderAcademicTermConfigurations();
        document.getElementById('schoolRegistrationTitle').textContent = 'Revise your school registration';
        document.getElementById('schoolRegistrationDescription').textContent = 'Update the saved application and resubmit it to Platform Admin. Your existing school record will be retained.';
        document.querySelector('.onboarding-form-title').textContent = 'Revise registration details';
        document.getElementById('resubmitAdministratorLogin').textContent = application.administratorSchoolEmail || 'unchanged';
        document.querySelector('label[for="adminPassword"]').textContent = 'New temporary password';
        document.getElementById('adminPasswordHelp').textContent = 'A new password is required because the previous administrator account remains inactive.';
        submit.textContent = 'Resubmit application';
        document.getElementById('registrationResubmitNotice').hidden = false;
        registrationDetailsLoaded = true;
        fields.hidden = false;
        form.removeAttribute('aria-busy');
        submit.disabled = false;
      } catch (loadError) {
        form.removeAttribute('aria-busy');
        const terminalError = loadError?.retryable === false;
        error.textContent = terminalError
          ? loadError.message
          : loadError?.message || 'Saved application details could not be loaded. Check your connection and retry.';
        error.hidden = false;
        retry.hidden = terminalError;
        submit.disabled = true;
      }
    }

    let schoolLogoData = '';

    function readSchoolLogo(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('The school logo could not be read.'));
        reader.readAsDataURL(file);
      });
    }

    function captureAcademicTermDrafts() {
      document.querySelectorAll('[data-term-level]').forEach(card => {
        termDrafts[card.dataset.termLevel] = {
          gradingPeriodType: card.querySelector('[data-period-type]')?.value || 'quarterly',
          academicPeriods: Array.from(card.querySelectorAll('[data-period-row]')).map(row => ({
            name: row.querySelector('[data-period-name]').value,
            plannedStartDate: row.querySelector('[data-period-start]').value,
            plannedEndDate: row.querySelector('[data-period-end]').value
          }))
        };
      });
    }

    function renderAcademicTermConfigurations() {
      const container = document.getElementById('academicTermConfigurations');
      const levels = selectedSchoolLevels();
      Object.keys(termDrafts).forEach(level => {
        if (!levels.includes(level)) delete termDrafts[level];
      });
      if (!levels.length) {
        container.innerHTML = '<p class="onboarding-term-empty">Select the school levels above to configure their grading periods.</p>';
        return;
      }

      container.innerHTML = levels.map(level => {
        const levelInfo = SCHOOL_LEVELS.find(item => item.value === level);
        const draft = termDrafts[level] || {
          gradingPeriodType: level === 'shs' ? 'semester' : 'quarterly',
          academicPeriods: []
        };
        const periods = window.EDUGNAY_CONFIG.createAcademicPeriods(draft.gradingPeriodType, draft.academicPeriods);
        termDrafts[level] = {
          gradingPeriodType: draft.gradingPeriodType,
          academicPeriods: periods.map(period => ({
            name: period.name,
            plannedStartDate: period.plannedStartDate,
            plannedEndDate: period.plannedEndDate
          }))
        };
        const typeOptions = Object.values(window.EDUGNAY_CONFIG.academicPeriodTypes).map(type =>
          `<option value="${type.id}" ${type.id === draft.gradingPeriodType ? 'selected' : ''}>${type.label}</option>`
        ).join('');

        return `<section class="onboarding-term-card" data-term-level="${level}">
          <div class="onboarding-term-head">
            <h4>${levelInfo?.label || level}</h4>
            <div class="onboarding-field onboarding-term-type">
              <label for="periodType-${level}">Period structure</label>
              <select id="periodType-${level}" data-period-type>${typeOptions}</select>
            </div>
          </div>
          <div class="onboarding-period-list">
            ${periods.map(period => `<div class="onboarding-period-row" data-period-row>
              <div class="onboarding-field onboarding-period-name">
                <label>Grading period</label>
                <input data-period-name value="${period.name}" readonly />
              </div>
              <div class="onboarding-field academic-range-group" data-academic-range>
                <label>Date range</label>
                <div class="academic-range-native-pair">
                  <label>Start date<input data-period-start type="date" value="${period.plannedStartDate || ''}" required /></label>
                  <label>End date<input data-period-end type="date" value="${period.plannedEndDate || ''}" required /></label>
                </div>
              </div>
            </div>`).join('')}
          </div>
          <div class="onboarding-level-error" data-term-error role="alert" hidden></div>
        </section>`;
      }).join('');

      container.querySelectorAll('[data-period-type]').forEach(select => select.addEventListener('change', () => {
        const level = select.closest('[data-term-level]').dataset.termLevel;
        termDrafts[level] = { gradingPeriodType: select.value, academicPeriods: [] };
        renderAcademicTermConfigurations();
      }));
      window.initAcademicRangePickers?.(container, {
        rowSelector: '[data-period-row]',
        startSelector: '[data-period-start]',
        endSelector: '[data-period-end]',
        nameSelector: '[data-period-name]',
        yearStartSelector: '#schoolYearStartDate',
        yearEndSelector: '#schoolYearEndDate'
      });
    }

    function collectAcademicTermConfigs(values) {
      return Array.from(document.querySelectorAll('[data-term-level]')).map(card => ({
        schoolLevel: card.dataset.termLevel,
        schoolYear: values.schoolYear.trim(),
        schoolYearStartDate: values.schoolYearStartDate,
        schoolYearEndDate: values.schoolYearEndDate,
        gradingPeriodType: card.querySelector('[data-period-type]').value,
        academicPeriods: Array.from(card.querySelectorAll('[data-period-row]')).map((row, index) => ({
          name: row.querySelector('[data-period-name]').value,
          sequence: index + 1,
          plannedStartDate: row.querySelector('[data-period-start]').value,
          plannedEndDate: row.querySelector('[data-period-end]').value
        }))
      }));
    }

    function validateAcademicTermConfigs(configs) {
      let firstError = '';
      document.querySelectorAll('[data-term-error]').forEach(error => { error.hidden = true; error.textContent = ''; });
      configs.forEach(config => {
        const errors = window.EDUGNAY_CONFIG.validateAcademicTermConfig(config);
        const error = document.querySelector(`[data-term-level="${config.schoolLevel}"] [data-term-error]`);
        if (errors.length && error) {
          error.textContent = errors[0];
          error.hidden = false;
          if (!firstError) firstError = errors[0];
        }
      });
      const error = document.getElementById('academicTermsError');
      error.textContent = firstError;
      error.hidden = !firstError;
      return !firstError;
    }

    async function previewSchoolLogo(event) {
      const file = event.target.files?.[0];
      const placeholder = document.getElementById('schoolLogoPlaceholder');
      const preview = document.getElementById('schoolLogoPreviewImage');
      schoolLogoData = '';
      if (!file) {
        preview.hidden = true;
        preview.removeAttribute('src');
        placeholder.hidden = false;
        return;
      }
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
        event.target.value = '';
        showAppToast('Choose a PNG, JPEG, or WebP logo no larger than 2 MB.', 'error');
        preview.hidden = true;
        preview.removeAttribute('src');
        placeholder.hidden = false;
        return;
      }

      try {
        schoolLogoData = await readSchoolLogo(file);
        preview.src = schoolLogoData;
        preview.alt = `${file.name} preview`;
        preview.hidden = false;
        placeholder.hidden = true;
      } catch {
        event.target.value = '';
        preview.hidden = true;
        preview.removeAttribute('src');
        placeholder.hidden = false;
      }
    }

    async function submitSchoolOnboarding(event) {
      event.preventDefault();
      if (registrationResubmitMode && !registrationDetailsLoaded) return;
      const form = event.target;
      const values = Object.fromEntries(new FormData(form).entries());
      const temporaryPassword = values.adminPassword;
      const notificationEmail = values.notificationEmail.trim().toLowerCase();
      const schoolEmail = values.schoolEmail.trim().toLowerCase();
      const schoolLevels = selectedSchoolLevels();
      if (!schoolLevels.length) {
        document.getElementById('schoolLevelsError').hidden = false;
        document.querySelector('#schoolLevelOptions input')?.focus();
        return;
      }
      const academicTermConfigs = collectAcademicTermConfigs(values);
      if (!validateAcademicTermConfigs(academicTermConfigs)) {
        document.querySelector('[data-term-error]:not([hidden])')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const adminNames = values.adminName.trim().split(/\s+/);
      if (adminNames.length < 2) {
        showAppToast('Enter the administrator’s first and last name.', 'error');
        document.getElementById('adminName').focus();
        return;
      }
      const registration = {
        name: values.schoolName.trim(),
        shortName: values.schoolName.trim().toUpperCase(),
        schoolType: window.EDUGNAY_CONFIG.getSchoolTypeInfo(schoolLevels).value,
        depedSchoolId: values.schoolId.trim() || null,
        addressLine: values.schoolAddress.trim() || null,
        phone: values.schoolPhone.trim() || null,
        email: schoolEmail,
        notificationEmail,
        website: values.schoolWebsite.trim() || null,
        currentSchoolYearLabel: values.schoolYear.trim(),
        schoolYearStartDate: values.schoolYearStartDate,
        schoolYearEndDate: values.schoolYearEndDate,
        schoolLevels,
        academicTermConfigs,
        initialAdministrator: {
          firstName: adminNames[0],
          lastName: adminNames.slice(1).join(' '),
          temporaryPassword
        }
      };

      const logoInput = document.getElementById('schoolLogo');
      const submitButton = form.querySelector('[type="submit"]');
      const submitLabel = submitButton.innerHTML;
      submitButton.disabled = true;
      submitButton.textContent = registrationResubmitMode ? 'Resubmitting application...' : 'Creating profile...';

      try {
        const registrationToken = registrationResubmitMode
          ? sessionStorage.getItem('edugnay_registration_status_token')
          : '';
        const createdSchool = registrationResubmitMode
          ? await window.EDUGNAY_API.resubmitSchool(registrationToken, registration, logoInput.files?.[0])
          : await window.EDUGNAY_API.registerSchool(registration, logoInput.files?.[0]);
        if (!createdSchool) throw new Error('The school registration could not be saved.');

        try {
          sessionStorage.removeItem('edugnay_pending_registration');
          sessionStorage.removeItem('edugnay_registration_resubmit_mode');
          if (createdSchool.registrationStatusToken) {
            sessionStorage.setItem('edugnay_registration_status_token', createdSchool.registrationStatusToken);
          }
        } catch (storageError) {
          // The registration has already been saved; the status page will explain if the token could not be retained.
        }
        window.location.href = './edugnay-registration-pending.html';
      } catch (error) {
        submitButton.disabled = false;
        submitButton.innerHTML = submitLabel;
        if (window.lucide) lucide.createIcons();
        showAppToast(error?.message || (registrationResubmitMode
          ? 'The school registration could not be resubmitted.'
          : 'The school registration could not be created.'), 'error');
      }
    }

    document.addEventListener('DOMContentLoaded', async () => {
      initOnboardingReveal();
      renderOnboardingFeaturePreviews();
      selectOnboardingFeature('school-management');
      initOnboardingFeatureAutoPlay();
      populateSchoolLevels();
      renderAcademicTermConfigurations();
      document.getElementById('schoolLogo').addEventListener('change', previewSchoolLogo);
      document.getElementById('registrationLoadRetry').addEventListener('click', loadRejectedRegistration);
      if (registrationResubmitMode) await loadRejectedRegistration();
      if (window.lucide) lucide.createIcons();
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p03f5081a160b: function(event) { selectOnboardingFeature('student-progress') },
    pb1446c1a4826: function(event) { selectOnboardingFeature('teaching-tools') },
    pc231d3166b06: function(event) { selectOnboardingFeature('school-forms') },
    pc344d390890b: function(event) { selectOnboardingFeature('school-management') },
    pcb4e71c00da7: function(event) { selectOnboardingFeature('ai-reports') },
  },
  keydown: {
    p0bba843ae91b: function(event) { handleOnboardingFeatureTabKeydown(event) },
  },
  submit: {
    p373fe32a57f4: function(event) { submitSchoolOnboarding(event) },
  },
});
