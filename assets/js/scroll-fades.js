(function () {
  function updateFade(element, wrapper) {
    const hasMore = element.scrollWidth - element.clientWidth - element.scrollLeft > 4;
    wrapper.classList.toggle('has-more-right', hasMore);
  }

  function initScrollFades() {
    const elements = document.querySelectorAll('.child-switcher, .subject-tab-bar, .profile-tab-bar');
    elements.forEach((element) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'scroll-fade-wrap';
      if (element.classList.contains('subject-tab-bar') || element.classList.contains('profile-tab-bar')) wrapper.classList.add('light-tabs-fade');
      element.parentNode.insertBefore(wrapper, element);
      wrapper.appendChild(element);

      updateFade(element, wrapper);
      element.addEventListener('scroll', () => updateFade(element, wrapper), { passive: true });
      if ('ResizeObserver' in window) {
        new ResizeObserver(() => updateFade(element, wrapper)).observe(element);
      } else {
        window.addEventListener('resize', () => updateFade(element, wrapper));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollFades);
  } else {
    initScrollFades();
  }
})();
