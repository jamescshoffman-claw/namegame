// Game state machine: start → playing (3 categories, "Keep Climbing" between
// them) → over. One scored attempt per local day; a run marks itself played
// the moment it starts so a refresh can't buy a retry. ?practice bypasses the
// daily lock and never writes storage.
(() => {
  const START_MS = 20000;   // clock per category
  const BONUS_MS = 3000;    // added per correct answer
  const $ = id => document.getElementById(id);

  // Pixel-art icons replace emoji everywhere in the UI (share text keeps
  // emoji — it's plain text, images can't ride along to the clipboard).
  const CAT_ICONS = {
    '🍎': 'apple', '🍔': 'burger', '🌍': 'globe', '🥕': 'carrot',
    '🚗': 'car', '🗽': 'flag', '🦁': 'lion', '🍕': 'pizza',
    '🎨': 'palette', '⚽': 'ball', '🍦': 'icecream', '🐕': 'dog',
  };
  function icon(name, dir = 'assets/icons/') {
    return `<img class="icon" src="${dir}${name}.png" alt="">`;
  }
  function catIcon(cat) { return icon(CAT_ICONS[cat.emoji] || 'acorn'); }
  function setScore(n) { $('score').innerHTML = `${icon('acorn')} ${n}`; }

  const practice = new URLSearchParams(location.search).has('practice');
  const day = GameData.dayIndex();
  const cats = GameData.todaysCategories();

  let catIdx = 0;
  let score = 0;
  let breakdown = [0, 0, 0];
  let named = [[], [], []];   // canonical answers given, per category
  let used = new Set();
  let deadline = 0;
  let timerRAF = 0;
  let state = 'start';

  // ---------- storage ----------
  const KEY = 'namegame';
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function save(patch) {
    if (practice) return;
    const cur = load();
    localStorage.setItem(KEY, JSON.stringify({ ...cur, ...patch }));
  }
  function todaysRecord() {
    const s = load();
    return s.day === day ? s : null;
  }

  // ---------- screens ----------
  function show(screen) {
    for (const id of ['screen-start', 'screen-between', 'screen-over', 'screen-answers']) {
      $(id).classList.toggle('hidden', id !== screen);
    }
    $('hud').classList.toggle('hidden', screen !== null);
    $('input-bar').classList.toggle('hidden', screen !== null);
  }

  // ---------- timer ----------
  function startTimer() {
    deadline = Date.now() + START_MS;
    cancelAnimationFrame(timerRAF);
    tickTimer();
  }
  function extendTimer() {
    deadline += BONUS_MS;
  }
  function tickTimer() {
    const left = deadline - Date.now();
    const frac = Math.min(1, Math.max(0, left / START_MS));
    const bar = $('timer-fill');
    bar.style.width = (frac * 100) + '%';
    $('timer-num').textContent = Math.max(0, Math.ceil(left / 1000)) + 's';
    bar.style.background = frac > 0.5 ? '#7ac74f' : frac > 0.25 ? '#f0a04b' : '#e04f3f';
    if (left <= 0) { onTimeUp(); return; }
    timerRAF = requestAnimationFrame(tickTimer);
  }

  // ---------- gameplay ----------
  function begin() {
    catIdx = 0; score = 0; breakdown = [0, 0, 0]; named = [[], [], []]; used = new Set();
    Scene.reset();
    save({ day, played: true, finished: false, score: 0, breakdown, named });
    state = 'playing';
    show(null);
    startCategory();
  }

  function startCategory() {
    const cat = cats[catIdx];
    const pill = $('cat-pill');
    pill.innerHTML = `${catIcon(cat)} ${cat.prompt}`;
    pill.classList.remove('pop');
    void pill.offsetWidth; // restart the animation
    pill.classList.add('pop');
    $('answer').value = '';
    $('answer').focus();
    setFeedback('');
    startTimer();
  }

  function setFeedback(msg, kind) {
    const el = $('feedback');
    el.textContent = msg;
    el.className = kind || '';
    if (kind === 'bad') {
      $('input-bar').classList.remove('shake');
      void $('input-bar').offsetWidth; // restart the animation
      $('input-bar').classList.add('shake');
    }
  }

  // Secret dev reset: submitting "try" (or typing it on the over/between
  // screens) wipes today's attempt and returns to the start screen.
  function devRestart() {
    cancelAnimationFrame(timerRAF);
    save({ day, played: false, finished: false, score: 0, breakdown: [0, 0, 0], named: [[], [], []] });
    catIdx = 0; score = 0; breakdown = [0, 0, 0]; named = [[], [], []]; used = new Set();
    Scene.reset();
    setScore(0);
    $('answer').value = '';
    setFeedback('');
    state = 'start';
    show('screen-start');
  }

  function submit() {
    if (state !== 'playing') return;
    const raw = $('answer').value.trim();
    if (!raw) return;
    if (raw.toLowerCase() === 'try') { devRestart(); return; }
    const cat = cats[catIdx];
    const res = Fuzzy.match(raw, cat.entries);
    if (!res) {
      setFeedback(`"${raw}" isn't on our list`, 'bad');
      $('answer').value = ''; // no manual deleting between guesses
      return;
    }
    if (used.has(res.entry.c)) {
      setFeedback(`Already named ${res.entry.c}!`, 'bad');
      $('answer').value = '';
      return;
    }
    used.add(res.entry.c);
    score++;
    breakdown[catIdx]++;
    named[catIdx].push(res.entry.c);
    save({ day, played: true, finished: false, score, breakdown, named });
    Scene.hopTo(score);
    setScore(score);
    setFeedback(res.exact ? `✓ ${res.entry.c} +3s` : `✓ ${res.entry.c} (close enough!) +3s`, 'good');
    $('answer').value = '';
    extendTimer();
  }

  function onTimeUp() {
    cancelAnimationFrame(timerRAF);
    if (catIdx < cats.length - 1) {
      state = 'between';
      const next = cats[catIdx + 1];
      $('between-title').innerHTML = `${icon('hourglass')} Time's up!`;
      $('between-msg').innerHTML =
        `You named ${breakdown[catIdx]} ${cats[catIdx].title.toLowerCase()}. ` +
        `Next up: ${catIcon(next)} ${next.title}`;
      show('screen-between');
    } else {
      endGame(true);
    }
  }

  function keepClimbing() {
    catIdx++;
    state = 'playing';
    show(null);
    startCategory();
  }

  function endGame(finished) {
    state = 'over';
    const s = load();
    const best = !practice && (!s.best || score > s.best.score)
      ? { score, day } : s.best;
    save({ day, played: true, finished, score, breakdown, named, best });
    renderOver(score, breakdown, finished);
  }

  function renderAnswers() {
    $('answers-list').innerHTML = cats.map((c, i) => {
      const got = new Set(named[i]);
      const chips = c.entries.map(e =>
        `<span class="chip${got.has(e.c) ? ' got' : ''}">${e.c}</span>`).join('');
      return `<h3>${catIcon(c)} ${c.title} <small>${got.size}/${c.entries.length}</small></h3>` +
        `<div class="chips">${chips}</div>`;
    }).join('');
    $('answers-list').scrollTop = 0;
    show('screen-answers');
  }

  function shareText(sc, bd) {
    const lines = cats.map((c, i) => `${c.emoji} ${bd[i]}`).join(' · ');
    return `🐿️ NameGame Day ${day + 1}\n🌳 Climbed ${sc} branches!\n${lines}\nhttps://namegame.fun`;
  }

  function renderOver(sc, bd, finished) {
    $('over-title').innerHTML = sc >= 30 ? `${icon('rocket')} You reached space!`
      : sc >= 20 ? `${icon('moon', 'assets/')} You climbed into the night!`
      : sc >= 10 ? `${icon('sun', 'assets/')} What a climb!`
      : `${icon('acorn')} The climb is over!`;
    $('over-score').textContent = `${sc}`;
    $('over-breakdown').innerHTML = cats
      .map((c, i) => `<div>${catIcon(c)} ${c.title}: <b>${bd[i]}</b></div>`).join('');
    const s = load();
    $('over-best').textContent = !practice && s.best
      ? `Best climb: ${s.best.score} (Day ${s.best.day + 1})` : '';
    $('over-note').textContent = practice ? 'Practice run — nothing saved.'
      : finished ? '' : 'This run ended early (page was closed mid-climb).';
    show('screen-over');
    startCountdown();
  }

  let countdownTimer = null;
  function startCountdown() {
    const el = $('countdown');
    clearInterval(countdownTimer);
    function tick() {
      const now = new Date();
      const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const ms = mid - now;
      const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
      const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
      const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
      el.textContent = `Next climb in ${h}:${m}:${s}`;
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  // ---------- boot ----------
  async function boot() {
    await Scene.init($('scene'));
    Scene.reset();
    setScore(0);
    $('day-label').textContent = `Day ${day + 1}` + (practice ? ' · practice' : '');

    const rec = practice ? null : todaysRecord();
    if (rec && rec.played) {
      // Already played today — straight to results
      score = rec.score || 0;
      breakdown = rec.breakdown || [0, 0, 0];
      named = rec.named || [[], [], []];
      for (let i = 0; i < score; i++) Scene.hopTo(i + 1); // restore the climb height
      renderOver(score, breakdown, rec.finished);
    } else {
      show('screen-start');
    }

    $('btn-begin').addEventListener('click', begin);
    $('btn-climb').addEventListener('click', keepClimbing);
    $('btn-answers').addEventListener('click', renderAnswers);
    $('btn-answers-close').addEventListener('click', () => {
      state = 'over';
      renderOver(score, breakdown, (load().finished !== false));
    });
    // Easter egg: hold Share for 2 seconds to retry today's climb
    let shareHoldTimer = null, shareHeld = false;
    const shareBtn = $('btn-share');
    shareBtn.addEventListener('pointerdown', () => {
      shareHeld = false;
      clearTimeout(shareHoldTimer);
      shareHoldTimer = setTimeout(() => { shareHeld = true; devRestart(); }, 2000);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
      shareBtn.addEventListener(ev, () => clearTimeout(shareHoldTimer));
    }
    shareBtn.addEventListener('contextmenu', e => e.preventDefault());

    shareBtn.addEventListener('click', async () => {
      if (shareHeld) { shareHeld = false; return; } // long-press was the reset
      const text = shareText(score, breakdown);
      // Native share sheet only on touch devices — on desktop it's clunky
      // (and macOS's sheet can hang the page); copy to clipboard instead.
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      try {
        if (mobile && navigator.share) await navigator.share({ text });
        else {
          await navigator.clipboard.writeText(text);
          $('btn-share').textContent = 'Copied!';
          setTimeout(() => { $('btn-share').textContent = 'Share'; }, 1500);
        }
      } catch { /* user cancelled */ }
    });
    $('answer-form').addEventListener('submit', e => { e.preventDefault(); submit(); });
    // The typed-anywhere half of the secret reset, for screens with no input
    let secret = '';
    document.addEventListener('keydown', e => {
      if (e.key.length === 1) secret = (secret + e.key.toLowerCase()).slice(-3);
      if (secret === 'try' && state !== 'playing') { secret = ''; devRestart(); }
    });
    // Tapping Go must not steal focus from the input — losing focus would
    // dismiss the mobile keyboard between every answer.
    $('btn-go').addEventListener('pointerdown', e => e.preventDefault());

    // The on-screen keyboard overlays the scene (interactive-widget=
    // overlays-content; iOS always overlays). Track the visual viewport to
    // ride the input bar above the keyboard (--kb) and tell the scene how
    // much of the canvas stays visible so the squirrel isn't covered.
    if (window.visualViewport) {
      const vv = window.visualViewport;
      const fit = () => {
        document.documentElement.style.setProperty('--vvh', vv.height + 'px');
        // Measure how much of the STAGE the keyboard covers — innerHeight
        // is unreliable on iOS (it can shrink with the keyboard, hiding
        // the occlusion). Client rects are in layout-viewport coords, the
        // same space as vv.offsetTop/height.
        const r = $('stage').getBoundingClientRect();
        const visBottom = Math.min(r.bottom, vv.offsetTop + vv.height);
        const kb = Math.max(0, r.bottom - visBottom);
        document.documentElement.style.setProperty('--kb', kb + 'px');
        const vis = Math.max(0, visBottom - Math.max(r.top, vv.offsetTop));
        Scene.setViewFraction(r.height > 0 ? vis / r.height : 1);
        window.scrollTo(0, 0);
      };
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
      fit();
    }
  }

  boot();
})();
