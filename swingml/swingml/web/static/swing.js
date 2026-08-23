/* The swing page: a frame-accurate scrubber, and the eight positions wired to it.

   Built on still images rather than a video element on purpose. Browsers cannot
   play every codec a phone produces, and video seeking is not frame accurate -
   which is the one thing somebody studying a swing needs it to be. */

(function () {
  const readJson = id => {
    const node = document.getElementById(id);
    if (!node) return [];
    try { return JSON.parse(node.textContent); } catch (e) { return []; }
  };

  const seq = readJson('seq-data');
  const events = readJson('event-data');
  const img = document.getElementById('scrub-img');
  const range = document.getElementById('scrub-range');
  const play = document.getElementById('scrub-play');
  const timeOut = document.getElementById('scrub-time');
  const eventOut = document.getElementById('scrub-event');
  const marks = document.getElementById('scrub-marks');
  const frames = Array.from(document.querySelectorAll('.frame'));

  let index = 0, timer = null;

  if (seq.length && img) {
    // Preload so scrubbing never shows a gap.
    seq.forEach(item => { const p = new Image(); p.src = mediaUrl(item.name); });

    // Put a mark on the bar for each of the eight positions.
    events.forEach(ev => {
      const at = nearestIndex(ev.time_s);
      const pct = seq.length > 1 ? (at / (seq.length - 1)) * 100 : 0;
      const mark = document.createElement('button');
      mark.className = 'scrub-mark';
      mark.style.setProperty('--at', pct + '%');
      mark.title = ev.label;
      mark.innerHTML = '<span>' + ev.label + '</span>';
      mark.addEventListener('click', () => show(at));
      marks.appendChild(mark);
    });

    show(0);
    range.addEventListener('input', () => show(parseInt(range.value, 10)));
    play.addEventListener('click', toggle);

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
      if (e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }

  function mediaUrl(name) {
    return '/media/' + window.SWING_ID + '/' + name;
  }

  function nearestIndex(time) {
    let best = 0, gap = Infinity;
    seq.forEach((item, i) => {
      const d = Math.abs(item.time_s - time);
      if (d < gap) { gap = d; best = i; }
    });
    return best;
  }

  function labelAt(i) {
    const match = events.find(ev => nearestIndex(ev.time_s) === i);
    return match ? match.label : '';
  }

  function show(i) {
    if (!seq.length) return;
    index = Math.max(0, Math.min(seq.length - 1, i));
    const item = seq[index];
    img.src = mediaUrl(item.name);
    range.value = index;
    timeOut.textContent = item.time_s.toFixed(3);
    const label = labelAt(index);
    eventOut.textContent = label ? ' · ' + label : '';
    eventOut.classList.toggle('is-event', Boolean(label));
    frames.forEach(f => {
      f.classList.toggle('active', nearestIndex(parseFloat(f.dataset.time)) === index);
    });
  }

  function toggle() {
    if (timer) { stop(); return; }
    play.textContent = 'Pause';
    if (index >= seq.length - 1) index = 0;
    timer = setInterval(() => {
      if (index >= seq.length - 1) { stop(); return; }
      show(index + 1);
    }, 55);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    play.textContent = 'Play';
  }

  frames.forEach(frame => {
    const jump = () => { stop(); show(nearestIndex(parseFloat(frame.dataset.time))); };
    frame.addEventListener('click', jump);
    frame.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
    });
  });

  const save = document.getElementById('save');
  if (save) {
    save.addEventListener('click', () => {
      save.textContent = 'saving…';
      fetch('/api/swings/' + window.SWING_ID, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ club: document.getElementById('club').value })
      }).then(() => { save.textContent = 'Saved'; setTimeout(() => save.textContent = 'Save', 1400); })
        .catch(() => save.textContent = 'Failed');
    });
  }

  const del = document.getElementById('delete');
  if (del) {
    del.addEventListener('click', () => {
      if (!confirm('Delete this swing? The analysis and its saved frames go with it.')) return;
      fetch('/api/swings/' + window.SWING_ID, { method: 'DELETE' })
        .then(() => window.location.href = '/');
    });
  }
})();
