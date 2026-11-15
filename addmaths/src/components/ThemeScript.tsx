/**
 * Applies the saved theme before first paint. Inline and synchronous on
 * purpose: anything asynchronous shows a white flash to a reader who chose
 * dark mode.
 */
const SCRIPT = `(function(){try{var s=localStorage.getItem('addmaths-theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(s==='dark'||(s!=='light'&&m)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
