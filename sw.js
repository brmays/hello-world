const VERSION = 'test-1';
const CACHE = 'offline-tester-' + VERSION;
const FILES = ["./index.html", "./app.js", "./styles.css", "./manifest.webmanifest", "./flags/austria.svg", "./flags/belgium.svg", "./flags/bulgaria.svg", "./flags/estonia.svg", "./flags/france.svg", "./flags/germany.svg", "./flags/hungary.svg", "./flags/ireland.svg", "./flags/italy.svg", "./flags/japan.svg", "./flags/lithuania.svg", "./flags/netherlands.svg", "./flags/romania.svg", "./flags/russia.svg", "./flags/ukraine.svg", "./audio/sound-a.mp3", "./audio/sound-b.mp3", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Bypass the HTTP cache so a half-updated host can't poison the offline copy.
    await Promise.all(FILES.map(async (file) => {
      const response = await fetch(new Request(file, { cache: 'reload' }));
      if (!response.ok) throw new Error('Could not save ' + file);
      await cache.put(file, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
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
  // ping.txt always goes to the network: it is how the page proves it is really offline.
  if (url.pathname.endsWith('/ping.txt')) return;

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
