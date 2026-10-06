/* The page, kept on this device so it works at a range with no signal (#61).
 *
 * build_artifact.py fills in the version and every file of the site with its
 * SHA-256. Installing fetches each one and checks it before keeping any: a file
 * that does not match (a damaged download, a model that is not the pinned one)
 * keeps nothing, and the page is told which file it was. Requests are answered
 * from the kept copy first, so the page and its pose estimator load offline.
 *
 * A new version waits. It takes over only when the golfer chooses to reload,
 * never in the middle of a swing or a session.
 */

const VERSION = "/*__VERSION__*/";
const FILES = /*__FILES__*/[];
const CACHE = `swing-story-${VERSION}`;

const hex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

async function tell(message) {
  for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage(message);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (const file of FILES) {
        const url = new URL(file.url, self.location).href;
        const response = await fetch(url, { cache: "no-cache" });
        if (!response.ok) throw new Error(`${file.url} could not be fetched (${response.status})`);
        const digest = hex(await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer()));
        if (digest !== file.sha256) throw new Error(`${file.url} did not match its checksum`);
        // The page's own address is its folder as well as index.html.
        if (file.url === "index.html") await cache.put(new URL("./", self.location).href, response.clone());
        await cache.put(url, response);
      }
    } catch (error) {
      await caches.delete(CACHE);
      await tell({ type: "offline-failed", version: VERSION, reason: String(error.message || error) });
      throw error;
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("swing-story-") && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
    await tell({ type: "offline-ready", version: VERSION });
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
  if (event.data && event.data.type === "version") event.source.postMessage({ type: "offline-ready", version: VERSION });
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const kept = await cache.match(request, { ignoreSearch: true });
    return kept || fetch(request);
  })());
});
