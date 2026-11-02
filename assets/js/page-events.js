(() => {
  const handlers = Object.create(null);
  const listening = new Set();
  const pending = new Map();
  const attached = new WeakMap();
  let nextId = 0;
  let observing = false;
  const nonBubbling = new Set(['error', 'load', 'mouseenter', 'mouseleave', 'focus', 'blur']);

  function dispatch(event) {
    let element = event.target instanceof Element ? event.target : event.target?.parentElement;
    while (element) {
      const id = element.getAttribute(`data-page-${event.type}`);
      const handler = id && (attached.get(element)?.[event.type] || pending.get(id)?.handler || handlers[event.type]?.[id]);
      if (id && pending.has(id)) attach(element, event.type, id);
      if (handler && handler.call(element, event) === false) event.preventDefault();
      if (event.cancelBubble || nonBubbling.has(event.type)) break;
      element = element.parentElement;
    }
  }

  function attach(element, eventName, id) {
    const entry = pending.get(id);
    if (!entry || entry.eventName !== eventName) return;
    const byEvent = attached.get(element) || Object.create(null);
    byEvent[eventName] = entry.handler;
    attached.set(element, byEvent);
    pending.delete(id);
  }

  function register(eventName, handler) {
    const id = `r${++nextId}`;
    pending.set(id, { eventName, handler });
    if (!observing) {
      observer.observe(document, { childList: true, subtree: true });
      observing = true;
    }
    if (!listening.has(eventName)) {
      document.addEventListener(eventName, dispatch, true);
      listening.add(eventName);
    }
    return id;
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        for (const element of [node, ...node.querySelectorAll('*')]) {
          for (const attribute of element.attributes) {
            if (!attribute.name.startsWith('data-page-')) continue;
            attach(element, attribute.name.slice('data-page-'.length), attribute.value);
          }
        }
      }
    }
  });

  function bind(mapping) {
    for (const [eventName, entries] of Object.entries(mapping)) {
      handlers[eventName] ||= Object.create(null);
      Object.assign(handlers[eventName], entries);
      if (!listening.has(eventName)) {
        document.addEventListener(eventName, dispatch, true);
        listening.add(eventName);
      }
    }

    // Images can fail before a page's script at the end of the document loads.
    if (mapping.error) {
      document.querySelectorAll('img[data-page-error]').forEach(image => {
        if (image.complete && image.naturalWidth === 0) {
          const handler = handlers.error[image.getAttribute('data-page-error')];
          handler?.call(image, new Event('error'));
        }
      });
    }
  }

  window.EDUGNAY_PAGE_EVENTS = { bind, register };
})();

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    s2d33adbb7525: function(event) { setNotifFilter('unread', this) },
    s34fb81296a25: function(event) { setNotifFilter('all', this) },
    s35e5f1463bc7: function(event) { markAllRead() },
    s390cdc6e7ad5: function(event) { markAllNotifRead() },
    s3a4671da9f99: function(event) { localStorage.removeItem('managementTab') },
    s52959ebdf3bb: function(event) { toggleNotifDropdown() },
    s68217584b22a: function(event) { toggleGroup('sections-group') },
    s6a2f83bf8cb5: function(event) { markAllPlatformNotificationsRead() },
    s75e650dae902: function(event) { event.preventDefault(); confirmLogout(); },
    sa026e333e7cb: function(event) { navigate('announcements') },
    sab86664ca3f5: function(event) { toggleDrawer(true) },
    sc48f42f1ec91: function(event) { toggleDrawer(false) },
    sce679990fbe8: function(event) { navigate('dashboard') },
    sd6c1b06b9ac0: function(event) { navigate('reports') },
    sd8cf422f2fb0: function(event) { navigate('sfTemplates') },
    se9930608e765: function(event) { toggleProfileDropdown() },
    sf2ab58f61694: function(event) { navigate('journals') },
  },
  error: {
    sbb1bd901180b: function(event) { this.style.display='none' },
  },
});
