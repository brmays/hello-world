(function () {
  'use strict';

  const COUNTDOWN_SECONDS = 13;    // points fall from TOP to FLOOR over this time
  const TOP_POINTS = 1000;
  const FLOOR_POINTS = 250;
  const WIN_POINTS = 1000;
  const FLAGS_LEFT_AT_END = 2;     // wrong flags vanish one per second until this many remain
  const AUTO_REPEAT_SECONDS = 6;
  const NEXT_ROUND_DELAY = 2200;
  const COUNTRIES = window.COUNTRIES;

  const $ = (id) => document.getElementById(id);
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* storage blocked */ } },
  };

  const settings = { autoRepeat: store.get('autoRepeat') !== 'off', easy: store.get('mode') === 'easy' };
  const game = { phase: 'idle', total: 0, round: null, roundId: 0, listenId: 0, bag: [], lastId: null, timers: [], frame: 0 };
  const tiles = {};

  // Easy mode plays only the countries marked easy: true in countries.js.
  function activeCountries() {
    return settings.easy ? COUNTRIES.filter((country) => country.easy) : COUNTRIES;
  }
  function gridShape() {
    return settings.easy ? { cols: 4, rows: 2 } : { cols: 5, rows: 3 };
  }

  // ---------- Timers ----------

  function later(fn, ms) { game.timers.push(setTimeout(fn, ms)); }
  function stopEverything() {
    game.timers.forEach(clearTimeout);
    game.timers = [];
    cancelAnimationFrame(game.frame);
    voice.pause();
  }

  // ---------- Greeting audio ----------
  // One audio element for every greeting: once a tap has started it, iOS lets it play
  // again later without another tap, so the next round can start on its own.

  const voice = new Audio();
  voice.preload = 'auto';

  function playVoice(src) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let guard = 0;
      const settle = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        voice.removeEventListener('ended', onEnded);
        voice.removeEventListener('error', onError);
        voice.removeEventListener('loadedmetadata', onMeta);
        if (error) reject(error); else resolve();
      };
      const onEnded = () => settle();
      const onError = () => settle(new Error('Could not play ' + src));
      // Never let a stuck clip hold up the round.
      const onMeta = () => {
        if (!isFinite(voice.duration)) return;
        clearTimeout(guard);
        guard = setTimeout(() => settle(), voice.duration * 1000 + 2500);
      };
      guard = setTimeout(() => settle(), 10000);
      voice.addEventListener('ended', onEnded);
      voice.addEventListener('error', onError);
      voice.addEventListener('loadedmetadata', onMeta);
      voice.pause();
      if (voice.getAttribute('src') !== src) voice.src = src;
      else try { voice.currentTime = 0; } catch (e) { /* not loaded yet */ }
      const started = voice.play();
      if (started && started.catch) started.catch((error) => settle(error));
    });
  }

  // ---------- Sound effects (synthesised, no files) ----------

  const sfx = (() => {
    let context = null;
    function unlock() {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      if (!context) context = new Ctor();
      if (context.state !== 'running') context.resume();
    }
    function tone(freq, at, length, type, volume) {
      if (!context || context.state !== 'running') return;
      const start = context.currentTime + at;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume || 0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(start);
      osc.stop(start + length + 0.05);
    }
    return {
      unlock,
      correct() { tone(660, 0, 0.15, 'triangle'); tone(880, 0.1, 0.15, 'triangle'); tone(1320, 0.2, 0.35, 'triangle'); },
      wrong() { tone(240, 0, 0.22, 'square', 0.1); tone(170, 0.16, 0.35, 'square', 0.1); },
      win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.3, 'triangle')); tone(1047, 0.55, 0.8, 'triangle'); },
    };
  })();

  // ---------- Board ----------

  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function buildTiles() {
    COUNTRIES.forEach((country) => {
      const button = document.createElement('button');
      button.className = 'flag';
      button.disabled = true;
      button.setAttribute('aria-label', country.name);
      const image = document.createElement('img');
      image.src = 'flags/' + country.id + '.svg';
      image.alt = country.name;
      image.draggable = false;
      button.appendChild(image);
      button.addEventListener('click', () => answer(country, button));
      tiles[country.id] = button;
    });
    layoutTiles(activeCountries());
  }

  function layoutTiles(order) {
    const grid = $('flags');
    grid.textContent = '';
    order.forEach((country) => {
      const tile = tiles[country.id];
      tile.classList.remove('gone', 'right', 'wrong');
      grid.appendChild(tile);
    });
  }

  function setTilesEnabled(enabled) {
    Object.values(tiles).forEach((tile) => { tile.disabled = !enabled; });
    $('flags').classList.toggle('waiting', !enabled);
  }

  // Fit the grid of 4:3 tiles (5×3, or 4 + 3 in easy mode) into the space the screen leaves.
  function fitTiles() {
    const { cols, rows } = gridShape();
    const board = $('board').getBoundingClientRect();
    const gap = parseFloat(getComputedStyle($('flags')).columnGap) || 10;
    const byWidth = (board.width - (cols - 1) * gap) / cols;
    const byHeight = ((board.height - (rows - 1) * gap) / rows) * (4 / 3);
    const width = Math.max(60, Math.floor(Math.min(byWidth, byHeight)));
    document.documentElement.style.setProperty('--tile-w', width + 'px');
    $('flags').style.width = cols * width + (cols - 1) * gap + 'px';
  }

  // ---------- HUD ----------

  function setPrompt(text, tone) {
    const prompt = $('prompt');
    prompt.textContent = text;
    prompt.className = 'prompt' + (tone ? ' ' + tone : '');
  }

  function levelFor(points) {
    return points >= 750 ? 'high' : points >= 500 ? 'mid' : 'low';
  }

  function showPoints(points) {
    $('points').textContent = points;
    const bubble = $('points-bubble');
    const level = levelFor(points);
    if (bubble.dataset.level !== level) {
      bubble.dataset.level = level;
      bubble.classList.remove('bump');
      void bubble.offsetWidth;
      bubble.classList.add('bump');
    }
    $('timer-fill').dataset.level = level;
  }

  function showTimer(fraction) {
    $('timer-fill').style.transform = 'scaleX(' + Math.max(0, Math.min(1, fraction)) + ')';
  }

  let shownTotal = 0;
  function showTotal(animate) {
    const from = shownTotal;
    const to = game.total;
    shownTotal = to;
    $('goal-fill').style.width = Math.min(100, (to / WIN_POINTS) * 100) + '%';
    if (!animate || from === to) { $('total').textContent = to; return; }
    const box = $('total').parentElement;
    box.classList.remove('bump');
    void box.offsetWidth;
    box.classList.add('bump');
    const began = performance.now();
    const step = (now) => {
      const t = Math.min(1, secondsSince(began, now) / 0.7);
      $('total').textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function popText(text, anchor, good) {
    const rect = anchor.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'pop ' + (good ? 'good' : 'bad');
    pop.textContent = text;
    pop.style.left = rect.left + rect.width / 2 + 'px';
    pop.style.top = rect.top + rect.height / 2 + 'px';
    pop.addEventListener('animationend', () => pop.remove());
    $('fx').appendChild(pop);
  }

  function confetti(anchor, count) {
    const rect = anchor.getBoundingClientRect();
    const colors = ['#ffc83d', '#2fbf71', '#ff5a5f', '#5ec8ff', '#a66bff', '#ff9f1c'];
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti';
      const angle = Math.random() * Math.PI * 2;
      const distance = 120 + Math.random() * 260;
      piece.style.left = rect.left + rect.width / 2 + 'px';
      piece.style.top = rect.top + rect.height / 2 + 'px';
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty('--dx', Math.cos(angle) * distance + 'px');
      piece.style.setProperty('--dy', Math.sin(angle) * distance + 180 + 'px');
      piece.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      piece.addEventListener('animationend', () => piece.remove());
      $('fx').appendChild(piece);
    }
  }

  function showOverlay(id) {
    ['start', 'tap-listen', 'win', 'settings', 'confirm'].forEach((name) => { $(name).hidden = name !== id; });
    if (id === 'start') { refreshReady(); applyUpdateIfIdle(); }
  }

  // ---------- Rounds ----------

  function nextCountry() {
    if (!game.bag.length) {
      game.bag = shuffle(activeCountries());
      if (game.bag[game.bag.length - 1].id === game.lastId) game.bag.unshift(game.bag.pop());
    }
    const country = game.bag.pop();
    game.lastId = country.id;
    return country;
  }

  // Animation-frame timestamps can be a few ms older than startedAt, so clamp at zero.
  function secondsSince(start, now) {
    return Math.max(0, (now - start) / 1000);
  }

  function pointsAt(now) {
    const elapsed = secondsSince(game.round.startedAt, now);
    const points = TOP_POINTS - (TOP_POINTS - FLOOR_POINTS) * (elapsed / COUNTDOWN_SECONDS);
    return Math.max(FLOOR_POINTS, Math.round(points));
  }

  function startRound() {
    stopEverything();
    showOverlay(null);
    const id = ++game.roundId;
    game.round = { id, target: nextCountry(), startedAt: 0, removed: 0, autoRepeated: false };
    layoutTiles(shuffle(activeCountries()));
    setTilesEnabled(false);
    $('replay').disabled = true;
    showPoints(TOP_POINTS);
    showTimer(1);
    listen(id);
  }

  async function listen(id) {
    // listenId lets a paused-then-resumed greeting cancel the earlier, unfinished one.
    const listenId = ++game.listenId;
    const current = () => id === game.roundId && listenId === game.listenId;
    game.phase = 'listening';
    setPrompt('Listen', 'listening');
    try {
      await playVoice('audio/' + game.round.target.id + '.mp3');
    } catch (error) {
      if (!current()) return;
      // iOS refused to play without a tap: ask for one instead of starting a silent round.
      if (error && error.name === 'NotAllowedError') {
        game.phase = 'blocked';
        showOverlay('tap-listen');
        return;
      }
      // Any other audio failure: carry on so the round never gets stuck.
    }
    if (!current()) return;
    beginGuessing();
  }

  function beginGuessing() {
    game.phase = 'guessing';
    game.round.startedAt = performance.now();
    setPrompt('Which flag?');
    setTilesEnabled(true);
    $('replay').disabled = false;
    game.frame = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (game.phase !== 'guessing') return;
    const round = game.round;
    const elapsed = secondsSince(round.startedAt, now);
    showPoints(pointsAt(now));
    showTimer(1 - elapsed / COUNTDOWN_SECONDS);
    const due = Math.min(Math.floor(elapsed), activeCountries().length - FLAGS_LEFT_AT_END);
    while (round.removed < due) removeWrongFlag();
    if (settings.autoRepeat && !round.autoRepeated && elapsed >= AUTO_REPEAT_SECONDS) {
      round.autoRepeated = true;
      replay();
    }
    game.frame = requestAnimationFrame(tick);
  }

  function removeWrongFlag() {
    const round = game.round;
    const candidates = activeCountries().filter((country) =>
      country.id !== round.target.id && !tiles[country.id].classList.contains('gone'));
    round.removed += 1;
    if (candidates.length <= FLAGS_LEFT_AT_END - 1) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    tiles[pick.id].classList.add('gone');
    tiles[pick.id].disabled = true;
  }

  function replay() {
    if (game.phase !== 'guessing') return;
    playVoice('audio/' + game.round.target.id + '.mp3').catch(() => {});
  }

  function answer(country, tile) {
    if (game.phase !== 'guessing') return;
    const points = pointsAt(performance.now());
    game.phase = 'feedback';
    stopEverything();
    setTilesEnabled(false);
    $('replay').disabled = true;
    const correct = country.id === game.round.target.id;
    if (correct) {
      game.total += points;
      showPoints(points);
      tile.classList.add('right');
      setPrompt('Correct!', 'good');
      popText('+' + points, tile, true);
      confetti(tile, 28);
      sfx.correct();
    } else {
      tile.classList.add('wrong');
      setPrompt('Not this one!', 'bad');
      popText('+0', tile, false);
      sfx.wrong();
    }
    showTotal(true);
    if (game.total >= WIN_POINTS) later(showWin, 1300);
    else later(startRound, NEXT_ROUND_DELAY);
  }

  function showWin() {
    game.phase = 'won';
    $('win-total').textContent = game.total;
    showOverlay('win');
    sfx.win();
    confetti($('win-total'), 70);
  }

  function newGame() {
    stopEverything();
    game.total = 0;
    showTotal(false);
    game.phase = 'idle';
  }

  // Every button that starts sound is a tap, which is what unlocks audio on iOS.
  function startFromTap() {
    sfx.unlock();
    startRound();
  }

  // ---------- Offline readiness ----------

  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  }

  function offlineStatus() {
    const sw = navigator.serviceWorker;
    if (!window.isSecureContext || !sw) return Promise.resolve({ state: 'unsupported' });
    if (!sw.controller) return Promise.resolve({ state: 'saving' });
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve({ state: 'unknown' }), 1500);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        const data = event.data || {};
        resolve({ state: data.saved >= data.total ? 'ready' : 'saving', saved: data.saved, total: data.total, version: data.version });
      };
      sw.controller.postMessage({ type: 'status' }, [channel.port2]);
    });
  }

  let readyTimer = 0;
  async function refreshReady() {
    clearTimeout(readyTimer);
    const status = await offlineStatus();
    const line = $('ready');
    line.className = 'ready' + (status.state === 'ready' ? ' ok' : '');
    if (status.state === 'ready') {
      line.textContent = isStandalone() ? '✓ Ready to play offline' : '✓ Saved for offline. Add it to the Home Screen: Share → Add to Home Screen.';
    } else if (status.state === 'saving') {
      line.textContent = 'Saving for offline… keep this open while online.';
    } else if (status.state === 'unsupported') {
      line.textContent = 'Offline play isn’t available here.';
    } else {
      line.textContent = '';
    }
    if (status.state !== 'ready' && !$('start').hidden) readyTimer = setTimeout(refreshReady, 2000);
  }

  // ---------- Teacher settings ----------

  async function openSettings() {
    stopEverything();
    game.roundId += 1;          // abandon any round in progress
    game.phase = 'idle';
    setTilesEnabled(false);
    $('replay').disabled = true;
    $('auto-repeat').checked = settings.autoRepeat;
    showOverlay('settings');
    const status = await offlineStatus();
    const rows = [
      ['Version', status.version || 'unknown'],
      ['Saved for offline', status.saved !== undefined ? status.saved + ' of ' + status.total + ' files' : status.state],
      ['Opened from Home Screen', isStandalone() ? 'Yes' : 'No, in Safari'],
      ['Connection', navigator.onLine ? 'Online' : 'Offline'],
    ];
    $('status-list').innerHTML = '';
    rows.forEach(([label, value]) => {
      const li = document.createElement('li');
      const a = document.createElement('span');
      const b = document.createElement('span');
      a.textContent = label;
      b.textContent = value;
      li.append(a, b);
      $('status-list').appendChild(li);
    });
  }

  function closeSettings() {
    setPrompt(game.total ? 'Paused' : 'Ready?');
    $('start-btn').textContent = game.total ? 'Continue' : 'Start';
    showOverlay('start');
  }

  function buildCredits() {
    const list = $('credits');
    COUNTRIES.forEach((country) => {
      const li = document.createElement('li');
      li.textContent = country.name + ' (“' + country.greeting + '”): ' + country.credit;
      list.appendChild(li);
    });
    const flags = document.createElement('li');
    flags.textContent = 'Flag images: flag-icons by Panayiotis Lipiridis, MIT License';
    list.appendChild(flags);
  }

  let holdTimer = 0;
  const gear = $('gear');
  gear.addEventListener('pointerdown', () => {
    gear.classList.add('holding');
    holdTimer = setTimeout(() => { gear.classList.remove('holding'); openSettings(); }, 1000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => gear.addEventListener(type, () => {
    clearTimeout(holdTimer);
    gear.classList.remove('holding');
  }));
  gear.addEventListener('contextmenu', (event) => event.preventDefault());

  $('auto-repeat').addEventListener('change', (event) => {
    settings.autoRepeat = event.target.checked;
    store.set('autoRepeat', settings.autoRepeat ? 'on' : 'off');
  });
  $('new-game').addEventListener('click', () => { newGame(); closeSettings(); });
  $('close-settings').addEventListener('click', closeSettings);

  // ---------- Easy mode switch (for booth staff, bottom-right corner) ----------

  let paused = null;

  function roundUnderway() {
    if (game.phase === 'won') return false;
    return game.phase !== 'idle' || game.total > 0;
  }

  function showMode() {
    const toggle = $('mode-toggle');
    toggle.classList.toggle('on', settings.easy);
    toggle.setAttribute('aria-pressed', String(settings.easy));
    $('confirm-text').textContent = settings.easy ? 'Switch to Normal mode (15 flags)?' : 'Switch to Easy mode (7 flags)?';
  }

  function applyMode(easy) {
    settings.easy = easy;
    store.set('mode', easy ? 'easy' : 'full');
    newGame();
    game.roundId += 1;
    game.listenId += 1;
    game.round = null;
    game.bag = [];
    game.lastId = null;
    setTilesEnabled(false);
    $('replay').disabled = true;
    showPoints(TOP_POINTS);
    showTimer(1);
    layoutTiles(activeCountries());
    fitTiles();
    showMode();
    setPrompt('Ready?');
    $('start-btn').textContent = 'Start';
    showOverlay('start');
  }

  // Freeze the round (countdown, greeting, next-round timer) while the confirm box is open.
  function pauseRound() {
    const overlay = ['start', 'tap-listen', 'win', 'settings'].find((name) => !$(name).hidden) || null;
    paused = { phase: game.phase, at: performance.now(), overlay };
    stopEverything();
    game.listenId += 1;
    if (game.phase !== 'idle') game.phase = 'paused';
    showOverlay('confirm');
  }

  function resumeRound() {
    const was = paused;
    paused = null;
    if (!was) return;
    game.phase = was.phase;
    if (was.phase === 'listening' || was.phase === 'blocked') {
      showOverlay(null);
      sfx.unlock();
      listen(game.round.id);          // start the greeting again from the top
    } else if (was.phase === 'guessing') {
      showOverlay(was.overlay);
      game.round.startedAt += performance.now() - was.at;
      game.frame = requestAnimationFrame(tick);
    } else if (was.phase === 'feedback') {
      if (game.total >= WIN_POINTS) showWin(); else startRound();
    } else {
      showOverlay(was.overlay || 'start');
    }
  }

  $('mode-toggle').addEventListener('click', () => {
    if (!$('confirm').hidden) return;
    if (roundUnderway()) pauseRound(); else applyMode(!settings.easy);
  });
  $('confirm-cancel').addEventListener('click', resumeRound);
  $('confirm-ok').addEventListener('click', () => { paused = null; applyMode(!settings.easy); });

  // ---------- Updates ----------

  let updateWaiting = false;
  function applyUpdateIfIdle() {
    if (!updateWaiting || roundUnderway() || !$('settings').hidden || !$('confirm').hidden || !$('win').hidden) return;
    location.reload();
  }

  // ---------- Start ----------

  $('start-btn').addEventListener('click', startFromTap);
  $('again-btn').addEventListener('click', () => {
    if (updateWaiting) { location.reload(); return; }
    newGame();
    startFromTap();
  });
  $('listen-btn').addEventListener('click', () => {
    if (game.phase !== 'blocked') return;
    sfx.unlock();
    showOverlay(null);
    listen(game.round.id);
  });
  $('replay').addEventListener('click', replay);

  buildTiles();
  buildCredits();
  showMode();
  showTotal(false);
  fitTiles();
  window.addEventListener('resize', fitTiles);
  window.addEventListener('orientationchange', () => setTimeout(fitTiles, 300));
  showOverlay('start');

  if (window.isSecureContext && navigator.serviceWorker) {
    // The app opens from its saved copy, so a new version arrives a few seconds after launch.
    // Switch to it straight away when nobody is playing; otherwise wait until the game is over.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { refreshReady(); return; }   // first install, nothing old to replace
      updateWaiting = true;
      applyUpdateIfIdle();
    });
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline relaunch: the active copy still works */ });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
})();
