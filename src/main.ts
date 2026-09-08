import './ui/styles.css';

import { App } from './ui/app.js';

const canvas = document.getElementById('cube');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('the page is missing its cube canvas');
}
new App(canvas);
