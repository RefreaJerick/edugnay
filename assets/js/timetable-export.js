(() => {
  'use strict';

  const colors = {
    light: { page: '#eff4fa', surface: '#ffffff', card: '#eff6ff', text: '#0b1f3a', muted: '#60748e', accent: '#1d5cb4', line: '#dce6f2' },
    dark: { page: '#081a32', surface: '#112b49', card: '#1b3a5f', text: '#f5f8ff', muted: '#bed0e7', accent: '#8dbdff', line: '#375575' }
  };
  const fontFamily = '"Plus Jakarta Sans", sans-serif';
  let logoPromise;

  function loadLogo() {
    if (!logoPromise) {
      logoPromise = new Promise((resolve, reject) => {
        const logo = new Image();
        logo.onload = () => resolve(logo);
        logo.onerror = () => reject(new Error('The Academix logo could not be loaded.'));
        logo.src = new URL('../../assets/images/edUgnay-logo-circle.png', window.location.href).href;
      }).catch(error => { logoPromise = null; throw error; });
    }
    return logoPromise;
  }

  function rounded(ctx, x, y, width, height, radius, color) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function wrap(ctx, value, maxWidth) {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) { line = next; continue; }
      if (line) { lines.push(line); line = ''; }
      if (ctx.measureText(word).width <= maxWidth) { line = word; continue; }
      for (const character of Array.from(word)) {
        if (line && ctx.measureText(line + character).width > maxWidth) { lines.push(line); line = ''; }
        line += character;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function meetingLayout(ctx, meeting, width, style, palette) {
    const maxWidth = width - style.cardPadding * 2;
    const fields = [
      { value: meeting.subject, size: style.subjectSize, weight: 800, height: style.subjectLine, color: palette.text },
      { value: meeting.time, size: style.timeSize, weight: 700, height: style.timeLine, color: palette.accent },
      ...meeting.details.map(value => ({ value, size: style.detailSize, weight: 500, height: style.detailLine, color: palette.muted }))
    ];
    const sections = fields.map(field => {
      const font = `${field.weight} ${field.size}px ${fontFamily}`;
      ctx.font = font;
      const lines = wrap(ctx, field.value, maxWidth);
      return { ...field, font, lines };
    });
    const height = style.cardPadding * 2 + sections.reduce((sum, field) => sum + field.lines.length * field.height, 0)
      + (sections.length - 1) * style.textGap;
    return { height, sections };
  }

  function dayLayout(ctx, day, width, style, palette) {
    const cardWidth = width - style.dayPadding * 2;
    const cards = day.meetings.map(meeting => meetingLayout(ctx, meeting, cardWidth, style, palette));
    const contentHeight = cards.length
      ? cards.reduce((sum, card) => sum + card.height, 0) + (cards.length - 1) * style.cardGap
      : style.emptyHeight;
    return { day, cards, height: Math.max(style.minDayHeight, style.dayPadding * 2 + style.dayHeaderHeight + contentHeight) };
  }

  function drawCard(ctx, x, y, width, card, style, palette) {
    rounded(ctx, x, y, width, card.height, 14, palette.card);
    rounded(ctx, x, y + 12, 5, card.height - 24, 2, palette.accent);
    let top = y + style.cardPadding;
    for (const section of card.sections) {
      ctx.font = section.font;
      ctx.fillStyle = section.color;
      for (const line of section.lines) {
        ctx.fillText(line, x + style.cardPadding, top + section.height * .79);
        top += section.height;
      }
      top += style.textGap;
    }
  }

  function drawDay(ctx, x, y, width, layout, style, palette) {
    rounded(ctx, x, y, width, layout.height, 18, palette.surface);
    ctx.fillStyle = palette.text;
    ctx.font = `800 ${style.dayNameSize}px ${fontFamily}`;
    ctx.fillText(layout.day.name, x + style.dayPadding, y + style.dayPadding + style.dayNameSize);
    let top = y + style.dayPadding + style.dayHeaderHeight;
    if (!layout.cards.length) {
      ctx.font = `500 ${style.detailSize}px ${fontFamily}`;
      ctx.fillText('No classes', x + style.dayPadding, top + style.detailSize);
      return;
    }
    for (const card of layout.cards) {
      drawCard(ctx, x + style.dayPadding, top, width - style.dayPadding * 2, card, style, palette);
      top += card.height + style.cardGap;
    }
  }

  function drawHeader(ctx, width, margin, height, snapshot, logo) {
    rounded(ctx, margin, margin, width - margin * 2, height, 22, '#0b1f3a');
    ctx.drawImage(logo, margin + 32, margin + 31, 76, 76);
    ctx.font = '800 37px Outfit, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Acade', margin + 126, margin + 66);
    const brandWidth = ctx.measureText('Acade').width;
    ctx.fillStyle = '#d5ac3c';
    ctx.fillText('Mix', margin + 126 + brandWidth, margin + 66);
    ctx.fillStyle = '#c7d9f1';
    ctx.font = `700 20px ${fontFamily}`;
    ctx.fillText('MY WEEKLY SCHEDULE', margin + 126, margin + 98);
    ctx.fillStyle = '#c7d9f1';
    ctx.font = `700 22px ${fontFamily}`;
    ctx.fillText(`S.Y. ${snapshot.yearLabel}`, margin + 32, margin + 146);
  }

  function mobileMeetingLayout(ctx, meeting, detailWidth, timeWidth, palette) {
    const fields = [
      { value: meeting.subject, size: 28, weight: 800, height: 38, color: palette.text },
      ...meeting.details.map(value => ({ value, size: 22, weight: 500, height: 30, color: palette.muted }))
    ];
    const sections = fields.map(field => {
      const font = `${field.weight} ${field.size}px ${fontFamily}`;
      ctx.font = font;
      return { ...field, font, lines: wrap(ctx, field.value, detailWidth) };
    });
    ctx.font = `700 23px ${fontFamily}`;
    const timeLines = wrap(ctx, meeting.time, timeWidth);
    const detailsHeight = sections.reduce((sum, field) => sum + field.lines.length * field.height, 0)
      + (sections.length - 1) * 4;
    return { sections, timeLines, height: Math.max(detailsHeight, timeLines.length * 30) + 20 };
  }

  function mobileDayLayout(ctx, day, detailWidth, timeWidth, palette) {
    const meetings = day.meetings.map(meeting => mobileMeetingLayout(ctx, meeting, detailWidth, timeWidth, palette));
    const height = meetings.length
      ? 52 + meetings.reduce((sum, meeting) => sum + meeting.height, 0) + (meetings.length - 1) + 16
      : 72;
    return { day, meetings, height };
  }

  function drawMobileHeader(ctx, x, y, width, snapshot, logo) {
    rounded(ctx, x, y, width, 126, 22, '#0b1f3a');
    ctx.drawImage(logo, x + 28, y + 29, 66, 66);
    ctx.font = '800 37px Outfit, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Acade', x + 114, y + 61);
    const brandWidth = ctx.measureText('Acade').width;
    ctx.fillStyle = '#d5ac3c';
    ctx.fillText('Mix', x + 114 + brandWidth, y + 61);
    ctx.fillStyle = '#c7d9f1';
    ctx.font = `700 20px ${fontFamily}`;
    ctx.fillText('MY WEEKLY SCHEDULE', x + 114, y + 91);
    ctx.font = `700 22px ${fontFamily}`;
    const year = `S.Y. ${snapshot.yearLabel}`;
    ctx.fillText(year, x + width - 28 - ctx.measureText(year).width, y + 70);
  }

  function drawMobileDay(ctx, x, y, layout, detailX, detailWidth, palette) {
    ctx.fillStyle = palette.text;
    ctx.font = `700 26px ${fontFamily}`;
    ctx.fillText(layout.day.name, x, y + 40);
    if (!layout.meetings.length) {
      ctx.fillStyle = palette.muted;
      ctx.font = `500 22px ${fontFamily}`;
      ctx.fillText('No classes', detailX, y + 40);
      return;
    }
    let rowTop = y + 52;
    layout.meetings.forEach((meeting, index) => {
      let textTop = rowTop + 10;
      for (const section of meeting.sections) {
        ctx.font = section.font;
        ctx.fillStyle = section.color;
        for (const line of section.lines) {
          ctx.fillText(line, detailX, textTop + section.height * .79);
          textTop += section.height;
        }
        textTop += 4;
      }
      ctx.font = `700 23px ${fontFamily}`;
      ctx.fillStyle = palette.accent;
      meeting.timeLines.forEach((line, lineIndex) => ctx.fillText(line, x, rowTop + 10 + lineIndex * 30 + 24));
      rowTop += meeting.height;
      if (index < layout.meetings.length - 1) {
        ctx.fillStyle = palette.line;
        ctx.fillRect(detailX, rowTop, detailWidth, 1);
        rowTop += 1;
      }
    });
  }

  function renderMobileCanvas(ctx, canvas, snapshot, palette, logo) {
    const width = canvas.width;
    const margin = 48;
    const sheetWidth = width - margin * 2;
    const innerPadding = 28;
    const timeWidth = 248;
    const detailX = margin + innerPadding + timeWidth + 24;
    const detailWidth = sheetWidth - innerPadding * 2 - timeWidth - 24;
    const sheetTop = margin + 126 + 18;
    const days = snapshot.days.map(day => mobileDayLayout(ctx, day, detailWidth, timeWidth, palette));
    const sheetHeight = 32 + days.reduce((sum, day) => sum + day.height, 0) + 6;
    const height = Math.ceil(sheetTop + sheetHeight + margin);
    if (width * height > 32000000) throw new Error('This schedule is too large to export as one image.');
    canvas.height = height;
    ctx.fillStyle = palette.page;
    ctx.fillRect(0, 0, width, height);
    drawMobileHeader(ctx, margin, margin, sheetWidth, snapshot, logo);
    rounded(ctx, margin, sheetTop, sheetWidth, sheetHeight, 20, palette.surface);
    let top = sheetTop + 16;
    days.forEach((day, index) => {
      drawMobileDay(ctx, margin + innerPadding, top, day, detailX, detailWidth, palette);
      top += day.height;
      if (index < days.length - 1) {
        ctx.fillStyle = palette.line;
        ctx.fillRect(margin + innerPadding, top, sheetWidth - innerPadding * 2, 1);
        top += 1;
      }
    });
    return canvas;
  }

  function renderCanvas(snapshot, layout, theme, logo) {
    if (!snapshot || snapshot.days?.length !== 7) throw new Error('The selected week is unavailable.');
    const mobile = layout === 'mobile';
    const width = mobile ? 1080 : 2100;
    const palette = colors[theme];
    const canvas = document.createElement('canvas');
    canvas.width = width;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image downloads are not supported in this browser.');
    if (mobile) return renderMobileCanvas(ctx, canvas, snapshot, palette, logo);

    const margin = 48;
    const gap = 12;
    const headerHeight = 174;
    const style = { dayPadding: 14, dayHeaderHeight: 44, minDayHeight: 125, emptyHeight: 34, cardPadding: 16, cardGap: 10, textGap: 5, subjectSize: 22, subjectLine: 30, timeSize: 18, timeLine: 26, detailSize: 17, detailLine: 24, dayNameSize: 24 };
    const dayWidth = (width - margin * 2 - gap * 6) / 7;
    const dayLayouts = snapshot.days.map(day => dayLayout(ctx, day, dayWidth, style, palette));
    const rowHeight = Math.max(...dayLayouts.map(day => day.height));
    dayLayouts.forEach(day => { day.height = rowHeight; });
    const daysHeight = rowHeight;
    const contentTop = margin + headerHeight + 20;
    const height = Math.ceil(contentTop + daysHeight + 88);
    if (width * height > 32000000) throw new Error('This schedule is too large to export as one image.');
    canvas.height = height;
    ctx.fillStyle = palette.page;
    ctx.fillRect(0, 0, width, height);
    drawHeader(ctx, width, margin, headerHeight, snapshot, logo);
    dayLayouts.forEach((day, index) => drawDay(ctx, margin + index * (dayWidth + gap), contentTop, dayWidth, day, style, palette));
    ctx.fillStyle = palette.muted;
    ctx.font = `600 18px ${fontFamily}`;
    ctx.fillText('Academix  ·  Schedule snapshot', margin, height - 36);
    return canvas;
  }

  async function render(snapshot, layout, theme) {
    if (!['mobile', 'desktop'].includes(layout) || !colors[theme]) throw new Error('Choose a valid layout and theme.');
    const [logo] = await Promise.all([loadLogo(), document.fonts?.ready?.catch(() => {}) || Promise.resolve()]);
    return renderCanvas(snapshot, layout, theme, logo);
  }

  function init(getSnapshot) {
    const openButton = document.getElementById('timetable-export-open');
    const overlay = document.getElementById('timetable-export-overlay');
    if (!openButton || !overlay) return null;
    openButton.hidden = false;
    openButton.disabled = true;
    if (typeof document.createElement('canvas').toBlob !== 'function') {
      openButton.title = 'Image downloads are not supported in this browser.';
      return { setAvailable() {} };
    }
    const dialog = document.getElementById('timetable-export-dialog');
    const preview = document.getElementById('timetable-export-preview');
    const status = document.getElementById('timetable-export-status');
    const downloadButton = document.getElementById('timetable-export-download');
    const radios = [...dialog.querySelectorAll('input[type="radio"]')];
    let canvas = null;
    let version = 0;
    let busy = false;
    let previousOverflow = '';

    const choice = name => dialog.querySelector(`input[name="timetable-export-${name}"]:checked`).value;
    function message(value, error = false) {
      status.textContent = value;
      status.classList.toggle('is-error', error);
    }
    function close() {
      if (overlay.hidden) return;
      version += 1;
      overlay.hidden = true;
      canvas = null;
      preview.replaceChildren();
      document.body.style.overflow = previousOverflow;
      openButton.focus();
    }
    async function updatePreview() {
      const request = ++version;
      canvas = null;
      downloadButton.disabled = true;
      preview.replaceChildren();
      const layout = choice('layout');
      preview.dataset.layout = layout;
      message('Preparing preview...');
      try {
        const image = await render(getSnapshot(), layout, choice('theme'));
        if (overlay.hidden || request !== version) return;
        canvas = image;
        preview.replaceChildren(image);
        downloadButton.disabled = false;
        message('Preview ready.');
      } catch (error) {
        if (overlay.hidden || request !== version) return;
        message(error.message || 'The schedule image could not be prepared.', true);
        showAppToast(status.textContent, 'error');
      }
    }
    function open() {
      if (openButton.disabled) return;
      dialog.querySelector('input[name="timetable-export-layout"][value="mobile"]').checked = true;
      dialog.querySelector('input[name="timetable-export-theme"][value="light"]').checked = true;
      previousOverflow = document.body.style.overflow;
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
      document.getElementById('timetable-export-title').focus();
      updatePreview();
    }
    async function download() {
      if (!canvas || busy) return;
      busy = true;
      downloadButton.disabled = true;
      const request = version;
      try {
        const blob = await new Promise((resolve, reject) => canvas.toBlob(result =>
          result ? resolve(result) : reject(new Error('The PNG could not be created.')), 'image/png'));
        if (overlay.hidden || request !== version) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Academix-Schedule-${getSnapshot().weekStart}-${choice('layout')}-${choice('theme')}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (error) {
        message(error.message || 'The schedule could not be downloaded.', true);
        showAppToast(status.textContent, 'error');
      } finally {
        busy = false;
        if (!overlay.hidden && canvas && request === version) downloadButton.disabled = false;
      }
    }

    openButton.addEventListener('click', open);
    document.getElementById('timetable-export-close').addEventListener('click', close);
    document.getElementById('timetable-export-cancel').addEventListener('click', close);
    downloadButton.addEventListener('click', download);
    radios.forEach(radio => radio.addEventListener('change', updatePreview));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [document.getElementById('timetable-export-title'),
        ...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !overlay.hidden) close(); });
    return { setAvailable(available) { openButton.disabled = !available; if (!available) close(); } };
  }

  window.AcademixTimetableExport = { init, render };
})();
