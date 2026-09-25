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
  // Where the eight positions currently sit, as tracked-frame numbers. Starts
  // where the page put them and moves as the golfer sets them.
  const current = events.map(ev => ({ label: ev.label, frame: ev.frame }));

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

    drawMarks();
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

  function indexOfFrame(frame) {
    let best = 0, gap = Infinity;
    seq.forEach((item, i) => {
      const d = Math.abs(item.frame - frame);
      if (d < gap) { gap = d; best = i; }
    });
    return best;
  }

  // A mark on the bar for each of the eight positions.
  function drawMarks() {
    marks.innerHTML = '';
    current.forEach(pos => {
      const at = indexOfFrame(pos.frame);
      const pct = seq.length > 1 ? (at / (seq.length - 1)) * 100 : 0;
      const mark = document.createElement('button');
      mark.className = 'scrub-mark';
      mark.style.setProperty('--at', pct + '%');
      mark.title = pos.label;
      mark.innerHTML = '<span>' + pos.label + '</span>';
      mark.addEventListener('click', () => show(at));
      marks.appendChild(mark);
    });
  }

  function labelAt(i) {
    const match = current.find(pos => indexOfFrame(pos.frame) === i);
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

  // Setting the positions by hand. Every change is checked for swing order
  // here and again by the server, which re-measures the swing from them.
  const editor = document.getElementById('pos-editor');
  if (editor && seq.length) {
    const which = document.getElementById('pos-event');
    const setBtn = document.getElementById('pos-set');
    const saveBtn = document.getElementById('pos-save');
    const resetBtn = document.getElementById('pos-reset');
    const confirmBox = document.getElementById('pos-label');
    const status = document.getElementById('pos-status');
    let changed = false;

    const say = (text, bad) => {
      status.textContent = text;
      status.classList.toggle('is-bad', Boolean(bad));
    };

    setBtn.addEventListener('click', () => {
      const i = parseInt(which.value, 10);
      const frame = seq[index].frame;
      if (i > 0 && frame <= current[i - 1].frame) {
        say(current[i].label + ' has to come after ' + current[i - 1].label + '.', true);
        return;
      }
      if (i < current.length - 1 && frame >= current[i + 1].frame) {
        say(current[i].label + ' has to come before ' + current[i + 1].label + '.', true);
        return;
      }
      current[i].frame = frame;
      changed = true;
      drawMarks();
      show(index);
      say(current[i].label + ' set. Save to re-measure the swing.');
      if (i < current.length - 1) which.value = String(i + 1);
    });

    which.addEventListener('change', () => {
      stop();
      show(indexOfFrame(current[parseInt(which.value, 10)].frame));
    });

    saveBtn.addEventListener('click', () => {
      if (!changed && !confirmBox.checked) {
        say('Move a position, or tick the box to confirm all eight, first.', true);
        return;
      }
      saveBtn.disabled = true;
      say('Re-measuring…');
      fetch('/api/swings/' + window.SWING_ID + '/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: current.map(pos => pos.frame),
          training_label: confirmBox.checked
        })
      }).then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok) throw new Error(body.error || 'could not save');
          window.location.reload();
        })
        .catch(err => { saveBtn.disabled = false; say(err.message, true); });
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!confirm("Put the model's positions and measurements back?")) return;
        fetch('/api/swings/' + window.SWING_ID + '/positions', { method: 'DELETE' })
          .then(() => window.location.reload());
      });
    }
  }

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
