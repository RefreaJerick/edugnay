(() => {
  const api = () => window.EDUGNAY_API;
  const escapeHtml = value => window.EDUGNAY_CONFIG.escapeHtml(String(value ?? ''));
  const toast = (message, type = 'success') => window.showAppToast?.(message, type);
  const versions = new WeakMap();

  function setVisible(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    element.style.display = visible ? '' : 'none';
  }

  function categoryCode(item) {
    const value = String(item.componentCode || item.componentType || item.categoryCode || item.code || '').toLowerCase();
    if (value.includes('written')) return 'WW';
    if (value.includes('performance')) return 'PT';
    if (value.includes('exam')) return 'QA';
    return value.toUpperCase();
  }

  function publishedGradeFor(data, studentId) {
    return data.published.find(row => String(row.studentId) === String(studentId));
  }

  function scoreFor(data, studentId, itemId) {
    return data.scores.find(row => String(row.studentId) === String(studentId)
      && String(row.gradingItemId) === String(itemId));
  }

  function setFeedback(host, message, isError = false) {
    const status = host.querySelector('#scoreSaveStatus');
    if (!status) return;
    status.textContent = message;
    status.setAttribute('role', isError ? 'alert' : 'status');
  }

  function configureAddAssessmentModal(data, scope, writable, reload) {
    const modal = document.getElementById('addCompModal');
    const body = modal.querySelector('.modal-body');
    const save = modal.querySelector('#addScoreComponentSubmit');
    const components = data.scope.policy?.components || [];
    const choices = body.querySelector('#compTypeOpts');
    const titleInput = body.querySelector('#compNameInput');
    const maxInput = body.querySelector('#compMaxInput');
    const examGroup = body.querySelector('#scoreExamPartGroup');
    const examSelect = body.querySelector('#scoreExamPartInput');
    const presentation = {
      WW: { css: 'cat-ww', icon: 'pencil' },
      PT: { css: 'cat-pt', icon: 'target' },
      QA: { css: 'cat-qa', icon: 'clipboard-list' }
    };

    window.TeacherClassViews.renderComponentChoices(choices, components.map(component => {
      const category = categoryCode(component);
      const style = presentation[category] || { css: '', icon: 'clipboard-list' };
      return { code: component.code, categoryCode: category, name: component.name,
        weight: component.weight, css: style.css, icon: style.icon };
    }));

    titleInput.value = '';
    titleInput.readOnly = false;
    titleInput.placeholder = 'e.g. ' + (components[0]?.name || 'Assessment') + ' 1';
    titleInput.maxLength = 255;
    maxInput.value = '';
    maxInput.min = '0.01';
    maxInput.max = '1000000';
    maxInput.step = '0.01';

    const updateExamParts = component => {
      const parts = Object.entries(component?.examParts || {});
      examGroup.hidden = !parts.length;
      examSelect.required = Boolean(parts.length);
      examSelect.innerHTML = parts.map(([code, value]) => '<option value="' + escapeHtml(code) + '">' +
        escapeHtml(value && typeof value === 'object' ? value.name || code : code.replaceAll('_', ' ')) + '</option>').join('');
    };
    updateExamParts(components[0]);
    choices.onclick = event => {
      const button = event.target.closest('[data-component-code]');
      if (!button || !choices.contains(button)) return;
      choices.querySelectorAll('[data-component-code]').forEach(option => {
        const selected = option === button;
        option.classList.toggle('selected', selected);
        option.setAttribute('aria-pressed', String(selected));
      });
      const selected = components.find(component => String(component.code) === button.dataset.componentCode);
      titleInput.placeholder = 'e.g. ' + (selected?.name || 'Assessment') + ' 1';
      updateExamParts(selected);
    };
    save.disabled = !writable || !components.length;
    save.onclick = async event => {
      event.preventDefault();
      const selectedButton = choices.querySelector('[data-component-code].selected');
      if (!titleInput.reportValidity() || !maxInput.reportValidity() || !selectedButton) return;
      const selectedComponent = components.find(component => String(component.code) === selectedButton.dataset.componentCode);
      if (!selectedComponent) return;
      const values = {
        ...scope,
        academicTermId: data.term.id,
        title: titleInput.value.trim(),
        componentCode: selectedComponent.code,
        examPartCode: examGroup.hidden ? null : examSelect.value,
        maxScore: maxInput.value
      };
      save.disabled = true;
      try {
        await api().createShsGradingItem(values);
        window.closeModal('addCompModal');
        toast('Score component added.');
        await reload(data.term.id);
      } catch (error) {
        toast(error.message || 'Score component could not be added.', 'error');
        save.disabled = false;
      }
    };
    window.lucide?.createIcons();
  }

  function renderCategoryTabs(host, components, onChange) {
    const tabs = host.querySelector('.cat-tabs');
    const categories = components.map(component => ({
      code: categoryCode(component), name: component.name, weight: Number(component.weight)
    })).filter((item, index, all) => item.code && all.findIndex(other => other.code === item.code) === index);
    window.TeacherClassViews.renderScoreCategories(tabs, categories, onChange);
  }

  function applyFilters(host, category) {
    window.TeacherClassViews.filterScores(host, category);
  }

  function renderTable(host, data, scope, writable, reload) {
    const policy = data.scope.policy;
    const items = (data.items || []).map(item => {
      const category = data.scope.policy?.components?.find(component => component.code === item.componentCode || categoryCode(component) === categoryCode(item));
      return {
        id: item.id,
        gradingItemId: item.id,
        title: item.title,
        maxScore: item.maxScore,
        categoryCode: categoryCode(item),
        categoryName: category?.name || item.componentCode || 'Assessment',
        examPartId: item.examPartId || '',
        examPartName: item.examPartCode ? String(item.examPartCode).replaceAll('_', ' ') : '',
        correctionRequired: Boolean(item.usedInPublishedGrades)
      };
    });
    window.TeacherClassViews.renderScoreTable({
      host,
      items,
      students: data.students || [],
      metricHeaders: [
        ...(policy?.components || []).map(component => ({
          label: `${({ WW: 'WW', PT: 'PT', QA: 'Exams' })[categoryCode(component)] || component.name} Avg`,
          title: `${component.name}: ${Number(component.weight) || 0}% of the final grade`,
          style: 'min-width:80px;background:#f0f4ff;'
        })),
        { label: 'Final Grade', title: 'Calculated final grade based on current scores.', style: 'min-width:148px;background:var(--navy);color:var(--gold);' }
      ],
      getScore: (student, item) => {
        const record = scoreFor(data, student.studentId || student.id, item.id);
        return { score: record?.score ?? null, correctionRequired: Boolean(data.items.find(row => String(row.id) === String(item.id))?.usedInPublishedGrades) };
      },
      getMetrics: student => {
        const published = publishedGradeFor(data, student.studentId || student.id);
        return [
          ...(policy?.components || []).map(component => ({
            value: student.componentAverages?.[component.code] ?? null,
            className: 'computed-cell computed-avg',
            style: 'background:#f8faff;'
          })),
          {
            value: student.termGrade ?? (published ? Number(published.finalGrade) : null),
            detail: published ? 'Published v' + Number(published.publicationVersion) : '',
            className: 'computed-cell computed-final',
            style: 'background:var(--blue-xpale);'
          }
        ];
      },
      writable,
      onScoreInput: input => saveScore(input, data, scope, writable, reload),
      empty: {
        noItems: data.scope.policy ? undefined
          : { icon: 'triangle-alert', title: 'Grading rules unavailable', text: data.scope.policyBlockReason || 'Ask the school administrator to review the grading setup.' }
      }
    });
  }

  async function saveScore(input, data, scope, writable, reload) {
    if (!writable) return;
    const itemId = input.dataset.scoreItem;
    const studentId = input.dataset.studentId;
    const item = data.items.find(row => String(row.id) === String(itemId));
    if (!item) return;
    const values = { ...scope, academicTermId: data.term.id, gradingItemId: itemId, studentId, score: input.value };
    const correctionReason = input.parentElement.querySelector('[data-correction-reason]')?.value.trim() || '';
    if (item.usedInPublishedGrades && correctionReason.length < 10) {
      toast('Enter a correction reason of at least 10 characters.', 'error');
      input.parentElement.querySelector('[data-correction-reason]')?.focus();
      return;
    }
    input.disabled = true;
    try {
      if (item.usedInPublishedGrades) {
        await api().correctShsScore({ ...values, reason: correctionReason });
        toast('Score correction recorded. Republish grades to update the published result.');
      } else {
        await api().saveShsScore(values);
        toast('Score saved.');
      }
      await reload(data.term.id);
    } catch (error) {
      toast(error.message || 'Score could not be saved.', 'error');
      input.disabled = false;
      input.focus();
    }
  }

  function setPublishPreview(preview, data, scope, writable, publishAction, reload) {
    const modal = document.getElementById('publishModal');
    modal.querySelector('.modal-title').textContent = publishAction ? 'Review grades' : 'Grade preview';
    modal.querySelector('.modal-sub').textContent = data.term.name + ' · ' + (data.scope.className || data.scope.subjectName || 'This class');
    const warning = document.getElementById('publishGradeWarning');
    const problems = preview.preview.students.filter(row => row.problem);
    warning.hidden = !problems.length;
    document.getElementById('publishGradeWarningText').textContent = problems.length
      ? problems.map(row => row.studentName + ': ' + row.problem).join(' ') : '';
    document.getElementById('publishGradeSummary').innerHTML = escapeHtml(preview.preview.students.length + ' students · ' +
      (problems.length ? problems.length + ' need attention.' : 'Grades are ready to review.')) +
      (data.published.length && publishAction ? '<div class="form-group"><label class="form-label" for="shs-republish-reason">Reason for republishing<input class="form-input" id="shs-republish-reason" type="text" minlength="10" maxlength="500" placeholder="Explain why published grades are changing"></label></div>' : '');
    const method = document.getElementById('publishGradeMethodNote');
    method.hidden = false;
    document.getElementById('publishGradeMethodText').textContent = data.scope.policy?.method === 'adjusted_2026'
      ? 'The 2026–2027 adjusted conversion is used to calculate reported grades.'
      : 'Grades use the verified weighted calculation for this class.';
    const list = document.getElementById('publishPreviewStudentList');
    list.hidden = false;
    window.TeacherClassViews.renderGradePreviewRows(list, preview.preview.students.map(row => {
      const hasGrade = row.termGrade !== null && row.termGrade !== undefined && Number.isFinite(Number(row.termGrade));
      const grade = hasGrade ? Number(row.termGrade) : null;
      return {
        name: row.studentName || 'Student',
        value: row.problem || (hasGrade ? String(grade) : 'Incomplete'),
        tone: row.problem || !hasGrade ? 'grade-warn' : grade >= 75 ? 'grade-pass' : 'grade-fail',
        ariaLabel: row.problem ? `${row.studentName || 'Student'}: ${row.problem}`
          : hasGrade ? `Final grade ${grade}.` : 'Grade incomplete.'
      };
    }));
    document.getElementById('publishGradeFeedback').hidden = true;
    const confirm = document.getElementById('publishGradesConfirmButton');
    confirm.textContent = 'Publish grades';
    confirm.hidden = !publishAction;
    const ready = Boolean(preview.preview.students.length && !problems.length && preview.preview.term?.status === 'active');
    confirm.disabled = !publishAction || !writable || !ready;
    confirm.onclick = () => publish(data, scope, writable, reload, ready);
    setVisible(modal, true);
    window.openModal('publishModal');
    window.lucide?.createIcons();
  }

  async function openPublishPreview(data, scope, writable, reload) {
    const modal = document.getElementById('publishModal');
    modal.querySelector('.modal-title').textContent = 'Grade preview';
    document.getElementById('publishGradeWarning').hidden = true;
    document.getElementById('publishGradeSummary').textContent = 'Loading grade preview...';
    document.getElementById('publishGradeMethodNote').hidden = true;
    document.getElementById('publishPreviewStudentList').hidden = true;
    document.getElementById('publishGradesConfirmButton').hidden = true;
    window.openModal('publishModal');
    try {
      const preview = await api().previewShsGrades({ ...scope, academicTermId: data.term.id });
      setPublishPreview(preview, data, scope, writable, true, reload);
    } catch (error) {
      document.getElementById('publishGradeSummary').textContent = error.message || 'The grade preview could not be loaded.';
    }
  }

  async function publish(data, scope, writable, reload, ready) {
    const confirm = document.getElementById('publishGradesConfirmButton');
    const correctionReason = document.getElementById('shs-republish-reason')?.value.trim() || '';
    if (!writable || !ready) return;
    if (data.published.length && correctionReason.length < 10) {
      toast('Enter a reason of at least 10 characters before republishing.', 'error');
      document.getElementById('shs-republish-reason')?.focus();
      return;
    }
    confirm.disabled = true;
    try {
      await api().publishShsGrades({ ...scope, academicTermId: data.term.id, correctionReason });
      window.closeModal('publishModal');
      toast(data.published.length ? 'Grades republished. Previous versions remain in the history.' : 'Grades published.');
      await reload(data.term.id);
    } catch (error) {
      toast(error.message || 'Grades could not be published.', 'error');
      confirm.disabled = false;
    }
  }

  function render(host, data, scope, reload) {
    const policy = data.scope.policy;
    const term = data.term;
    const items = data.items || [];
    const students = data.students || [];
    const writable = Boolean(policy && term?.status === 'active' && data.scope.yearStatus === 'active'
      && (data.scope.kind !== 'elective' || (data.scope.classActive && data.scope.offeringActive && data.scope.teacherStatus === 'active')));
    const title = host.querySelector('#scorePanelTitle');
    const subject = host.querySelector('#scoreSectionName');
    const weights = host.querySelector('#scorePanelWeights');
    title.textContent = 'Score Recording: ' + (data.scope.subjectName || data.scope.className || 'Class');
    subject.textContent = [data.scope.className, data.scope.yearLabel]
      .filter(Boolean).join(' · ');
    weights.textContent = policy ? policy.components.map(component => component.name + ' ' + Number(component.weight) + '%').join(' · ') : 'Grading rule unavailable';
    const periodName = host.querySelector('#scorePanelPeriodName');
    periodName.textContent = term?.name || 'No grading period';
    const periodSelect = host.querySelector('#academicPeriodSelect');
    periodSelect.onchange = null;
    periodSelect.innerHTML = data.terms.length ? data.terms.map(row => '<option value="' + escapeHtml(row.id) + '" ' +
      (String(row.id) === String(term?.id) ? 'selected' : '') + '>' + escapeHtml(row.name) + (row.status === 'active' ? ' (Active)' : '') + '</option>').join('')
      : '<option value="">No grading periods available</option>';
    periodSelect.disabled = !data.terms.length;
    periodSelect.onchange = () => reload(periodSelect.value);
    const addButton = host.querySelector('#addScoreComponentButton');
    host.querySelector('#addScoreComponentLabel').textContent = 'Add Component';
    addButton.onclick = () => { configureAddAssessmentModal(data, scope, writable, reload); window.openModal('addCompModal'); };
    addButton.disabled = !writable || !policy?.components?.length;
    addButton.title = addButton.disabled ? 'Score Recording is read-only for this class or grading period.' : '';
    const publishButton = host.querySelector('#publishGradesButton');
    publishButton.onclick = () => openPublishPreview(data, scope, writable, reload);
    publishButton.disabled = !writable || !items.length || !students.length;
    const periodButton = host.querySelector('#fillPerfectScoresButton');
    setVisible(periodButton, false);
    const exportButton = host.querySelector('#exportScoresButton');
    setVisible(exportButton, false);
    const lockBanner = host.querySelector('#quarterLockBanner');
    const lockBadge = host.querySelector('#quarterLockBadge');
    const needsLockNotice = !writable;
    setVisible(lockBanner, needsLockNotice);
    setVisible(lockBadge, term?.status !== 'active');
    host.querySelector('#quarterLockTitle').textContent = policy ? 'Score Recording is read-only' : 'Grading rules need review';
    host.querySelector('#quarterLockDesc').textContent = !policy
      ? data.scope.policyBlockReason || 'A verified grading rule is not available for this class.'
      : data.scope.yearStatus !== 'active' ? 'This school year is closed. Grades are read-only.'
        : term?.status !== 'active' ? 'This grading period is closed. Scores are read-only.'
          : 'This class is paused or is not assigned to you for editing.';
    const publishedBanner = document.getElementById('publishedGradesBanner');
    setVisible(publishedBanner, data.published.length > 0);
    if (data.published.length) {
      document.getElementById('publishedPeriodName').textContent = term?.name || 'Grading period';
      document.getElementById('publishedPeriodStatus').textContent = 'Published grades for this class and grading period.';
      const republish = document.getElementById('republishGradesButton');
      setVisible(republish, writable);
      republish.onclick = () => openPublishPreview(data, scope, writable, reload);
    }
    renderCategoryTabs(host, policy?.components || [], category => applyFilters(host, category));
    const search = host.querySelector('#scoreStudentSearch');
    search.oninput = () => applyFilters(host, host.querySelector('.cat-tab.active')?.dataset.cat || 'all');
    search.value = '';
    renderTable(host, data, scope, writable, reload);
    if (data.scope.kind === 'core') {
      window.TeacherClassViews?.updateSectionHeaderFromGradebook?.(term?.id);
    } else if (data.scope.kind === 'elective') {
      window.AcademixElectiveClass?.updateHeaderGradeStatus?.(data);
    }
    const status = host.querySelector('#scoreSaveStatus');
    const hasScoreRows = Boolean(items.length && students.length);
    status.textContent = !hasScoreRows ? 'No scores to save'
      : writable ? 'Scores save when you leave a score field.' : 'Scores are read-only for this class or grading period.';
    const retry = host.querySelector('#scoreSaveRetry');
    retry.hidden = true;
    configureAddAssessmentModal(data, scope, writable, reload);
    window.lucide?.createIcons();
  }

  async function mount(host, initialScope) {
    close(host);
    let version = (versions.get(host) || 0) + 1;
    versions.set(host, version);
    let scope = { ...initialScope };
    const load = async termId => {
      version += 1;
      versions.set(host, version);
      const requestVersion = version;
      const addButton = host.querySelector('#addScoreComponentButton');
      const publishButton = host.querySelector('#publishGradesButton');
      const periodSelect = host.querySelector('#academicPeriodSelect');
      addButton.disabled = true;
      addButton.onclick = null;
      addButton.title = 'Loading Score Recording.';
      publishButton.disabled = true;
      publishButton.onclick = null;
      periodSelect.disabled = true;
      periodSelect.onchange = null;
      periodSelect.innerHTML = '<option value="">Loading grading periods…</option>';
      host.querySelector('#scorePanelWeights').textContent = '—';
      renderCategoryTabs(host, [], () => {});
      setVisible(host.querySelector('#fillPerfectScoresButton'), false);
      setVisible(host.querySelector('#exportScoresButton'), false);
      window.TeacherClassViews.renderScoreTable({
        host,
        empty: { noItems: { icon: 'loader-circle', title: 'Loading grades', text: 'Score records for this class are loading.' } }
      });
      try {
        const query = { ...scope };
        if (termId) query.academicTermId = termId;
        const activeScope = { ...scope };
        const data = await api().getShsGradeWorkspace(query);
        if (versions.get(host) !== requestVersion || !host.isConnected) return;
        scope = activeScope;
        render(host, data, activeScope, load);
      } catch (error) {
        if (versions.get(host) !== requestVersion || !host.isConnected) return;
        addButton.title = 'Score Recording is unavailable.';
        periodSelect.innerHTML = '<option value="">Grading period unavailable</option>';
        window.TeacherClassViews.renderScoreTable({
          host,
          empty: { noItems: { icon: 'triangle-alert', title: 'Gradebook unavailable', text: error.message || 'The gradebook could not be loaded.' } }
        });
        setFeedback(host, error.message || 'Gradebook unavailable.', true);
      }
    };
    await load(initialScope.academicTermId || '');
  }

  function close(host) {
    if (!host) return;
    versions.set(host, (versions.get(host) || 0) + 1);
    const modal = document.getElementById('addCompModal');
    if (modal?.classList.contains('open')) window.closeModal('addCompModal');
  }

  window.AcademixShsGradebook = { mount, close };
})();
