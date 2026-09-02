// Game state machine: start → playing (3 categories, "Keep Climbing" between
// them) → over. One scored attempt per local day; a run marks itself played
// the moment it starts so a refresh can't buy a retry. ?practice bypasses the
// daily lock and never writes storage.
(() => {
  const TIMER_MS = 10000;
  const $ = id => document.getElementById(id);

  const practice = new URLSearchParams(location.search).has('practice');
  const day = GameData.dayIndex();
  const cats = GameData.todaysCategories();

  let catIdx = 0;
  let score = 0;
  let breakdown = [0, 0, 0];
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
    for (const id of ['screen-start', 'screen-between', 'screen-over']) {
      $(id).classList.toggle('hidden', id !== screen);
    }
    $('hud').classList.toggle('hidden', screen !== null);
    $('input-bar').classList.toggle('hidden', screen !== null);
  }

  // ---------- timer ----------
  function startTimer() {
    deadline = Date.now() + TIMER_MS;
    cancelAnimationFrame(timerRAF);
    tickTimer();
  }
  function tickTimer() {
    const left = deadline - Date.now();
    const frac = Math.max(0, left / TIMER_MS);
    const bar = $('timer-fill');
    bar.style.width = (frac * 100) + '%';
    bar.style.background = frac > 0.5 ? '#7ac74f' : frac > 0.25 ? '#f0a04b' : '#e04f3f';
    if (left <= 0) { onTimeUp(); return; }
    timerRAF = requestAnimationFrame(tickTimer);
  }

  // ---------- gameplay ----------
  function begin() {
    catIdx = 0; score = 0; breakdown = [0, 0, 0]; used = new Set();
    Scene.reset();
    save({ day, played: true, finished: false, score: 0, breakdown });
    state = 'playing';
    show(null);
    startCategory();
  }

  function startCategory() {
    const cat = cats[catIdx];
    $('cat-pill').textContent = `${cat.emoji} ${cat.prompt}`;
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

  function submit() {
    if (state !== 'playing') return;
    const raw = $('answer').value.trim();
    if (!raw) return;
    const cat = cats[catIdx];
    const res = Fuzzy.match(raw, cat.entries);
    if (!res) {
      setFeedback(`"${raw}" isn't on our list`, 'bad');
      return;
    }
    if (used.has(res.entry.c)) {
      setFeedback(`Already named ${res.entry.c}!`, 'bad');
      return;
    }
    used.add(res.entry.c);
    score++;
    breakdown[catIdx]++;
    save({ day, played: true, finished: false, score, breakdown });
    Scene.hopTo(score);
    $('score').textContent = `🌰 ${score}`;
    setFeedback(res.exact ? `✓ ${res.entry.c}` : `✓ ${res.entry.c} (close enough!)`, 'good');
    $('answer').value = '';
    startTimer();
  }

  function onTimeUp() {
    cancelAnimationFrame(timerRAF);
    if (catIdx < cats.length - 1) {
      state = 'between';
      const next = cats[catIdx + 1];
      $('between-title').textContent = "⏰ Time's up!";
      $('between-msg').textContent =
        `You named ${breakdown[catIdx]} ${cats[catIdx].title.toLowerCase()}. ` +
        `Next up: ${next.emoji} ${next.title}`;
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
    save({ day, played: true, finished, score, breakdown, best });
    renderOver(score, breakdown, finished);
  }

  function shareText(sc, bd) {
    const lines = cats.map((c, i) => `${c.emoji} ${bd[i]}`).join(' · ');
    return `🐿️ NameGame Day ${day + 1}\n🌳 Climbed ${sc} branches!\n${lines}\nhttps://namegame.fun`;
  }

  function renderOver(sc, bd, finished) {
    $('over-title').textContent = sc >= 30 ? '🚀 You reached space!'
      : sc >= 20 ? '🌙 You climbed into the night!'
      : sc >= 10 ? '🌅 What a climb!'
      : '🌰 The climb is over!';
    $('over-score').textContent = `${sc}`;
    $('over-breakdown').innerHTML = cats
      .map((c, i) => `<div>${c.emoji} ${c.title}: <b>${bd[i]}</b></div>`).join('');
    const s = load();
    $('over-best').textContent = !practice && s.best
      ? `Best climb: ${s.best.score} (Day ${s.best.day + 1})` : '';
    $('over-note').textContent = practice ? 'Practice run — nothing saved.'
      : finished ? '' : 'This run ended early (page was closed mid-climb).';
    show('screen-over');
    startCountdown();
  }

  function startCountdown() {
    const el = $('countdown');
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
    setInterval(tick, 1000);
  }

  // ---------- boot ----------
  async function boot() {
    await Scene.init($('scene'));
    Scene.reset();
    $('score').textContent = '🌰 0';
    $('day-label').textContent = `Day ${day + 1}` + (practice ? ' · practice' : '');

    const rec = practice ? null : todaysRecord();
    if (rec && rec.played) {
      // Already played today — straight to results
      score = rec.score || 0;
      breakdown = rec.breakdown || [0, 0, 0];
      for (let i = 0; i < score; i++) Scene.hopTo(i + 1); // restore the climb height
      renderOver(score, breakdown, rec.finished);
    } else {
      show('screen-start');
    }

    $('btn-begin').addEventListener('click', begin);
    $('btn-climb').addEventListener('click', keepClimbing);
    $('btn-share').addEventListener('click', async () => {
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
    // Tapping Go must not steal focus from the input — losing focus would
    // dismiss the mobile keyboard between every answer.
    $('btn-go').addEventListener('pointerdown', e => e.preventDefault());

    // Track the visual viewport so the input bar sits above the on-screen
    // keyboard (iOS overlays the keyboard instead of resizing the page).
    if (window.visualViewport) {
      const vv = window.visualViewport;
      const fit = () => {
        document.documentElement.style.setProperty('--vvh', vv.height + 'px');
        window.scrollTo(0, 0);
      };
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
      fit();
    }
  }

  boot();
})();
