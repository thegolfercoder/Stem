/* Hover on the trend charts. An SVG chart in a browser is interactive whether or
   not anybody planned for it to be, so it may as well answer the obvious
   question: which swing was that point? */

(function () {
  document.querySelectorAll('.trend').forEach(figure => {
    const svg = figure.querySelector('svg');
    const tip = figure.querySelector('.trend-tip');
    const dots = Array.from(figure.querySelectorAll('.trend-dot'));
    const unit = figure.dataset.unit || '';
    let points = [];
    try { points = JSON.parse(figure.dataset.points); } catch (e) { return; }
    if (!points.length) return;

    function nearest(clientX) {
      const box = svg.getBoundingClientRect();
      const fraction = (clientX - box.left) / box.width;
      const index = Math.round(fraction * (points.length - 1));
      return Math.max(0, Math.min(points.length - 1, index));
    }

    function move(event) {
      const i = nearest(event.clientX);
      const point = points[i];
      const dot = dots[i];
      dots.forEach(d => d.classList.remove('hot'));
      if (dot) dot.classList.add('hot');

      const figureBox = figure.getBoundingClientRect();
      const dotBox = dot ? dot.getBoundingClientRect() : null;
      tip.hidden = false;
      tip.innerHTML =
        '<b>' + point.value.toFixed(2) + (unit ? ' ' + unit : '') + '</b>' +
        '<span>' + point.name + ' · ' + point.when + '</span>';
      if (dotBox) {
        tip.style.left = (dotBox.left - figureBox.left + dotBox.width / 2) + 'px';
        tip.style.top = (dotBox.top - figureBox.top) + 'px';
      }
    }

    svg.addEventListener('mousemove', move);
    svg.addEventListener('mouseleave', () => {
      tip.hidden = true;
      dots.forEach(d => d.classList.remove('hot'));
    });
  });
})();
