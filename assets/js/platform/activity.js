const PLATFORM = window.EDUGNAY_PLATFORM;
    const PLATFORM_ACTIVITY = [];
    const PAGE_SIZE = 20;
    let activeTypeFilter = 'all';
    let nextCursor = null;
    let activityError = '';
    let loading = false;
    let requestVersion = 0;
    let filterTimer;

    function setActivityTypeFilter(element, type) {
      document.querySelectorAll('#activityTypeFilters .atf-chip').forEach(chip => chip.classList.remove('active'));
      element.classList.add('active');
      activeTypeFilter = type;
      applyActivityFilters();
    }

    async function loadActivity(reset = true) {
      if (loading && !reset) return;
      const version = ++requestVersion;
      loading = true;
      if (reset) {
        PLATFORM_ACTIVITY.length = 0;
        nextCursor = null;
        activityError = '';
      }
      renderActivityList();
      try {
        const page = await window.EDUGNAY_API.getPlatformActivityPage({
          limit: PAGE_SIZE,
          category: activeTypeFilter,
          date: document.getElementById('activityDateFilter').value,
          search: document.getElementById('activitySearch').value.trim(),
          cursor: reset ? null : nextCursor
        });
        if (version !== requestVersion) return;
        PLATFORM_ACTIVITY.push(...(page.activities || []));
        nextCursor = page.nextCursor || null;
        activityError = '';
      } catch (error) {
        if (version !== requestVersion) return;
        activityError = error.message || 'Platform activity could not be loaded.';
        if (!reset) showAppToast(activityError, 'error');
      } finally {
        if (version === requestVersion) {
          loading = false;
          renderActivityList();
        }
      }
    }

    function applyActivityFilters() {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => loadActivity(), 250);
    }

    function loadMoreActivity() {
      if (nextCursor) loadActivity(false);
    }

    function renderActivityList() {
      const container = document.getElementById('activityList');
      const emptyState = document.getElementById('activityEmptyState');
      const loadMoreWrap = document.querySelector('.activity-loadmore-wrap');
      const filtered = PLATFORM_ACTIVITY;
      const hasFilter = activeTypeFilter !== 'all' || document.getElementById('activityDateFilter').value !== 'all'
        || document.getElementById('activitySearch').value.trim();

      if (!filtered.length) {
        container.innerHTML = '';
        container.style.display = 'none';
        emptyState.hidden = false;
        emptyState.innerHTML = loading
          ? ''
          : window.EDUGNAY_CONFIG.renderPanelEmptyState({
            icon: activityError ? 'cloud-off' : 'activity',
            title: activityError ? 'Activity unavailable' : hasFilter ? 'No matching school activity' : 'No school account activity yet',
            text: activityError || (hasFilter ? 'Try a different search term or filter.' : 'School account changes will appear here.')
          });
        loadMoreWrap.style.display = 'none';
        if (window.lucide) window.lucide.createIcons();
        return;
      }

      container.style.display = '';
      emptyState.hidden = true;
      emptyState.innerHTML = '';

      let lastGroup = '';
      const activityHtml = filtered.map(activity => {
        const group = formatDateGroup(activity.createdAt);
        const groupHtml = group !== lastGroup ? `<div class="activity-group-label">${escapeHtml(group)}</div>` : '';
        lastGroup = group;
        const schoolName = String(activity.schoolName || '');
        const schoolContext = schoolName && schoolName.toLocaleLowerCase() !== String(activity.actor || '').toLocaleLowerCase()
          && !String(activity.detail || '').toLocaleLowerCase().includes(schoolName.toLocaleLowerCase()) ? schoolName : '';
        const context = [activity.detail, schoolContext].filter(Boolean).join(' · ');
        return `${groupHtml}
          <div class="activity-item">
            <div class="act-icon ${escapeHtml(activity.tone)}"><i data-lucide="${escapeHtml(activity.icon)}" style="width:15px;height:15px;"></i></div>
            <div class="act-body">
              <div class="act-text"><strong>${escapeHtml(activity.actor || 'System')}</strong> ${escapeHtml(activity.title || 'recorded an activity')}${context ? ` · ${escapeHtml(context)}` : ''}</div>
              <div class="act-time">${escapeHtml(formatTime(activity.createdAt))}</div>
            </div>
            <span class="act-tag">${escapeHtml(activity.type)}</span>
          </div>`;
      }).join('');

      container.innerHTML = activityHtml;
      loadMoreWrap.style.display = nextCursor && !loading ? 'flex' : 'none';
      if (window.lucide) window.lucide.createIcons();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      await loadActivity();
      window.EDUGNAY_PAGE_LOADING.ready();
      await window.EDUGNAY_PLATFORM_COMMUNICATION_READY;
      PLATFORM.renderTopbarNotifs();
      if (window.lucide) window.lucide.createIcons();
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    pe5d7632c48b4: function(event) { applyActivityFilters() },
  },
  click: {
    p09acd79c7b41: function(event) { setActivityTypeFilter(this, 'registrations') },
    pb8f0e8f3fa6c: function(event) { loadMoreActivity() },
    pdb888d5e4221: function(event) { setActivityTypeFilter(this, 'all') },
    pef36fb51e86d: function(event) { setActivityTypeFilter(this, 'access') },
  },
  input: {
    p780b84261ef0: function(event) { applyActivityFilters() },
  },
});
