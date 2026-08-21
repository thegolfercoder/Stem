/* Uploading, and showing honest progress while the analysis runs.
   The bar tracks frames actually processed. Where the container does not declare
   a frame count it becomes indeterminate rather than inventing a percentage. */

(function () {
  const form = document.getElementById('upload');
  const input = document.getElementById('file');
  const browse = document.getElementById('browse');
  const queue = document.getElementById('queue');
  if (!form || !input) return;

  const jobs = new Map();

  browse.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    for (const file of input.files) send(file);
    input.value = '';
  });

  ['dragenter', 'dragover'].forEach(type =>
    form.addEventListener(type, e => { e.preventDefault(); form.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(type =>
    form.addEventListener(type, e => { e.preventDefault(); form.classList.remove('over'); }));
  form.addEventListener('drop', e => {
    for (const file of e.dataTransfer.files) send(file);
  });
  form.addEventListener('submit', e => e.preventDefault());

  function send(file) {
    const data = new FormData();
    data.append('video', file);
    data.append('handedness', document.getElementById('handedness').value);
    data.append('club', document.getElementById('club').value);
    data.append('label', document.getElementById('label').value);

    const card = addCard(file.name);
    card.querySelector('.job-state').textContent = 'uploading';

    fetch('/api/analyse', { method: 'POST', body: data })
      .then(async r => {
        const payload = await r.json();
        if (!r.ok) throw new Error(payload.error || 'upload failed');
        return payload;
      })
      .then(job => {
        jobs.set(job.id, card);
        poll(job.id);
      })
      .catch(err => fail(card, err.message));
  }

  function addCard(name) {
    queue.hidden = false;
    const card = document.createElement('div');
    card.className = 'job';
    card.innerHTML =
      '<div class="job-top"><span class="job-name"></span><span class="job-state"></span></div>' +
      '<div class="bar indeterminate"><i></i></div>';
    card.querySelector('.job-name').textContent = name;
    queue.prepend(card);
    return card;
  }

  function fail(card, message) {
    card.classList.add('job-failed');
    card.querySelector('.job-state').textContent = message;
    card.querySelector('.bar').remove();
  }

  const WORDS = {
    queued: 'queued',
    reading: 'finding the body in each frame',
    analysing: 'finding the swing',
    rendering: 'saving key frames',
    done: 'done',
    failed: 'failed'
  };

  function poll(id) {
    const card = jobs.get(id);
    fetch('/api/jobs/' + id)
      .then(r => r.json())
      .then(job => {
        if (job.error) return fail(card, job.error);

        const bar = card.querySelector('.bar');
        const fill = bar.querySelector('i');
        let text = WORDS[job.state] || job.state;
        if (job.state === 'reading' && job.frames_done) {
          text = job.frames_expected
            ? `frame ${job.frames_done} of ${job.frames_expected}`
            : `${job.frames_done} frames read`;
        }
        card.querySelector('.job-state').textContent = text;

        if (job.progress > 0) {
          bar.classList.remove('indeterminate');
          fill.style.width = (job.progress * 100).toFixed(1) + '%';
        }

        if (job.state === 'done') {
          fill.style.width = '100%';
          if (job.swing_id) {
            window.location.href = '/swing/' + job.swing_id;
          }
          return;
        }
        setTimeout(() => poll(id), 500);
      })
      .catch(() => setTimeout(() => poll(id), 1500));
  }
})();
