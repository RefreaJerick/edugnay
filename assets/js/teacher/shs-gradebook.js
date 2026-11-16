(() => {
  const api = () => window.EDUGNAY_API;
  const escapeHtml = value => window.EDUGNAY_CONFIG.escapeHtml(String(value ?? ''));
  const toast = (message, type = 'success') => window.showAppToast?.(message, type);
  const versions = new WeakMap();
  let activeContext = null;
  let pendingMount = null;
  let resultsVersion = 0;

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

  function shortCategoryName(component) {
    return { WW: 'WW', PT: 'PT', QA: 'Exams' }[categoryCode(component)] || component.name;
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
    const saveLabel = modal.querySelector('#addScoreComponentSubmitLabel');
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
    saveLabel.textContent = 'Add Component';
    let adding = false;
    save.onclick = async event => {
      event.preventDefault();
      if (adding || save.disabled) return;
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
      adding = true;
      save.disabled = true;
      saveLabel.textContent = 'Adding...';
      try {
        await api().createShsGradingItem(values);
        window.closeModal('addCompModal');
        const refreshed = await reload(data.term.id);
        toast(refreshed ? 'Score component added.' : 'Score component added, but Score Recording could not refresh.', refreshed ? 'success' : 'info');
      } catch (error) {
        toast(error.message || 'Score component could not be added.', 'error');
      } finally {
        adding = false;
        save.disabled = !writable || !components.length;
        saveLabel.textContent = 'Add Component';
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

  function exportScoresCsv(host, data) {
    const columns = [...host.querySelectorAll('#scoreTheadRow .comp-head-cell')].map(cell => {
      const category = cell.querySelector('.comp-head-type');
      return `${category.dataset.categoryName || category.textContent.trim()}: ${cell.querySelector('.comp-head-name').textContent} / ${cell.querySelector('.comp-head-max').textContent.replace('/', '').trim()}`;
    });
    const metrics = [...host.querySelectorAll('#scoreTheadRow .score-average-header')].map(cell => cell.textContent.trim());
    const rows = [['Student', ...columns, ...metrics, 'Final Grade'],
      ...[...host.querySelectorAll('#scoreTbody tr[data-student-id]')].filter(row => !row.hidden).map(row => [
        row.querySelector('.student-name').textContent,
        ...[...row.querySelectorAll('td[data-cat] .score-input')].map(input => input.value),
        ...[...row.querySelectorAll('.computed-cell')].map(cell => cell.textContent.trim() === '—' ? '' : cell.textContent.trim())
      ])];
    const csvCell = value => {
      let valueText = String(value ?? '');
      if (/^[\s\uFEFF]*[=+\-@]/.test(valueText)) valueText = `'${valueText}`;
      return `"${valueText.replace(/"/g, '""')}"`;
    };
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const filename = [data.scope.yearLabel, data.scope.className, data.scope.subjectName, data.term?.name]
      .filter(Boolean).join('-').replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 140) + '-scores.csv';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Score CSV download started.');
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
        categoryHeader: shortCategoryName(category || item),
        examPartId: item.examPartId || '',
        examPartName: (() => {
          if (!item.examPartCode) return '';
          const configured = category?.examParts?.[item.examPartCode];
          const name = (typeof configured === 'object' ? configured?.name : null)
            || String(item.examPartCode).replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
          return name.toLowerCase() === String(item.title).trim().toLowerCase() ? '' : name;
        })(),
        correctionRequired: Boolean(item.usedInPublishedGrades),
        canDelete: writable
      };
    });
    window.TeacherClassViews.renderScoreTable({
      host,
      items,
      students: data.students || [],
      metricHeaders: [
        ...(policy?.components || []).map(component => ({
          label: `${shortCategoryName(component)} Avg`,
          title: `${component.name}: ${Number(component.weight) || 0}% of the final grade`,
          className: 'score-average-header'
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
            className: 'computed-cell computed-avg'
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
      } else {
        await api().saveShsScore(values);
      }
      input.disabled = false;
      const request = ++resultsVersion;
      try {
        const fresh = await api().getShsGradeWorkspace({ ...scope, academicTermId: data.term.id });
        if (request !== resultsVersion || activeContext?.data !== data) return;
        data.scores = fresh.scores || [];
        data.students = fresh.students || [];
        data.published = fresh.published || [];
        const student = data.students.find(row => String(row.studentId || row.id) === String(studentId));
        const row = [...activeContext.host.querySelectorAll('#scoreTbody tr[data-student-id]')]
          .find(node => node.dataset.studentId === String(studentId));
        if (student && row) {
          const metrics = [...row.querySelectorAll('.computed-cell')];
          (data.scope.policy?.components || []).forEach((component, index) => {
            if (metrics[index]) metrics[index].textContent = student.componentAverages?.[component.code] ?? '—';
          });
          const final = metrics.at(-1);
          if (final) {
            const published = publishedGradeFor(data, studentId);
            final.textContent = student.termGrade ?? (published ? Number(published.finalGrade) : '—');
            if (published) {
              const detail = document.createElement('small');
              detail.textContent = 'Published v' + Number(published.publicationVersion);
              final.append(detail);
            }
          }
        }
        if (data.scope.kind === 'elective') window.AcademixElectiveClass?.updateHeaderGradeStatus?.(data);
        else window.TeacherClassViews?.updateSectionHeaderFromGradebook?.(data.term.id);
        setFeedback(activeContext.host, 'All changes saved');
        if (item.usedInPublishedGrades) {
          toast('Score correction recorded. Republish grades to update the published result.');
        }
      } catch {
        if (activeContext?.data === data) setFeedback(activeContext.host, 'Score saved. Calculated results could not refresh.', true);
        toast('Score saved, but calculated results could not refresh.', 'info');
      }
    } catch (error) {
      toast(error.message || 'Score could not be saved.', 'error');
      input.disabled = false;
      input.focus();
    }
  }

  function setPublishPreview(preview, data, scope, writable, publishAction, reload) {
    const modal = document.getElementById('publishModal');
    modal.querySelector('.modal-title').textContent = publishAction ? 'Publish Grades' : 'Grade preview';
    modal.querySelector('.modal-sub').textContent = 'Review the calculated grades before publishing.';
    const students = preview.preview.students;
    const problems = students.filter(row => row.problem);
    const ready = Boolean(students.length && !problems.length && preview.preview.term?.status === 'active');
    const warning = document.getElementById('publishGradeWarning');
    const sharedProblem = problems.length > 1 && problems.length === students.length
      && problems.every(row => row.problem === problems[0].problem) ? problems[0].problem : '';
    const messages = sharedProblem ? [sharedProblem]
      : problems.map(row => `${row.studentName || 'Student'}: ${row.problem}`);
    if (!students.length) messages.push('No students are enrolled in this class.');
    if (preview.preview.term?.status !== 'active') messages.push('Only an active term can be published.');
    warning.hidden = ready;
    document.getElementById('publishGradeWarningText').replaceChildren(...messages.map(message => {
      const item = document.createElement('li');
      item.textContent = message;
      return item;
    }));
    const className = data.scope.className || data.scope.subjectName || 'this class';
    const termName = data.term.name || 'this term';
    const count = students.length;
    document.getElementById('publishGradeSummary').innerHTML = escapeHtml(ready
      ? `Final grades for ${count} ${count === 1 ? 'student is' : 'students are'} ready to publish for ${termName} · ${className}.`
      : `Review the items below before publishing grades for ${count} ${count === 1 ? 'student' : 'students'} in ${termName} · ${className}.`) +
      (data.published.length && publishAction ? '<div class="form-group"><label class="form-label" for="shs-republish-reason">Reason for republishing<input class="form-input" id="shs-republish-reason" type="text" minlength="10" maxlength="500" placeholder="Explain why published grades are changing"></label></div>' : '');
    const method = document.getElementById('publishGradeMethodNote');
    method.hidden = false;
    document.getElementById('publishGradeMethodText').textContent = data.scope.policy?.method === 'adjusted_2026'
      ? 'The 2026–2027 adjusted conversion is used to calculate reported grades.'
      : data.scope.policy?.method === 'school_direct'
        ? `School-specific method: the weighted initial grade is reported directly. Rounding: ${{ round: 'nearest whole number', roundup: 'round up', truncate: 'truncate' }[data.scope.policy.gradeRounding] || 'nearest whole number'}. Passing grade: ${data.scope.policy.passingGradeThreshold}.`
        : 'Grades use the verified weighted calculation for this class.';
    const list = document.getElementById('publishPreviewStudentList');
    list.hidden = !students.length;
    window.TeacherClassViews.renderGradePreviewRows(list, students.map(row => {
      const hasGrade = row.termGrade !== null && row.termGrade !== undefined && Number.isFinite(Number(row.termGrade));
      const grade = hasGrade ? Number(row.termGrade) : null;
      return {
        name: row.studentName || 'Student',
        value: row.problem || !hasGrade ? 'Incomplete' : String(grade),
        tone: row.problem || !hasGrade ? 'grade-warn'
          : grade >= Number(data.scope.policy?.passingGradeThreshold ?? 75) ? 'grade-pass' : 'grade-fail',
        ariaLabel: row.problem ? `${row.studentName || 'Student'}: ${row.problem}`
          : hasGrade ? `Final grade ${grade}.` : 'Grade incomplete.'
      };
    }));
    document.getElementById('publishGradeFeedback').hidden = true;
    const confirm = document.getElementById('publishGradesConfirmButton');
    confirm.innerHTML = '<i data-lucide="send"></i> Publish Grades';
    confirm.hidden = !publishAction;
    confirm.disabled = !publishAction || !writable || !ready;
    confirm.onclick = () => publish(data, scope, writable, reload, ready);
    setVisible(modal, true);
    window.openModal('publishModal');
    window.lucide?.createIcons();
  }

  async function openPublishPreview(data, scope, writable, reload) {
    const modal = document.getElementById('publishModal');
    modal.querySelector('.modal-title').textContent = 'Publish Grades';
    modal.querySelector('.modal-sub').textContent = 'Review the calculated grades before publishing.';
    document.getElementById('publishGradeWarning').hidden = true;
    document.getElementById('publishGradeSummary').innerHTML = '';
    document.getElementById('publishGradeMethodNote').hidden = true;
    document.getElementById('publishPreviewStudentList').hidden = true;
    document.getElementById('publishGradesConfirmButton').hidden = true;
    const feedback = document.getElementById('publishGradeFeedback');
    feedback.hidden = true;
    feedback.classList.remove('error');
    feedback.setAttribute('role', 'status');
    window.openModal('publishModal');
    try {
      const preview = await api().previewShsGrades({ ...scope, academicTermId: data.term.id });
      setPublishPreview(preview, data, scope, writable, true, reload);
    } catch (error) {
      feedback.textContent = error.message || 'The grade preview could not be loaded.';
      feedback.classList.add('error');
      feedback.setAttribute('role', 'alert');
      feedback.hidden = false;
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
      const refreshed = await reload(data.term.id);
      toast(refreshed ? data.published.length ? 'Grades republished. Previous versions remain in the history.' : 'Grades published.'
        : 'Grades published, but Score Recording could not refresh.', refreshed ? 'success' : 'info');
    } catch (error) {
      toast(error.message || 'Grades could not be published.', 'error');
      confirm.disabled = false;
    }
  }

  function render(host, data, scope, reload) {
    host.classList.add('shs-gradebook');
    activeContext = { host, data, scope, reload };
    const policy = data.scope.policy;
    const term = data.term;
    const items = data.items || [];
    const students = data.students || [];
    const writable = Boolean(policy && term?.status === 'active' && data.scope.yearStatus === 'active'
      && !data.scope.legacyCommunication
      && (data.scope.kind !== 'elective' || (data.scope.classActive && data.scope.offeringActive && data.scope.teacherStatus === 'active')));
    const title = host.querySelector('#scorePanelTitle');
    const subject = host.querySelector('#scoreSectionName');
    const weights = host.querySelector('#scorePanelWeights');
    const subjectTitle = data.scope.communicationComponentName
      ? data.scope.communicationComponentName
      : data.scope.subjectName || data.scope.className || 'Class';
    title.textContent = 'Score Recording: ' + subjectTitle;
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
    const exportButton = host.querySelector('#exportScoresButton');
    setVisible(exportButton, true);
    exportButton.disabled = !items.length || !students.length;
    exportButton.title = exportButton.disabled ? 'Add score components and students before exporting.' : '';
    exportButton.onclick = () => exportScoresCsv(host, data);
    const lockBanner = host.querySelector('#quarterLockBanner');
    const lockBadge = host.querySelector('#quarterLockBadge');
    const needsLockNotice = !writable;
    setVisible(lockBanner, needsLockNotice);
    setVisible(lockBadge, term?.status !== 'active');
    host.querySelector('#quarterLockTitle').textContent = policy ? 'Score Recording is read-only' : 'Grading rules need review';
    host.querySelector('#quarterLockDesc').textContent = !policy
      ? data.scope.policyBlockReason || 'A verified grading rule is not available for this class.'
      : data.scope.yearStatus !== 'active' ? 'This school year is closed. Grades are read-only.'
        : term?.status !== 'active' ? 'This grading period is not active. Scores are read-only.'
          : 'This class is paused or is not assigned to you for editing.';
    const publishedBanner = document.getElementById('publishedGradesBanner');
    setVisible(publishedBanner, data.published.length > 0);
    if (data.published.length) {
      document.getElementById('publishedPeriodName').textContent = term?.name || 'Grading period';
      document.getElementById('publishedPeriodStatus').textContent = data.scope.communicationComponentName
          ? `Published ${data.scope.communicationComponentName} component grades for this grading period.`
          : 'Published grades for this class and grading period.';
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
      if (activeContext?.host === host) activeContext = null;
      const componentMenu = document.getElementById('scoreComponentMenu');
      if (componentMenu) componentMenu.hidden = true;
      host.querySelectorAll?.('.score-comp-menu-trigger[aria-expanded="true"]')
        ?.forEach(button => button.setAttribute('aria-expanded', 'false'));
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
      setVisible(host.querySelector('#exportScoresButton'), false);
      window.TeacherClassViews.renderScoreTable({
        host,
        loading: true
      });
      try {
        const query = { ...scope };
        if (termId) query.academicTermId = termId;
        const activeScope = { ...scope };
        const data = await api().getShsGradeWorkspace(query);
        if (versions.get(host) !== requestVersion || !host.isConnected) return false;
        scope = activeScope;
        render(host, data, activeScope, load);
        return true;
      } catch (error) {
        if (versions.get(host) !== requestVersion || !host.isConnected) return false;
        addButton.title = 'Score Recording is unavailable.';
        periodSelect.innerHTML = '<option value="">Grading period unavailable</option>';
        window.TeacherClassViews.renderScoreTable({
          host,
          empty: { noItems: { icon: 'triangle-alert', title: 'Gradebook unavailable', text: error.message || 'The gradebook could not be loaded.' } }
        });
        setFeedback(host, error.message || 'Gradebook unavailable.', true);
        return false;
      }
    };
    return load(initialScope.academicTermId || '');
  }

  function close(host) {
    if (!host) return;
    versions.set(host, (versions.get(host) || 0) + 1);
    host.classList.remove('shs-gradebook');
    if (activeContext?.host === host) activeContext = null;
    const modal = document.getElementById('addCompModal');
    if (modal?.classList.contains('open')) window.closeModal('addCompModal');
  }

  function getDeleteContext(itemId) {
    const context = activeContext;
    const item = context?.data.items.find(row => String(row.id) === String(itemId));
    if (!item || context.data.term?.status !== 'active'
      || context.data.scope.yearStatus !== 'active') return null;
    return { item, scope: context.scope, academicTermId: context.data.term.id,
      scoreCount: context.data.scores.filter(score => String(score.gradingItemId) === String(itemId)
        && (score.score != null || String(score.remarks || '').trim())).length,
      reload: context.reload };
  }

  async function refresh() {
    try {
      if (pendingMount) await pendingMount.promise;
      return await activeContext?.reload(activeContext.data.term?.id);
    } catch {
      return false;
    }
  }

  function show(host, scope) {
    const sameScope = currentScope => Object.keys(scope).every(key => String(currentScope[key] || '') === String(scope[key] || ''));
    const current = activeContext;
    if (current?.host === host && sameScope(current.scope))
      return Promise.resolve(true);
    if (pendingMount?.host === host && sameScope(pendingMount.scope)) return pendingMount.promise;
    const promise = mount(host, scope).finally(() => { if (pendingMount?.promise === promise) pendingMount = null; });
    pendingMount = { host, scope, promise };
    return promise;
  }

  window.AcademixShsGradebook = { mount, show, close, getDeleteContext, refresh };
})();
