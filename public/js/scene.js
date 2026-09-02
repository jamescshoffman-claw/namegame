// Canvas renderer: a pixel-art tree climb from sunrise to space.
// Internal resolution is fixed and small (true pixel art); CSS scales it up
// with image-rendering: pixelated. All world positions are in internal pixels;
// branch k sits at worldY = -k * BRANCH_DY, the camera lerps to follow.
//
// Art comes from assets/manifest.json when present (generated sprites); every
// draw call falls back to the built-in procedural pixel art when it isn't.
const Scene = (() => {
  const W = 320, H = 480;
  const BRANCH_DY = 52;          // vertical gap between branches
  const TRUNK_X = 160;           // trunk centerline
  const BRANCH_LEN = 52;

  let ctx, canvas;
  let cameraY = 0;               // world y at screen center
  let branch = 0;                // squirrel's current branch (0 = ground)
  let jump = null;               // {from, to, t0, dur} while mid-hop
  let sprites = null;            // loaded from assets/manifest.json if present
  let running = false;

  // ---------- deterministic hash noise (stable star/cloud/bark placement) ----------
  function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }

  // ---------- sky palette ----------
  // Stops keyed by altitude in branches: [altitude, topColor, bottomColor]
  const SKY = [
    [0,  [126, 200, 227], [255, 178, 107]],  // sunrise
    [5,  [ 92, 170, 224], [160, 214, 235]],  // morning
    [10, [ 74, 140, 210], [130, 190, 225]],  // day
    [14, [122,  91, 168], [255, 140,  66]],  // sunset
    [18, [ 59,  45,  99], [199,  81,  70]],  // dusk
    [22, [ 14,  26,  58], [ 36,  53, 107]],  // night
    [30, [  6,  13,  36], [ 14,  26,  58]],  // deep night
    [38, [  3,   3,   8], [ 10,  10,  24]],  // space
  ];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpC(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)].map(Math.round);
  }
  function css(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }

  function skyAt(alt) {
    if (alt <= SKY[0][0]) return [SKY[0][1], SKY[0][2]];
    for (let i = 1; i < SKY.length; i++) {
      if (alt <= SKY[i][0]) {
        const t = (alt - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0]);
        return [lerpC(SKY[i - 1][1], SKY[i][1], t), lerpC(SKY[i - 1][2], SKY[i][2], t)];
      }
    }
    return [SKY[SKY.length - 1][1], SKY[SKY.length - 1][2]];
  }

  // darkness 0 (day) → 1 (space); drives stars
  function darkness(alt) {
    if (alt < 14) return 0;
    if (alt < 22) return (alt - 14) / 8 * 0.8;
    if (alt < 38) return 0.8 + (alt - 22) / 16 * 0.2;
    return 1;
  }

  // ---------- squirrel pixel art (placeholder until generated art lands) ----------
  const SQ_PAL = { 1: '#4a2c17', 2: '#b5622d', 3: '#eec39a', 4: '#8a4720', 5: '#1a1208', 6: '#ffffff', 7: '#d8823f' };
  const SQ_SIT = [
    '................',
    '....44..........',
    '...4774.....11..',
    '..477774...1221.',
    '..477774..122221',
    '.4777774..122521',
    '.4777774.1222221',
    '.477774122222221',
    '..47774122222221',
    '..47774122333321',
    '.4477412233333.1',
    '.4774122233333..',
    '.474122223333...',
    '..4122222333....',
    '..122222233.....',
    '...111111.11....',
  ];
  const SQ_JUMP = [
    '................',
    '................',
    '44..........11..',
    '4774........1221',
    '.47774....122221',
    '..47774..1222521',
    '..47774122222221',
    '...4741222222221',
    '...474122222221.',
    '..4741222333321.',
    '..471223333332..',
    '.4712233333.1...',
    '.41222233.11....',
    '.1222223.1......',
    '..12.223........',
    '...1..11........',
  ];

  function drawPixelMap(map, x, y, scale, flip) {
    for (let r = 0; r < map.length; r++) {
      for (let c = 0; c < 16; c++) {
        const ch = map[r][flip ? 15 - c : c];
        const col = SQ_PAL[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
      }
    }
  }

  // ---------- world geometry ----------
  function branchSide(k) { return k % 2 === 1 ? 1 : -1; } // 1 = right
  function branchTip(k) {
    if (k === 0) return { x: TRUNK_X + 26, y: -6 };        // ground start, beside trunk
    return { x: TRUNK_X + branchSide(k) * (BRANCH_LEN - 8), y: -k * BRANCH_DY };
  }

  function toScreen(wx, wy) { return { x: wx, y: H * 0.62 + (wy - cameraY) }; }

  // ---------- drawing ----------
  function drawSky(alt) {
    const [top, bot] = skyAt(alt);
    // End the gradient at the ground line (when visible) so the horizon color
    // actually shows at the horizon instead of hiding under the dirt.
    const groundY = toScreen(0, 0).y + 8;
    const bottom = Math.max(160, Math.min(H, groundY));
    const g = ctx.createLinearGradient(0, 0, 0, bottom);
    g.addColorStop(0, css(top));
    g.addColorStop(1, css(bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawStars(alt) {
    const d = darkness(alt);
    if (d <= 0.05) return;
    const par = 0.35; // stars scroll slower than the tree
    const offY = cameraY * par;
    for (let gx = 0; gx < 20; gx++) {
      for (let gy = -2; gy < 32; gy++) {
        const cellY = Math.floor(offY / 32) + gy;
        const r = hash2(gx * 7 + 3, cellY * 13 + 1);
        if (r > d * 0.35) continue;
        const sx = Math.floor(gx * 16 + hash2(gx, cellY) * 14);
        const sy = Math.floor(cellY * 32 - offY + hash2(gx + 50, cellY) * 30);
        if (sy < -4 || sy > H + 4) continue;
        const tw = hash2(gx + 99, cellY) > 0.8 ? 2 : 1;
        ctx.fillStyle = r < d * 0.06 ? '#fff7d6' : '#cfd8ef';
        ctx.fillRect(sx, sy, tw, tw);
      }
    }
  }

  function pixelCircle(cx, cy, rad, col) {
    ctx.fillStyle = col;
    for (let y = -rad; y <= rad; y++) {
      const span = Math.floor(Math.sqrt(rad * rad - y * y));
      ctx.fillRect(cx - span, cy + y, span * 2 + 1, 1);
    }
  }

  function drawCelestials(alt) {
    // Sun hugs the horizon at sunrise, gone by mid-morning
    if (alt < 8) {
      const p = toScreen(70, 8 - alt * 2);
      const fade = Math.max(0, 1 - alt / 8);
      ctx.globalAlpha = fade;
      pixelCircle(p.x, Math.min(p.y, H - 40), 18, '#ffd97a');
      pixelCircle(p.x, Math.min(p.y, H - 40), 13, '#ffe9ad');
      ctx.globalAlpha = 1;
    }
    // Moon rides through the night band
    const moonY = -26 * BRANCH_DY;
    const mp = toScreen(250, moonY);
    if (mp.y > -30 && mp.y < H + 30) {
      pixelCircle(mp.x, mp.y, 14, '#e8e6da');
      pixelCircle(mp.x + 6, mp.y - 3, 11, css(skyAt(alt)[0])); // crescent bite
      ctx.fillStyle = '#c9c7bb';
      ctx.fillRect(mp.x - 8, mp.y + 2, 3, 3);
      ctx.fillRect(mp.x - 3, mp.y - 6, 2, 2);
    }
    // Planets live in space
    const planets = [
      { alt: 40, x: 60, r: 12, col: '#d98f4e', ring: true },   // ringed gas giant
      { alt: 47, x: 245, r: 8, col: '#c1533f' },               // red planet
      { alt: 54, x: 110, r: 10, col: '#5a8fd4', moonlet: true },// blue world
      { alt: 62, x: 220, r: 14, col: '#9a7bc9', ring: true },
    ];
    for (const pl of planets) {
      const pp = toScreen(pl.x, -pl.alt * BRANCH_DY);
      if (pp.y < -40 || pp.y > H + 40) continue;
      pixelCircle(pp.x, pp.y, pl.r, pl.col);
      ctx.globalAlpha = 0.35;
      pixelCircle(pp.x - pl.r / 3, pp.y - pl.r / 3, Math.max(2, pl.r - 4), '#ffffff');
      ctx.globalAlpha = 1;
      if (pl.ring) {
        ctx.fillStyle = '#e8d8a8';
        ctx.fillRect(pp.x - pl.r - 8, pp.y + 1, pl.r * 2 + 16, 2);
      }
      if (pl.moonlet) pixelCircle(pp.x + pl.r + 8, pp.y - pl.r, 3, '#cccccc');
    }
  }

  function drawClouds(alt) {
    const d = 1 - darkness(alt);
    if (d <= 0.1) return;
    ctx.globalAlpha = 0.85 * d;
    for (let i = 0; i < 10; i++) {
      const ca = 2 + i * 1.6;                       // cloud altitude in branches
      const wy = -ca * BRANCH_DY;
      const p = toScreen(0, wy);
      if (p.y < -20 || p.y > H + 20) continue;
      const cx = Math.floor(hash2(i, 7) * W);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 18, p.y, 36, 7);
      ctx.fillRect(cx - 10, p.y - 5, 22, 5);
      ctx.fillRect(cx - 24, p.y + 4, 14, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawGround() {
    const p = toScreen(0, 0);
    if (p.y > H + 60) return;
    ctx.fillStyle = '#5f9e3d';                       // grass
    ctx.fillRect(0, p.y + 8, W, 10);
    ctx.fillStyle = '#79b551';
    for (let x = 0; x < W; x += 4) {
      if (hash2(x, 0) > 0.5) ctx.fillRect(x, p.y + 6, 2, 2);
    }
    ctx.fillStyle = '#6e4a2c';                       // dirt below
    ctx.fillRect(0, p.y + 18, W, H);
    ctx.fillStyle = '#5a3a20';
    for (let x = 0; x < W; x += 8) {
      for (let y = 0; y < 8; y++) {
        if (hash2(x, y + 3) > 0.75) ctx.fillRect(x + Math.floor(hash2(x, y) * 6), p.y + 22 + y * 8, 3, 2);
      }
    }
  }

  function leafColor(alt) {
    const day = ['#3e8e41', '#54a85a', '#2e6e33'];
    const night = ['#1e4530', '#2a5a3e', '#173626'];
    const t = darkness(alt);
    return day.map((c, i) => {
      const a = parseInt(c.slice(1), 16), b = parseInt(night[i].slice(1), 16);
      const mix = ch => Math.round(lerp((a >> ch) & 255, (b >> ch) & 255, t));
      return `rgb(${mix(16)},${mix(8)},${mix(0)})`;
    });
  }

  function drawTree(alt, maxBranch) {
    const top = toScreen(0, -(maxBranch + 8) * BRANCH_DY).y;
    const bottom = Math.min(toScreen(0, 10).y, H);
    // trunk with hash-textured bark
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(TRUNK_X - 10, top, 20, bottom - top);
    ctx.fillStyle = '#4a3220';
    ctx.fillRect(TRUNK_X - 10, top, 3, bottom - top);
    ctx.fillRect(TRUNK_X + 7, top, 3, bottom - top);
    ctx.fillStyle = '#7d5836';
    for (let y = Math.floor(top / 6) * 6; y < bottom; y += 6) {
      const r = hash2(1, y + Math.floor(cameraY));
      if (r > 0.4) ctx.fillRect(TRUNK_X - 6 + Math.floor(r * 10), y, 4, 2);
    }
    // roots flare at the ground
    const g = toScreen(0, 0);
    if (g.y < H + 20) {
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(TRUNK_X - 16, g.y + 2, 32, 8);
      ctx.fillRect(TRUNK_X - 22, g.y + 6, 44, 4);
    }
    // branches
    const leaves = leafColor(alt);
    for (let k = 1; k <= maxBranch + 6; k++) {
      const wy = -k * BRANCH_DY;
      const p = toScreen(TRUNK_X, wy);
      if (p.y < -30 || p.y > H + 30) continue;
      const side = branchSide(k);
      const x0 = side > 0 ? TRUNK_X + 8 : TRUNK_X - 8 - BRANCH_LEN;
      ctx.fillStyle = '#5a3a20';
      ctx.fillRect(x0, p.y, BRANCH_LEN, 5);
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(x0, p.y, BRANCH_LEN, 2);
      // leaf tuft at the tip
      const tipX = side > 0 ? x0 + BRANCH_LEN - 10 : x0 - 4;
      ctx.fillStyle = leaves[2];
      ctx.fillRect(tipX - 6, p.y - 10, 22, 12);
      ctx.fillStyle = leaves[0];
      ctx.fillRect(tipX - 3, p.y - 13, 16, 12);
      ctx.fillStyle = leaves[1];
      ctx.fillRect(tipX + 1, p.y - 16, 9, 8);
    }
  }

  function squirrelPos(now) {
    if (!jump) return branchTip(branch);
    const t = Math.min(1, (now - jump.t0) / jump.dur);
    if (t >= 1) { branch = jump.to; jump = null; return branchTip(branch); }
    const a = branchTip(jump.from), b = branchTip(jump.to);
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * 34; // leap arc
    return { x, y, mid: true };
  }

  function drawSquirrel(now) {
    const pos = squirrelPos(now);
    const p = toScreen(pos.x, pos.y);
    const scale = 2;
    const map = pos.mid ? SQ_JUMP : SQ_SIT;
    // faces the trunk: on a right branch look left, on the left look right
    const flip = jump ? branchTip(jump.to).x < branchTip(jump.from).x
                      : branch !== 0 && branchSide(branch) > 0;
    if (sprites && sprites.squirrel) {
      const fr = sprites.squirrel.frames[pos.mid ? 1 : 0];
      ctx.save();
      if (flip) { ctx.translate(p.x, 0); ctx.scale(-1, 1); ctx.translate(-p.x, 0); }
      ctx.drawImage(sprites.squirrel.img, fr.x, fr.y, fr.w, fr.h,
        p.x - 16, p.y - 30, 32, 32);
      ctx.restore();
    } else {
      drawPixelMap(map, p.x - 8 * scale, p.y - 15 * scale, scale, flip);
    }
  }

  // ---------- main loop ----------
  function frame(now) {
    if (!running) return;
    const target = jump
      ? lerp(branchTip(jump.from).y, branchTip(jump.to).y, Math.min(1, (now - jump.t0) / jump.dur))
      : branchTip(branch).y;
    cameraY += (target - cameraY) * 0.08;
    const alt = -cameraY / BRANCH_DY;

    drawSky(alt);
    drawStars(alt);
    drawCelestials(alt);
    drawClouds(alt);
    drawTree(alt, Math.max(branch, jump ? jump.to : 0));
    drawGround();
    drawSquirrel(now);
    requestAnimationFrame(frame);
  }

  // ---------- public API ----------
  async function init(el) {
    canvas = el;
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    try {
      const res = await fetch('assets/manifest.json');
      if (res.ok) {
        const manifest = await res.json();
        sprites = {};
        for (const [key, def] of Object.entries(manifest.sprites || {})) {
          const img = new Image();
          img.src = 'assets/' + def.file;
          await img.decode();
          sprites[key] = { img, frames: def.frames };
        }
      }
    } catch { sprites = null; } // no generated art yet — procedural fallback
    running = true;
    requestAnimationFrame(frame);
  }

  function reset() { branch = 0; jump = null; cameraY = branchTip(0).y; }

  function hopTo(k) {
    const from = jump ? jump.to : branch;
    if (jump) branch = jump.to; // finish the previous hop instantly
    jump = { from, to: k, t0: performance.now(), dur: 320 };
  }

  return { init, reset, hopTo };
})();
