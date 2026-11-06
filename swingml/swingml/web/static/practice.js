/* Starting a practice plan, closing it, and saying how it went. */

(function () {
  const status = document.getElementById('plan-status');
  const say = (text) => { if (status) status.textContent = text; };

  document.querySelectorAll('.start-plan').forEach(button => {
    button.addEventListener('click', () => {
      button.disabled = true;
      say('Starting…');
      const from = parseInt(button.dataset.from, 10);
      fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focus: button.dataset.focus, from_swing: Number.isNaN(from) ? null : from })
      }).then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok) throw new Error(body.error || 'could not start the plan');
          window.location.href = '/practice';
        })
        .catch(err => { button.disabled = false; say(err.message); });
    });
  });

  document.querySelectorAll('.close-plan').forEach(button => {
    button.addEventListener('click', () => {
      const verb = button.dataset.status === 'completed' ? 'Finish' : 'Stop';
      if (!confirm(verb + ' this plan? Its swings and the comparison are kept.')) return;
      fetch('/api/plans/' + button.dataset.plan + '/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: button.dataset.status })
      }).then(() => window.location.reload());
    });
  });

  const form = document.getElementById('feedback');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const useful = form.querySelector('input[name=useful]:checked');
      fetch('/api/plans/' + form.dataset.plan + '/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useful: useful ? parseInt(useful.value, 10) : null,
                               feel: form.querySelector('textarea').value })
      }).then(r => {
        form.querySelector('.feedback-status').textContent = r.ok ? 'Thanks, saved.' : 'Could not save.';
        if (r.ok) form.reset();
      });
    });
  }

  const erase = document.getElementById('erase');
  if (erase) {
    erase.addEventListener('click', () => {
      const typed = document.getElementById('erase-confirm').value;
      fetch('/api/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: typed })
      }).then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          document.getElementById('erase-status').textContent =
            ok ? 'Deleted ' + body.swings_deleted + ' swings and every file.' : body.error;
          if (ok) setTimeout(() => window.location.href = '/', 1200);
        });
    });
  }
})();
