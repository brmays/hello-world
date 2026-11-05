// Bump VERSION on every deploy so iPads save the new files on their next online launch.
const VERSION = 'game-2';
const CACHE = 'flag-game-' + VERSION;
// Only caches with these prefixes belong to this app; other github.io projects share the origin.
const OWN_CACHE_PREFIXES = ['flag-game-', 'offline-tester-'];

const COUNTRY_IDS = ['japan', 'france', 'germany', 'italy', 'south-korea', 'spain', 'norway',
  'philippines', 'thailand', 'egypt', 'iran', 'vietnam', 'indonesia', 'kenya', 'taiwan'];

const FILES = [
  './index.html', './styles.css', './countries.js', './app.js', './manifest.webmanifest',
  './img/world.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  ...COUNTRY_IDS.map((id) => './flags/' + id + '.svg'),
  ...COUNTRY_IDS.map((id) => './audio/' + id + '.mp3'),
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(FILES.map(async (file) => {
      // The query string and cache: 'reload' skip both the CDN and browser caches,
      // so a half-updated host can't mix old and new files into the offline copy.
      const response = await fetch(new Request(file + '?v=' + VERSION, { cache: 'reload' }));
      if (!response.ok) throw new Error('Could not save ' + file);
      await cache.put(file, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const stale = names.filter((name) => name !== CACHE &&
      OWN_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)));
    await Promise.all(stale.map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// The page asks how many files are saved, for the "Ready to play offline" check.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'status' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const keys = await (await caches.open(CACHE)).keys();
    event.ports[0].postMessage({ version: VERSION, saved: keys.length, total: FILES.length });
  })());
});

// Safari asks for audio in byte ranges and rejects a plain 200 from a service worker.
async function rangeResponse(request, cached) {
  const buffer = await cached.arrayBuffer();
  const match = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  const size = buffer.byteLength;
  let start = 0;
  let end = size - 1;
  if (match) {
    if (match[1] === '' && match[2] !== '') {
      start = Math.max(size - Number(match[2]), 0);
    } else {
      start = Number(match[1] || 0);
      if (match[2] !== '') end = Math.min(Number(match[2]), size - 1);
    }
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  return new Response(buffer.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let cached = await cache.match(event.request, { ignoreSearch: true });
    if (!cached && event.request.mode === 'navigate') cached = await cache.match('./index.html');
    if (cached) {
      return event.request.headers.has('range') ? rangeResponse(event.request, cached) : cached;
    }
    return fetch(event.request);
  })());
});
