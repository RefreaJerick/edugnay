/* ── ACTIVITY LOG ──
     The school-scoped Express API powers this page and the dashboard preview. */
  const ACTIVITY_PAGE_SIZE = 20;
  const allowedActivityTones = new Set(['blue', 'green', 'red', 'orange', 'purple', 'gold', 'gray']);
  let activityCategory = 'all';
  let activityCursor = null;
  let activityItems = [];
  let activityRequestId = 0;
  let activitySearchTimer;

  function setActivityTypeFilter(button, category) {
    document.querySelectorAll('#activityTypeFilters .atf-chip').forEach(chip => chip.classList.remove('active'));
    button.classList.add('active');
    activityCategory = category;
    loadActivity(false);
  }

  function applyActivityFilters() {
    clearTimeout(activitySearchTimer);
    activitySearchTimer = setTimeout(() => loadActivity(false), 250);
  }

  async function loadMoreActivity() {
    if (activityCursor) await loadActivity(true);
  }

  async function loadActivity(append) {
    const requestId = ++activityRequestId;
    const list = document.getElementById('activityList');
    const empty = document.getElementById('activityEmptyState');
    const errorState = document.getElementById('activityErrorState');
    const loadMore = document.getElementById('activityLoadMoreBtn');
    const search = document.getElementById('activitySearch').value.trim();

    if (!append) {
      activityCursor = null;
      activityItems = [];
      list.innerHTML = '';
      list.style.display = 'none';
      empty.hidden = false;
      empty.innerHTML = '';
    }
    errorState.hidden = true;
    loadMore.disabled = true;
    loadMore.textContent = 'Loading...';

    try {
      const result = await window.EDUGNAY_API.getSchoolActivityPage({
        limit: ACTIVITY_PAGE_SIZE,
        category: activityCategory,
        date: document.getElementById('activityDateFilter').value,
        search,
        cursor: append ? activityCursor : null
      });
      if (requestId !== activityRequestId) return;
      activityItems = append ? activityItems.concat(result.activities || []) : (result.activities || []);
      activityCursor = result.nextCursor || null;
      renderActivityList();
    } catch (error) {
      if (requestId !== activityRequestId) return;
      if (!append) {
        list.innerHTML = '';
        list.style.display = 'none';
      }
      empty.hidden = true;
      errorState.hidden = false;
      errorState.innerHTML = `${window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Activity unavailable', text: error.message || 'Activity could not be loaded.' })}<button type="button" class="activity-loadmore-btn" data-page-click="gabf2c926dca1">Try again</button>`;
      if (window.lucide) lucide.createIcons();
    } finally {
      if (requestId === activityRequestId) {
        loadMore.disabled = false;
        loadMore.textContent = 'Load more';
        loadMore.closest('.activity-loadmore-wrap').style.display = activityCursor ? 'flex' : 'none';
      }
    }
  }

  function renderActivityList() {
    const list = document.getElementById('activityList');
    const empty = document.getElementById('activityEmptyState');
    const errorState = document.getElementById('activityErrorState');
    errorState.hidden = true;
    if (!activityItems.length) {
      list.innerHTML = '';
      list.style.display = 'none';
      empty.hidden = false;
      empty.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'search-x', title: 'No matching activity', text: 'Try a different search term or filter.' });
      return;
    }

    const safe = window.EDUGNAY_CONFIG.escapeHtml;
    let lastGroup = null;
    list.innerHTML = activityItems.map(item => {
      const group = formatDateGroup(item.createdAt);
      const groupLabel = group !== lastGroup ? `<div class="activity-group-label">${safe(group)}</div>` : '';
      lastGroup = group;
      const tone = allowedActivityTones.has(item.tone) ? item.tone : 'blue';
      const icon = /^[a-z0-9-]{1,40}$/.test(item.icon || '') ? item.icon : 'activity';
      return `${groupLabel}<div class="activity-item">
        <div class="act-icon ${tone}" aria-hidden="true"><i data-lucide="${icon}" style="width:15px;height:15px;"></i></div>
        <div class="act-body"><div class="act-text"><strong>${safe(item.actor || 'System')}</strong> ${safe(item.title || 'recorded an activity')}${item.detail ? ` · ${safe(item.detail)}` : ''}</div>
        <div class="act-time">${safe(formatTime(item.createdAt))}</div></div><span class="act-tag">${safe(item.type || 'System')}</span></div>`;
    }).join('');
    list.style.display = '';
    empty.hidden = true;
    empty.innerHTML = '';
    if (window.lucide) lucide.createIcons();
  }

  document.getElementById('activityDateFilter').addEventListener('change', () => loadActivity(false));
  document.addEventListener('DOMContentLoaded', async () => {
    await loadActivity(false);
    window.EDUGNAY_PAGE_LOADING.ready();
  });

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    pe5d7632c48b4: function(event) { applyActivityFilters() },
  },
  click: {
    p03efa4593cf8: function(event) { setActivityTypeFilter(this,'announcements') },
    p143a43a651c6: function(event) { setActivityTypeFilter(this,'school_forms') },
    p25a9dd8af81b: function(event) { setActivityTypeFilter(this,'accounts') },
    p299f0da88c9a: function(event) { setActivityTypeFilter(this,'class_management') },
    p2c5fe8261daf: function(event) { setActivityTypeFilter(this,'archives') },
    pa23b85884a5b: function(event) { setActivityTypeFilter(this,'learning_materials') },
    paeb4beb75bf9: function(event) { setActivityTypeFilter(this,'grades') },
    pb03e1d4f1cb4: function(event) { setActivityTypeFilter(this,'reopen_requests') },
    pb8f0e8f3fa6c: function(event) { loadMoreActivity() },
    pd968ddef9782: function(event) { setActivityTypeFilter(this,'assignments') },
    pe61b08f51f02: function(event) { setActivityTypeFilter(this,'all') },
    pebd25e8d09ca: function(event) { setActivityTypeFilter(this,'attendance') },
    pee3b437de7d9: function(event) { setActivityTypeFilter(this,'school_configuration') },
    pf1aca6c941f5: function(event) { setActivityTypeFilter(this,'narrative_reports') },
  },
  input: {
    p780b84261ef0: function(event) { applyActivityFilters() },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    gabf2c926dca1: function(event) { loadActivity(false) },
  },
});
