self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Show a generic alert for an invalid payload. */ }
  const title = ['Weekly report available', 'Weekly report updated'].includes(data.title)
    ? data.title : 'New Academix notification';
  const id = /^\d+$/.test(String(data.notificationId || '')) ? String(data.notificationId) : '';
  const role = ['parent', 'student', 'teacher', 'school_admin', 'platform_admin'].includes(data.role)
    ? data.role : 'parent';
  event.waitUntil(self.registration.showNotification(title, {
    body: 'Open Academix to view it.',
    icon: new URL('assets/images/edUgnay-logo-circle.png', self.registration.scope).href,
    tag: id ? `academix-notification-${id}` : 'academix-notification',
    data: { id, role }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { id, role } = event.notification.data || {};
  const folder = { parent: 'parent', student: 'student', teacher: 'teacher',
    school_admin: 'admin', platform_admin: 'platform' }[role] || 'parent';
  const url = new URL(`views/${folder}/edugnay-${folder}-notifications.html`, self.registration.scope);
  if (id && /^\d+$/.test(String(id))) url.searchParams.set('pushNotice', String(id));
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => client.url.startsWith(self.registration.scope) && 'navigate' in client);
    if (existing) {
      await existing.navigate(url.href);
      return existing.focus();
    }
    return self.clients.openWindow(url.href);
  }));
});
