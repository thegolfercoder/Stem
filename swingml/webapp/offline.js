/* Installing the page and using it offline (#61): the page's side of sw.js.
 *
 * Only a site build served over http(s) asks for it (`SWING_ASSETS.offline`, set
 * by build_artifact.py); the one-file page and a page opened from disk carry on as
 * before. The page says when it is kept for offline use, says why when it could
 * not be, and offers a newer version as a reload the golfer chooses.
 */

export function offlineSupported(assets, where = globalThis) {
  return Boolean(assets && assets.offline && where.navigator && "serviceWorker" in where.navigator &&
    /^https?:$/.test(where.location.protocol));
}

export function wireOffline(assets, ui) {
  if (!offlineSupported(assets)) return false;
  for (const [tag, attrs] of [["link", { rel: "manifest", href: "manifest.webmanifest" }],
                              ["meta", { name: "theme-color", content: "#0e1014" }]]) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    document.head.appendChild(node);
  }
  const worker = navigator.serviceWorker;
  let waiting = null, reloading = false;
  const offerUpdate = (next) => {
    waiting = next;
    ui.update.hidden = false;
  };
  worker.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type === "offline-ready") {
      ui.status.hidden = false;
      ui.status.textContent = "Available offline";
      ui.status.dataset.version = data.version;
      ui.status.classList.remove("offline-failed");
    } else if (data.type === "offline-failed") {
      ui.status.hidden = false;
      ui.status.textContent = `Not saved for offline use: ${data.reason}`;
      ui.status.classList.add("offline-failed");
    }
  });
  ui.reload.addEventListener("click", () => {
    if (!waiting) return;
    worker.addEventListener("controllerchange", () => {
      if (!reloading) { reloading = true; location.reload(); }
    });
    waiting.postMessage({ type: "skip-waiting" });
  });
  worker.register("sw.js").then((registration) => {
    if (registration.waiting && worker.controller) offerUpdate(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const next = registration.installing;
      next.addEventListener("statechange", () => {
        // Installed beside a version already in use: wait for the golfer.
        if (next.state === "installed" && worker.controller) offerUpdate(next);
      });
    });
    if (registration.active) registration.active.postMessage({ type: "version" });
  }).catch((error) => {
    // A host that does not allow it (a sandboxed frame, say): the page works as it
    // always did, online, and says nothing about offline use.
    console.info("Offline use is not available here:", error && error.message);
  });
  return true;
}
