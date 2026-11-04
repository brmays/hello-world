(function () {
  'use strict';

  const VERSION = 'test-1';
  const FILES = ["./index.html", "./app.js", "./styles.css", "./manifest.webmanifest", "./flags/austria.svg", "./flags/belgium.svg", "./flags/bulgaria.svg", "./flags/estonia.svg", "./flags/france.svg", "./flags/germany.svg", "./flags/hungary.svg", "./flags/ireland.svg", "./flags/italy.svg", "./flags/japan.svg", "./flags/lithuania.svg", "./flags/netherlands.svg", "./flags/romania.svg", "./flags/russia.svg", "./flags/ukraine.svg", "./audio/sound-a.mp3", "./audio/sound-b.mp3", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"];
  const FLAGS = [{"name": "Austria", "file": "flags/austria.svg"}, {"name": "Belgium", "file": "flags/belgium.svg"}, {"name": "Bulgaria", "file": "flags/bulgaria.svg"}, {"name": "Estonia", "file": "flags/estonia.svg"}, {"name": "France", "file": "flags/france.svg"}, {"name": "Germany", "file": "flags/germany.svg"}, {"name": "Hungary", "file": "flags/hungary.svg"}, {"name": "Ireland", "file": "flags/ireland.svg"}, {"name": "Italy", "file": "flags/italy.svg"}, {"name": "Japan", "file": "flags/japan.svg"}, {"name": "Lithuania", "file": "flags/lithuania.svg"}, {"name": "Netherlands", "file": "flags/netherlands.svg"}, {"name": "Romania", "file": "flags/romania.svg"}, {"name": "Russia", "file": "flags/russia.svg"}, {"name": "Ukraine", "file": "flags/ukraine.svg"}];
  const INLINE = window.INLINE_ASSETS || null;
  const SINGLE_FILE = !!INLINE;
  const COUNTDOWN_SECONDS = 13;
  const TOP_POINTS = 1000;
  const FLOOR_POINTS = 250;
  const WIN_POINTS = 1000;

  const $ = (id) => document.getElementById(id);
  const assetUrl = (path) => (INLINE ? INLINE[path] : path);

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* storage blocked */ } },
  };

  const state = {
    secure: window.isSecureContext,
    standalone: window.navigator.standalone === true ||
      (window.matchMedia && matchMedia('(display-mode: standalone)').matches),
    swSupported: 'serviceWorker' in navigator,
    swError: '',
    controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    savedCount: null,
    serverReachable: null,
    launchChecked: false,
    launchedOffline: false,
    offlineLaunches: Number(store.get('offlineLaunches') || 0),
    countedThisLaunch: false,
    storage: '',
    heard: { a: null, b: null },
    roundDone: false,
  };

  // ---------- Checks and verdict ----------

  function row(ok, label, value) {
    const mark = ok === true ? ['✓', 'good'] : ok === false ? ['✗', 'bad'] : ok === 'warn' ? ['!', 'warn'] : ['…', 'wait'];
    return '<li><span class="mark ' + mark[1] + '">' + mark[0] + '</span><span>' + label +
      '</span><span class="value">' + (value || '') + '</span></li>';
  }

  function renderChecks() {
    const total = FILES.length;
    const reach = state.serverReachable;
    const rows = [row(true, 'Scripts are running', '')];
    if (SINGLE_FILE) {
      rows.push(row(true, 'Running from the single copied file', ''));
    } else {
      const installed = state.savedCount === total;
      rows.push(
        row(state.secure, 'Secure (HTTPS) page', location.protocol.replace(':', '')),
        row(state.standalone ? true : 'warn', 'Opened from Home Screen', state.standalone ? 'Yes' : 'No, in browser'),
        row(state.swSupported ? true : false, 'Offline support available', state.swSupported ? 'Yes' : 'Blocked'),
        row(state.swError ? false : state.controlled ? true : null, 'Offline support active', state.swError || (state.controlled ? 'Yes' : 'Starting')),
        row(state.savedCount === null ? null : installed, 'All files saved on this iPad', (state.savedCount === null ? '?' : state.savedCount) + ' of ' + total),
        row(reach === null ? null : reach ? 'warn' : true, 'Server unreachable (truly offline)', reach === null ? 'Checking' : reach ? 'Still online' : 'Offline'),
        row(state.offlineLaunches > 0 ? true : 'warn', 'Offline launches from Home Screen', String(state.offlineLaunches))
      );
      if (state.storage) rows.push(row(true, 'Storage used', state.storage));
    }
    rows.push(
      row(state.heard.a === null ? null : state.heard.a, 'Sound A heard', state.heard.a === null ? 'Not tested' : state.heard.a ? 'Yes' : 'No'),
      row(state.heard.b === null ? null : state.heard.b, 'Sound B heard', state.heard.b === null ? 'Not tested' : state.heard.b ? 'Yes' : 'No'),
      row(state.roundDone ? true : null, 'Game round finished', state.roundDone ? 'Yes' : 'Not tested')
    );
    $('checks').innerHTML = rows.join('');
  }

  function setVerdict(kind, title, next) {
    $('verdict').className = 'verdict ' + kind;
    $('verdict-title').textContent = title;
    $('verdict-next').textContent = next;
  }

  function renderVerdict() {
    const soundOk = state.heard.a === true || state.heard.b === true;
    const allTested = soundOk && state.roundDone;

    if (SINGLE_FILE) {
      if (allTested) setVerdict('good', 'PASS: the copied file works', 'Scripts, sound and tapping all work from the copied file. Take a screenshot.');
      else setVerdict('warn', 'Scripts run from the copied file', 'Now test both sounds and play one round below. Open it again after turning Wi-Fi off.');
      return;
    }
    if (!state.secure) return setVerdict('bad', 'This address isn’t secure', 'Offline support needs an https:// address.');
    if (!state.swSupported) return setVerdict('bad', 'Offline support is blocked', 'This iPad won’t allow this route. Take a screenshot.');
    if (state.swError) return setVerdict('bad', 'Saving for offline failed', state.swError + ' Take a screenshot.');

    const saved = state.controlled && state.savedCount === FILES.length;
    if (!saved) return setVerdict('warn', 'Saving files to this iPad…', 'Stay online and keep this page open until this changes.');
    if (state.serverReachable === null) return setVerdict('warn', 'Checking the connection…', 'One moment.');

    // Only a launch that began offline counts: a page already open proves nothing.
    if (state.standalone && state.launchedOffline) {
      if (allTested) return setVerdict('good', 'PASS: works offline from the Home Screen', 'This route works on this iPad. Take a screenshot.');
      return setVerdict('good', 'Opened offline from the Home Screen', 'Now test both sounds and play one round below to finish.');
    }
    if (state.serverReachable === false && !state.launchedOffline) {
      return setVerdict('warn', 'Offline now. Close and reopen it.', 'This page was already open, so it doesn’t count yet. Close it completely, then open it again.');
    }
    if (state.standalone) return setVerdict('warn', 'Installed. Now go offline.', 'Turn Wi-Fi off, close this app completely, then open it again from the Home Screen.');
    if (state.launchedOffline) return setVerdict('warn', 'Works offline in Safari only so far', 'Go back online, add it to the Home Screen, and repeat the test from the icon.');
    return setVerdict('warn', 'Files saved. Add it to the Home Screen.', 'Share → Add to Home Screen, then open the new icon once while still online.');
  }

  function render() { renderChecks(); renderVerdict(); }

  // ---------- Offline setup ----------

  async function countSaved() {
    if (!window.caches) return;
    try {
      const cache = await caches.open('offline-tester-' + VERSION);
      const keys = await cache.keys();
      state.savedCount = Math.min(keys.length, FILES.length);
    } catch (e) {
      state.savedCount = null;
    }
    state.controlled = !!navigator.serviceWorker.controller;
  }

  async function pingServer() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch('ping.txt?t=' + Date.now(), { cache: 'no-store', signal: controller.signal });
      state.serverReachable = response.ok;
    } catch (e) {
      state.serverReachable = false;
    }
    clearTimeout(timer);
  }

  function countOfflineLaunch() {
    if (!state.launchChecked) {
      state.launchChecked = true;
      state.launchedOffline = state.serverReachable === false && state.controlled;
    }
    if (state.countedThisLaunch || !state.standalone || !state.launchedOffline) return;
    state.countedThisLaunch = true;
    state.offlineLaunches += 1;
    store.set('offlineLaunches', String(state.offlineLaunches));
  }

  async function readStorage() {
    if (!navigator.storage || !navigator.storage.estimate) return;
    try {
      const estimate = await navigator.storage.estimate();
      state.storage = (estimate.usage / 1048576).toFixed(1) + ' MB';
    } catch (e) { /* not available */ }
  }

  async function refresh() {
    await Promise.all([countSaved(), pingServer(), readStorage()]);
    countOfflineLaunch();
    render();
  }

  async function setupOffline() {
    if (!state.secure || !state.swSupported) return;
    try {
      await navigator.serviceWorker.register('sw.js');
      navigator.serviceWorker.addEventListener('controllerchange', refresh);
      await navigator.serviceWorker.ready;
    } catch (e) {
      // Offline, re-registering can fail on the update check; an active offline copy still counts.
      if (!navigator.serviceWorker.controller) state.swError = (e && e.message) || 'Registration failed.';
    }
    await refresh();
  }

  // ---------- Audio ----------

  let audioContext = null;
  const decoded = {};

  function unlockAudio() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!audioContext) audioContext = new Ctor();
    if (audioContext.state !== 'running') audioContext.resume();
    return audioContext;
  }

  async function readBytes(path) {
    const url = assetUrl(path);
    if (url.startsWith('data:')) {
      const binary = atob(url.slice(url.indexOf(',') + 1));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load sound');
    return response.arrayBuffer();
  }

  function playWebAudio(path) {
    const context = unlockAudio();
    if (!context) return Promise.reject(new Error('Web Audio unavailable'));
    return (async () => {
      if (!decoded[path]) {
        const bytes = await readBytes(path);
        decoded[path] = await new Promise((resolve, reject) => context.decodeAudioData(bytes, resolve, reject));
      }
      await new Promise((resolve) => {
        const source = context.createBufferSource();
        source.buffer = decoded[path];
        source.connect(context.destination);
        source.onended = resolve;
        source.start(0);
      });
    })();
  }

  function playElement(path) {
    return new Promise((resolve, reject) => {
      const audio = new Audio(assetUrl(path));
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Audio player error'));
      const started = audio.play();
      if (started && started.catch) started.catch(reject);
    });
  }

  function wireSound(id, statusId, play) {
    $(id).addEventListener('click', async () => {
      $(statusId).textContent = 'Playing…';
      try {
        await play();
        $(statusId).textContent = 'Finished playing. Did you hear it?';
      } catch (e) {
        $(statusId).textContent = 'Failed: ' + ((e && e.message) || 'unknown error');
      }
    });
  }

  wireSound('sound-a', 'sound-a-status', () => playElement('audio/sound-a.mp3'));
  wireSound('sound-b', 'sound-b-status', () => playWebAudio('audio/sound-b.mp3'));

  document.querySelectorAll('.heard').forEach((group) => {
    group.addEventListener('click', (event) => {
      const answer = event.target.getAttribute('data-heard');
      if (!answer) return;
      const sound = group.getAttribute('data-sound');
      state.heard[sound] = answer === 'yes';
      $('sound-' + sound + '-status').textContent = answer === 'yes' ? 'Marked as heard.' : 'Marked as silent.';
      render();
    });
  });

  // ---------- Game flow ----------

  const round = { active: false, accepting: false, target: null, frame: 0, removeTimer: 0, startedAt: 0, points: TOP_POINTS, total: 0 };
  const flagButtons = {};

  function buildFlags() {
    FLAGS.forEach((flag) => {
      const button = document.createElement('button');
      button.className = 'flag';
      button.disabled = true;
      button.setAttribute('aria-label', flag.name);
      const image = document.createElement('img');
      image.alt = flag.name;
      image.src = assetUrl(flag.file);
      button.appendChild(image);
      button.addEventListener('click', () => answer(flag.name));
      $('flags').appendChild(button);
      flagButtons[flag.name] = button;
    });
  }

  function setFlagsEnabled(enabled) {
    Object.values(flagButtons).forEach((button) => { button.disabled = !enabled; });
  }

  function stopTimers() {
    cancelAnimationFrame(round.frame);
    clearInterval(round.removeTimer);
  }

  function tick() {
    const elapsed = (performance.now() - round.startedAt) / 1000;
    const span = TOP_POINTS - FLOOR_POINTS;
    round.points = Math.max(FLOOR_POINTS, Math.round(TOP_POINTS - span * (elapsed / COUNTDOWN_SECONDS)));
    $('points').textContent = round.points;
    if (round.accepting) round.frame = requestAnimationFrame(tick);
  }

  function removeOneWrongFlag() {
    const visibleWrong = FLAGS.filter((flag) => flag.name !== round.target && !flagButtons[flag.name].classList.contains('gone'));
    if (visibleWrong.length <= 1) {
      clearInterval(round.removeTimer);
      return;
    }
    const pick = visibleWrong[Math.floor(Math.random() * visibleWrong.length)];
    flagButtons[pick.name].classList.add('gone');
  }

  async function startRound() {
    if (round.active) return;
    round.active = true;
    unlockAudio();
    $('round-start').disabled = true;
    Object.values(flagButtons).forEach((button) => button.classList.remove('gone', 'right', 'wrong'));
    setFlagsEnabled(false);
    round.points = TOP_POINTS;
    $('points').textContent = TOP_POINTS;
    round.target = FLAGS[Math.floor(Math.random() * FLAGS.length)].name;
    $('prompt').textContent = 'Listen…';
    try {
      await playWebAudio('audio/sound-a.mp3');
    } catch (e) {
      try { await playElement('audio/sound-a.mp3'); } catch (e2) { /* continue without sound */ }
    }
    $('prompt').textContent = 'Find: ' + round.target;
    round.accepting = true;
    round.startedAt = performance.now();
    setFlagsEnabled(true);
    round.frame = requestAnimationFrame(tick);
    round.removeTimer = setInterval(removeOneWrongFlag, 1000);
  }

  function answer(name) {
    if (!round.accepting) return;
    round.accepting = false;
    stopTimers();
    setFlagsEnabled(false);
    flagButtons[round.target].classList.add('right');
    const correct = name === round.target;
    if (correct) {
      round.total += round.points;
    } else {
      flagButtons[name].classList.add('wrong');
    }
    $('total').textContent = round.total;
    const won = round.total >= WIN_POINTS;
    $('prompt').textContent = won
      ? 'You win! ' + round.total + ' points.'
      : correct ? 'Correct: +' + round.points + ' points.' : 'Wrong. The answer was ' + round.target + '. +0 points.';
    if (won) round.total = 0;
    round.active = false;
    $('round-start').disabled = false;
    $('round-start').textContent = won ? 'New game' : 'Next round';
    state.roundDone = true;
    render();
  }

  $('round-start').addEventListener('click', startRound);

  // ---------- Start ----------

  $('version').textContent = (SINGLE_FILE ? 'Single-file copy' : 'Installable web app') + ' · ' + VERSION;
  buildFlags();
  render();
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !SINGLE_FILE) refresh(); });
  if (!SINGLE_FILE) setupOffline();
})();
