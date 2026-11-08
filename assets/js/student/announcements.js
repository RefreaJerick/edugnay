/* ── FILTER ── */
    let ANNOUNCEMENTS = [];
    let announcementLoadError = '';

    function renderStudentAnnouncements() {
      const list = document.getElementById('annList');
      if (!list) return;
      const visibleAnnouncements = ANNOUNCEMENTS.filter(ann => !ann.access || studentCanAccess(ann.access));
      list.innerHTML = visibleAnnouncements.map((ann, index) => `
        <div class="ann-card priority-${ann.priority}" data-id="${ann.id}" data-priority="${ann.priority}" data-read="${ann.read}" data-page-click="g29a775ec4b06">
          ${ann.pinned ? '<div class="pinned-strip"><i data-lucide="pin" style="width:12px;height:12px;"></i> Pinned Announcement</div>' : ''}
          <div class="ann-body"><div class="ann-head"><div class="ann-head-left"><div class="ann-type-icon ${ann.iconClass}"><i data-lucide="${ann.icon}" style="width:16px;height:16px;"></i></div><div class="ann-title-wrap"><div class="ann-title">${window.EDUGNAY_CONFIG.escapeHtml(ann.title)}</div><div class="ann-meta"><span class="ann-meta-item"><i data-lucide="clock" style="width:11px;height:11px;"></i> ${window.EDUGNAY_CONFIG.escapeHtml(ann.time)}</span><span class="ann-meta-item"><i data-lucide="user" style="width:11px;height:11px;"></i> ${window.EDUGNAY_CONFIG.escapeHtml(ann.author)}</span></div></div></div></div><div class="ann-content" data-full="${window.EDUGNAY_CONFIG.escapeHtml(ann.body)}">${window.EDUGNAY_CONFIG.escapeHtml(ann.body)}</div>${ann.imageUrl ? `<div class="ann-image-wrap"><img class="ann-image" crossorigin="use-credentials" src="${window.EDUGNAY_CONFIG.escapeHtml(ann.imageUrl)}" alt="${window.EDUGNAY_CONFIG.escapeHtml(ann.title)}" loading="lazy" data-page-error="g7ea297b8513b"/></div>` : ''}<div class="ann-audience"><span class="aud-label">To:</span><span class="aud-tag ${ann.audienceClass}"><i data-lucide="${ann.audienceIcon}" style="width:10px;height:10px;"></i> ${window.EDUGNAY_CONFIG.escapeHtml(ann.audience)}</span></div></div><div class="ann-footer"><div class="ann-footer-left"><i data-lucide="clock" style="width:12px;height:12px;"></i> Posted by ${window.EDUGNAY_CONFIG.escapeHtml(ann.author)}</div><div class="ann-footer-right"><button class="footer-btn read" data-page-click="g8deefce049b1"><i data-lucide="eye" style="width:11px;height:11px;"></i> Read</button></div></div>
        </div>`).join('');
      lucide.createIcons();
    }

    function filterCards() {
      const query = document.getElementById('searchInput').value.toLowerCase();
      const priority = document.getElementById('priorityFilter').value;
      const status = document.getElementById('statusFilter').value;
      const cards = document.querySelectorAll('#annList .ann-card');
      let visible = 0;

      cards.forEach(card => {
        const title = card.querySelector('.ann-title')?.textContent.toLowerCase() || '';
        const content = card.querySelector('.ann-content')?.textContent.toLowerCase() || '';
        const pri = card.dataset.priority;
        const read = card.dataset.read;

        const matchSearch = title.includes(query) || content.includes(query);
        const matchPriority = priority === 'all' || pri === priority;
        const matchStatus = status === 'all'
          || (status === 'unread' && read === 'false')
          || (status === 'read' && read === 'true');

        const show = matchSearch && matchPriority && matchStatus;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
      });

      const empty = document.getElementById('annEmpty');
      const isEmpty = visible === 0 || Boolean(announcementLoadError);
      empty.hidden = !isEmpty;
      if (isEmpty) {
        empty.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState(announcementLoadError ? {
          icon: 'alert-circle',
          title: 'Announcements unavailable',
          text: announcementLoadError
        } : {
          icon: 'megaphone',
          title: 'No announcements found',
          text: ANNOUNCEMENTS.length ? 'Try adjusting your filters or search query.' : 'No announcements have been posted yet.'
        });
        if (window.lucide) lucide.createIcons();
      } else empty.innerHTML = '';
    }

    /* ── MODAL: open ── */
    function openAnnModal(card) {
      const title = card.querySelector('.ann-title')?.textContent.trim() || '';
      const content = card.querySelector('.ann-content')?.dataset.full
        || card.querySelector('.ann-content')?.innerHTML || '';
      const metaItems = card.querySelectorAll('.ann-meta-item');
      const postedAt = metaItems[0]?.textContent.trim() || '—';
      const author = metaItems[1]?.textContent.trim() || '';
      const imgEl = card.querySelector('.ann-image');
      const audTag = card.querySelector('.aud-tag');

      // Title & meta
      document.getElementById('modalAnnTitle').textContent = title;
      document.getElementById('modalAnnMeta').textContent = author
        ? 'Posted by ' + author + ' · ' + postedAt
        : 'Posted · ' + postedAt;
      document.getElementById('modalPostedAt').textContent = 'Posted · ' + postedAt;
      document.getElementById('modalAnnContent').textContent = content;

      // Audience
      const modalAud = document.getElementById('modalAudienceTag');
      if (audTag) {
        modalAud.className = audTag.className;
        modalAud.innerHTML = audTag.innerHTML;
      }

      // Image
      const imgWrap = document.getElementById('modalImageWrap');
      if (imgEl && imgEl.src && !imgEl.src.endsWith('undefined')) {
        document.getElementById('modalAnnImage').src = imgEl.src;
        document.getElementById('modalAnnImage').alt = title;
        imgWrap.style.display = 'block';
      } else {
        imgWrap.style.display = 'none';
      }

      document.getElementById('annDetailModal').classList.add('open');

      // Mark as read
      markAsRead(card);
    }

    function closeAnnModal() {
      document.getElementById('annDetailModal').classList.remove('open');
    }

    document.getElementById('annDetailModal').addEventListener('click', function (e) {
      if (e.target === this) closeAnnModal();
    });

    /* ── MARK AS READ ── */
    async function markAsRead(card) {
      if (card.dataset.read === 'true' || card.dataset.markingRead === 'true') return;
      card.dataset.markingRead = 'true';

      try {
        await window.EDUGNAY_API.markAnnouncementRead(card.dataset.id);
      } catch (error) {
        window.alert(error?.message || 'The announcement could not be marked as read.');
        return;
      } finally {
        delete card.dataset.markingRead;
      }

      card.dataset.read = 'true';
      const announcement = ANNOUNCEMENTS.find(item => String(item.id) === card.dataset.id);
      if (announcement) announcement.read = true;

      // Decrement the sidebar unread badge
      const countEl = document.getElementById('unreadCount');
      const sidebarBadge = document.getElementById('sidebarUnreadBadge');
      const current = parseInt((countEl || sidebarBadge)?.textContent || '0', 10);
      const next = current > 0 ? current - 1 : 0;
      if (countEl) countEl.textContent = next;

      if (sidebarBadge) {
        if (next > 0) {
          sidebarBadge.textContent = next;
        } else {
          sidebarBadge.style.display = 'none';
        }
      }

    }

    document.addEventListener('DOMContentLoaded', async () => {
      try {
        if (!window.EDUGNAY_API?.isBackendAvailable) throw new Error('Announcements aren’t available right now. Refresh and try again.');
        const announcements = window.EDUGNAY_COMMUNICATION_RESOURCES?.announcements;
        if (!announcements) throw new Error('Announcements could not be loaded.');
        ANNOUNCEMENTS = await announcements;
        announcementLoadError = '';
      } catch (error) {
        ANNOUNCEMENTS = [];
        announcementLoadError = error.message || 'Announcements could not be loaded.';
      }
      renderStudentAnnouncements();
      filterCards();
      window.EDUGNAY_PAGE_LOADING.ready();
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    p6e476b685c1b: function(event) { filterCards() },
  },
  click: {
    pdd91efdd5e34: function(event) { closeAnnModal() },
  },
  input: {
    p9675251bf3f8: function(event) { filterCards() },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    g29a775ec4b06: function(event) { openAnnModal(this) },
    g8deefce049b1: function(event) { event.stopPropagation(); openAnnModal(this.closest('.ann-card')) },
  },
  error: {
    g7ea297b8513b: function(event) { this.closest('.ann-image-wrap').style.display='none' },
  },
});
