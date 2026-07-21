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
        <div class="tb-notif-time">${formatTime(n.created_at)}</div>
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

function toggleNotifDropdown() {
  document.getElementById('tbNotifPanel').classList.toggle('open');
}

function markAllNotifRead() {
  const allIds = getAdminNotifItems().map(n => n.id);
  setReadIds(allIds);
  renderTopbarNotifs();
}

/* ── PROFILE DROPDOWN ── */
function toggleProfileDropdown() {
  const trigger = document.getElementById('tbProfileTrigger');
  const dropdown = document.getElementById('tbProfileDropdown');
  trigger.classList.toggle('open');
  dropdown.classList.toggle('open');
}

/* ── OUTSIDE-CLICK CLOSE (profile + notif) ── */
document.addEventListener('click', (e) => {
  const trigger = document.getElementById('tbProfileTrigger');
  const dropdown = document.getElementById('tbProfileDropdown');
  if (trigger && dropdown && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
    trigger.classList.remove('open');
    dropdown.classList.remove('open');
  }

  const notifTrigger = document.getElementById('tbNotifTrigger');
  const notifPanel = document.getElementById('tbNotifPanel');
  if (notifTrigger && notifPanel && !notifTrigger.contains(e.target) && !notifPanel.contains(e.target)) {
    notifPanel.classList.remove('open');
  }
});

/* ── SIDEBAR DRAWER (mobile) ── */
function toggleDrawer(open) {
  const isOpen = open === undefined ? !document.body.classList.contains('drawer-open') : open;
  document.body.classList.toggle('drawer-open', isOpen);
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

/* ── LOGOUT ── */
function openLogoutModal() {
  const trigger = document.getElementById('tbProfileTrigger');
  const dropdown = document.getElementById('tbProfileDropdown');
  if (trigger) trigger.classList.remove('open');
  if (dropdown) dropdown.classList.remove('open');

  document.getElementById('logoutModalBackdrop').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function closeLogoutModal() {
  document.getElementById('logoutModalBackdrop').classList.remove('open');
}

function confirmLogout() {
  // TODO on backend conversion: replace with POST /auth/logout,
  // clear session cookie, then redirect
  localStorage.clear(); // wipes mock data (reopen requests, read-state, etc.)
  window.location.href = '/index.html'; // adjust to your actual login page path
}

document.getElementById('logoutModalBackdrop')?.addEventListener('click', function (e) {
  if (e.target === this) closeLogoutModal();
});