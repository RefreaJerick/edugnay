/* ══════════════════════════════════════════
   ADMIN SHELL — shared across all admin pages
   Nav, topbar, notif dropdown (reopen requests), profile dropdown
   TODO on backend conversion: replace getReopenRequests() with
   data from GET /admin/notifications (reopen_requests + future types)
   ══════════════════════════════════════════ */

/* ── REOPEN REQUEST DATA (source: quarter reopen request system) ── */
const REOPEN_STORE_KEY = 'edugnay_reopen_requests';
const ADMIN_READ_STORE_KEY = 'edugnay_admin_notif_read';

function getReopenRequests() {
  try { return JSON.parse(localStorage.getItem(REOPEN_STORE_KEY)) || []; }
  catch { return []; }
}

function getReadIds() {
  try { return JSON.parse(localStorage.getItem(ADMIN_READ_STORE_KEY)) || []; }
  catch { return []; }
}
function setReadIds(ids) {
  localStorage.setItem(ADMIN_READ_STORE_KEY, JSON.stringify(ids));
}

function getAdminNotifItems() {
  const readIds = getReadIds();
  return getReopenRequests()
    .filter(r => r.status === 'pending')
    .map(r => ({
      id: r.createdAt,
      icon: 'unlock',
      color: 'gold',
      title: `Reopen requested: Q${r.quarter.slice(1)}`,
      desc: `${r.teacher} — ${r.section} · ${r.subject}`,
      read: readIds.includes(r.createdAt),
      link: 'edugnay-admin-system-config.html#reopen-requests',
      created_at: r.createdAt
    }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/* ── TIME HELPERS (shared: topbar notifs + activity feed) ── */
function formatDateGroup(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/* ── TOPBAR NOTIF DROPDOWN ── */
function renderTopbarNotifs() {
  const list = document.getElementById('tbNotifList');
  const empty = document.getElementById('tbNotifEmpty');
  const dot = document.getElementById('tbNotifDot');
  if (!list) return;

  const items = getAdminNotifItems().slice(0, 5);
  const unreadLabel = document.querySelector('.tb-notif-unread-count');
  const unreadCount = items.filter(n => !n.read).length;
  if (unreadLabel) unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';

  if (!items.length) {
    list.innerHTML = `
      <div class="tb-notif-empty" id="tbNotifEmpty">
        <div class="tb-notif-empty-icon"><i data-lucide="bell-off" style="width:20px;height:20px;"></i></div>
        <div class="tb-notif-empty-title">No notifications yet</div>
        <div class="tb-notif-empty-text">You're all caught up. New alerts will show up here.</div>
      </div>
    `;
    if (dot) dot.style.display = 'none';
    if (window.lucide) lucide.createIcons();
    return;
  }

  list.innerHTML = items.map(n => `
    <a class="tb-notif-item ${n.read ? '' : 'unread'}" onclick="goToTopbarNotif('${n.link}', '${n.id}')">
      <div class="tb-notif-icon ${n.color}">
        <i data-lucide="${n.icon}" style="width:15px;height:15px;"></i>
      </div>
      <div class="tb-notif-body">
        <div class="tb-notif-head">
          <div class="tb-notif-title">${n.title}</div>
        </div>
        <div class="tb-notif-desc">${n.desc}</div>
        <div class="tb-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatTime(n.created_at)}</span></div>
      </div>
    </a>
  `).join('');

  const hasUnread = items.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? '' : 'none';

  if (window.lucide) lucide.createIcons();
}

function goToTopbarNotif(link, id) {
  const ids = getReadIds();
  if (!ids.includes(id)) { ids.push(id); setReadIds(ids); }
  window.location.href = link;
}

function toggleNavGroup(group) {
  group.classList.toggle('open');
}

/* ── ACTIVE NAV ITEM ON CLICK ── */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function () {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      this.classList.add('active');
      toggleDrawer(false);
    });
  });

  renderTopbarNotifs();
});
