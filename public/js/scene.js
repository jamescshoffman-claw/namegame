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
  const TRUNK_W = 24;
  const BRANCH_LEN = 54;

  let ctx, canvas;
  let cameraY = 0;               // world y at screen center
  let branch = 0;                // squirrel's current branch (0 = ground)
  let jump = null;               // {from, to, t0, dur} while mid-hop
  let sprites = null;            // loaded from assets/manifest.json if present
  let running = false;
  let viewFrac = 1;              // fraction of the canvas not covered by the keyboard
  let anchor = H * 0.62;         // screen y the camera pins cameraY to (eased)

  // ---------- deterministic hash noise (stable placement of everything) ----------
  function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }

  // ---------- sky palette ----------
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

  function darkness(alt) {
    if (alt < 14) return 0;
    if (alt < 22) return (alt - 14) / 8 * 0.8;
    if (alt < 38) return 0.8 + (alt - 22) / 16 * 0.2;
    return 1;
  }

  // ---------- squirrel pixel art (placeholder until generated art lands) ----------
  const SQ_PAL = {
    1: '#452a15', 2: '#b5622d', 3: '#eec39a', 4: '#7d3f1c',
    5: '#1a1208', 7: '#d8823f', 8: '#f2a07b',
  };
  const SQ_SIT = [
    '................',
    '....44..........',
    '...4774.....11..',
    '..477774...1821.',
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
    '4774.......1821.',
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

  // ---------- generated sprite helpers ----------
  function spr(name) { return sprites && sprites[name]; }

  // Night variant of a sprite: multiply toward a blue night tone, then
  // restore the original alpha. Cached per sprite at 4 darkness levels.
  function tintCanvas(img, t) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'multiply';
    const v = Math.round(255 - t * 165), b = Math.round(255 - t * 110);
    g.fillStyle = `rgb(${v},${v},${b})`;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, 0, 0);
    return c;
  }

  function sprImage(s, dark) {
    const lv = dark ? Math.min(4, Math.round(dark * 4)) : 0;
    if (lv <= 0) return s.img;
    s.tints = s.tints || [];
    return s.tints[lv] || (s.tints[lv] = tintCanvas(s.img, lv / 4));
  }

  function drawSpr(name, x, y, opts = {}) {
    const s = spr(name);
    if (!s) return false;
    const f = s.frames[opts.frame || 0];
    const img = sprImage(s, opts.dark);
    const w = opts.w || f.w, h = opts.h || f.h;
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    if (opts.flip) {
      ctx.translate(Math.round(x) + w / 2, 0);
      ctx.scale(-1, 1);
      ctx.translate(-(Math.round(x) + w / 2), 0);
    }
    ctx.drawImage(img, f.x, f.y, f.w, f.h, Math.round(x), Math.round(y), w, h);
    ctx.restore();
    return true;
  }

  // ---------- world geometry ----------
  function branchSide(k) { return k % 2 === 1 ? 1 : -1; }
  function branchTip(k) {
    if (k === 0) return { x: TRUNK_X + 30, y: -6 };
    // land mid-branch, on the wood, not out at the leafy tip
    return { x: TRUNK_X + branchSide(k) * 30, y: -k * BRANCH_DY };
  }

  function toScreen(wx, wy) { return { x: wx, y: anchor + (wy - cameraY) }; }

  // ---------- drawing helpers ----------
  function pixelCircle(cx, cy, rad, col) {
    ctx.fillStyle = col;
    for (let y = -rad; y <= rad; y++) {
      const span = Math.floor(Math.sqrt(rad * rad - y * y));
      ctx.fillRect(Math.round(cx - span), Math.round(cy + y), span * 2 + 1, 1);
    }
  }

  // A leafy blob: dark base, mid body, light crown — the 3-tone shading that
  // makes Stardew foliage read as volume instead of flat green.
  function leafBlob(cx, cy, r, pal) {
    pixelCircle(cx + 1, cy + 2, r, pal.dark);
    pixelCircle(cx, cy, r, pal.mid);
    pixelCircle(cx - Math.ceil(r / 3), cy - Math.ceil(r / 3), Math.max(2, r - 2), pal.light);
  }

  function leafPalette(alt) {
    const day = { dark: [40, 94, 52], mid: [72, 138, 74], light: [116, 176, 98] };
    const night = { dark: [18, 48, 40], mid: [32, 74, 56], light: [52, 100, 70] };
    const t = darkness(alt);
    const mix = k => css(lerpC(day[k], night[k], t));
    return { dark: mix('dark'), mid: mix('mid'), light: mix('light') };
  }

  // ---------- sky & atmosphere ----------
  function drawSky(alt) {
    const [top, bot] = skyAt(alt);
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
    const par = 0.35;
    const offY = cameraY * par;
    for (let gx = 0; gx < 20; gx++) {
      for (let gy = -2; gy < 32; gy++) {
        const cellY = Math.floor(offY / 32) + gy;
        const r = hash2(gx * 7 + 3, cellY * 13 + 1);
        if (r > d * 0.35) continue;
        const sx = Math.floor(gx * 16 + hash2(gx, cellY) * 14);
        const sy = Math.floor(cellY * 32 - offY + hash2(gx + 50, cellY) * 30);
        if (sy < -4 || sy > H + 4) continue;
        const big = hash2(gx + 99, cellY) > 0.85;
        ctx.fillStyle = r < d * 0.06 ? '#fff7d6' : '#cfd8ef';
        if (big) { // four-pointed twinkle
          if (!drawSpr('star', sx - 5, sy - 6, { alpha: Math.min(1, d) })) {
            ctx.fillRect(sx, sy - 1, 1, 3);
            ctx.fillRect(sx - 1, sy, 3, 1);
          }
        } else {
          ctx.fillRect(sx, sy, 1, 1);
        }
      }
    }
  }

  function drawCelestials(alt, now) {
    // Sun: warm glow, disc, and slow-blinking rays at the sunrise horizon
    if (alt < 8) {
      const p = toScreen(74, 6 - alt * 2);
      const y = Math.min(p.y, H - 46);
      const fade = Math.max(0, 1 - alt / 8);
      ctx.globalAlpha = fade * 0.35;
      pixelCircle(p.x, y, 26, '#ffdf9e');
      ctx.globalAlpha = 1;
      if (!drawSpr('sun', p.x - 26, y - 28, { alpha: fade })) {
        ctx.globalAlpha = fade;
        pixelCircle(p.x, y, 17, '#ffca5f');
        pixelCircle(p.x, y, 13, '#ffe9ad');
        pixelCircle(p.x - 4, y - 4, 6, '#fff7dd');
        ctx.fillStyle = '#ffca5f';
        const blink = Math.floor(now / 600) % 2;
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4 + blink * Math.PI / 8;
          ctx.fillRect(Math.round(p.x + Math.cos(a) * 22), Math.round(y + Math.sin(a) * 22), 2, 2);
        }
        ctx.globalAlpha = 1;
      }
    }
    // Moon with glow and craters through the night band
    const mp = toScreen(252, -26 * BRANCH_DY);
    if (mp.y > -40 && mp.y < H + 40) {
      ctx.globalAlpha = 0.25;
      pixelCircle(mp.x, mp.y, 20, '#cdd6ec');
      ctx.globalAlpha = 1;
      if (!drawSpr('moon', mp.x - 16, mp.y - 23)) {
        pixelCircle(mp.x, mp.y, 14, '#e8e6da');
        pixelCircle(mp.x + 3, mp.y - 2, 12, '#f4f2e6');
        ctx.fillStyle = '#c9c7bb';
        ctx.fillRect(mp.x - 8, mp.y + 3, 4, 3);
        ctx.fillRect(mp.x - 2, mp.y - 7, 3, 2);
        ctx.fillRect(mp.x + 4, mp.y + 6, 2, 2);
        ctx.fillRect(mp.x + 6, mp.y - 1, 2, 2);
      }
    }
    // Planets in space, shaded with a lit side and a dark limb
    const planets = [
      { alt: 40, x: 62, r: 13, sprite: 'planet1', base: '#d98f4e', lit: '#f0b579', dark: '#9c6132', ring: '#e8d8a8' },
      { alt: 47, x: 246, r: 8, sprite: 'planet2', base: '#c1533f', lit: '#e07b5c', dark: '#8a3527' },
      { alt: 54, x: 110, r: 11, sprite: 'planet3', base: '#5a8fd4', lit: '#8fb8e8', dark: '#3a5f9c', moonlet: true },
      { alt: 62, x: 220, r: 15, sprite: 'galaxy', base: '#9a7bc9', lit: '#c0a4e6', dark: '#6b4f96', ring: '#d8c8f0' },
    ];
    for (const pl of planets) {
      const pp = toScreen(pl.x, -pl.alt * BRANCH_DY);
      if (pp.y < -50 || pp.y > H + 50) continue;
      const ps = spr(pl.sprite);
      if (ps && drawSpr(pl.sprite, pp.x - ps.frames[0].w / 2, pp.y - ps.frames[0].h / 2)) continue;
      pixelCircle(pp.x, pp.y, pl.r, pl.dark);
      pixelCircle(pp.x - 2, pp.y - 2, pl.r - 1, pl.base);
      pixelCircle(pp.x - Math.ceil(pl.r / 3), pp.y - Math.ceil(pl.r / 3), Math.max(2, pl.r - 5), pl.lit);
      if (pl.ring) {
        ctx.fillStyle = pl.ring;
        ctx.fillRect(pp.x - pl.r - 9, pp.y + 2, pl.r * 2 + 18, 2);
        ctx.fillRect(pp.x - pl.r - 6, pp.y + 4, 5, 1);
        ctx.fillRect(pp.x + pl.r + 1, pp.y + 4, 5, 1);
      }
      if (pl.moonlet) {
        pixelCircle(pp.x + pl.r + 9, pp.y - pl.r, 3, '#b8b8c4');
        pixelCircle(pp.x + pl.r + 8, pp.y - pl.r - 1, 2, '#dcdce4');
      }
    }
  }

  function drawClouds(alt) {
    const d = 1 - darkness(alt);
    if (d <= 0.1) return;
    ctx.globalAlpha = 0.92 * d;
    for (let i = 0; i < 9; i++) {
      const ca = 2 + i * 1.7;
      const p = toScreen(0, -ca * BRANCH_DY);
      if (p.y < -30 || p.y > H + 30) continue;
      const cx = Math.floor(hash2(i, 7) * (W - 60)) + 30;
      const big = hash2(i, 3) > 0.5;
      const cs = spr(big ? 'cloud1' : 'cloud2');
      if (cs) {
        drawSpr(big ? 'cloud1' : 'cloud2', cx - cs.frames[0].w / 2, p.y - cs.frames[0].h / 2);
        continue;
      }
      const r = big ? 11 : 8;
      // puffy 3-lobed cloud with a flat shaded base
      pixelCircle(cx - r, p.y + 2, r - 2, '#cfd4e2');
      pixelCircle(cx + r, p.y + 2, r - 2, '#cfd4e2');
      pixelCircle(cx, p.y + 2, r, '#cfd4e2');
      pixelCircle(cx - r, p.y, r - 2, '#ffffff');
      pixelCircle(cx + r, p.y, r - 2, '#ffffff');
      pixelCircle(cx, p.y - 2, r, '#ffffff');
      ctx.fillStyle = '#eef2fa';
      ctx.fillRect(cx - r - 6, p.y + 3, r * 2 + 12, 3);
    }
    ctx.globalAlpha = 1;
  }

  function drawBirds(alt, now) {
    if (alt < 1 || alt > 13) return;
    ctx.fillStyle = darkness(alt) > 0.3 ? '#2a2a3a' : '#3a4a5a';
    for (let i = 0; i < 4; i++) {
      const ba = 3 + i * 2.6;
      const p = toScreen(0, -ba * BRANCH_DY);
      if (p.y < -10 || p.y > H + 10) continue;
      const drift = (now / 90 + i * 137) % (W + 60) - 30;
      const bx = Math.round(drift);
      const flap = Math.floor(now / 250 + i) % 2;
      // tiny two-wing "m" bird
      ctx.fillRect(bx - 2, p.y + (flap ? 0 : -1), 2, 1);
      ctx.fillRect(bx + 1, p.y + (flap ? 0 : -1), 2, 1);
      ctx.fillRect(bx, p.y, 1, 1);
    }
  }

  // ---------- ground & tree ----------
  function drawGround(alt) {
    const p = toScreen(0, 0);
    if (p.y > H + 80) return;
    const gy = p.y + 8;
    const dk = darkness(alt);
    const gs = spr('ground');
    if (gs) {
      const f = gs.frames[0];
      const top = gy - 16;                    // solid grass line sits at gy
      drawSpr('ground', 0, top, { dark: dk });
      if (top + f.h < H) {                    // stretch the bottom dirt row down
        const img = sprImage(gs, dk);
        ctx.drawImage(img, f.x, f.y + f.h - 1, f.w, 1, 0, top + f.h - 1, W, H - (top + f.h - 1));
      }
      return;
    }
    const grass = css(lerpC([95, 158, 61], [40, 80, 48], dk));
    const grassLight = css(lerpC([133, 190, 86], [60, 104, 62], dk));
    const grassDark = css(lerpC([70, 122, 48], [28, 60, 38], dk));
    // grass band with a scalloped edge
    ctx.fillStyle = grass;
    ctx.fillRect(0, gy, W, 12);
    ctx.fillStyle = grassLight;
    for (let x = 0; x < W; x += 3) {
      const h = 1 + Math.floor(hash2(x, 1) * 3);
      ctx.fillRect(x, gy - h, 2, h + 2); // blades poking up
    }
    ctx.fillStyle = grassDark;
    for (let x = 0; x < W; x += 5) {
      if (hash2(x, 2) > 0.55) ctx.fillRect(x, gy + 6 + Math.floor(hash2(x, 5) * 4), 2, 2);
    }
    // flowers scattered in the grass
    const flowers = ['#e86a92', '#f0d05a', '#e8e8f0', '#e0784a'];
    for (let x = 4; x < W; x += 9) {
      const r = hash2(x, 9);
      if (r > 0.72 && Math.abs(x - TRUNK_X) > 26) {
        ctx.fillStyle = flowers[Math.floor(r * 20) % 4];
        ctx.fillRect(x, gy - 3, 2, 2);
        ctx.fillStyle = grassDark;
        ctx.fillRect(x, gy - 1, 1, 2);
      }
    }
    // dirt with strata and stones
    ctx.fillStyle = '#6e4a2c';
    ctx.fillRect(0, gy + 12, W, H);
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(0, gy + 12, W, 2);
    for (let x = 0; x < W; x += 8) {
      for (let row = 0; row < 10; row++) {
        const r = hash2(x, row + 3);
        if (r > 0.78) {
          ctx.fillStyle = r > 0.92 ? '#8a8078' : '#5a3a20';
          ctx.fillRect(x + Math.floor(hash2(x, row) * 6), gy + 18 + row * 9, 4, 3);
        }
      }
    }
  }

  function drawTree(alt, maxBranch) {
    const top = toScreen(0, -(maxBranch + 8) * BRANCH_DY).y;
    const bottom = Math.min(toScreen(0, 12).y, H);
    const hw = TRUNK_W / 2;
    const leaves = leafPalette(alt);
    const dk = darkness(alt);

    const trunkS = spr('trunk');
    if (trunkS) {
      // tile the bark sprite anchored to world space so it doesn't crawl
      const f = trunkS.frames[0];
      const first = Math.floor((cameraY - anchor) / f.h) - 1;
      for (let k = first; ; k++) {
        const y = anchor + k * f.h - cameraY;
        if (y > bottom) break;
        if (y + f.h < top) continue;
        drawSpr('trunk', TRUNK_X - f.w / 2, y, { dark: dk });
      }
    } else {
      // trunk: core, shaded edges, wavy bark ridges, knots
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(TRUNK_X - hw, top, TRUNK_W, bottom - top);
      ctx.fillStyle = '#7d5836';
      ctx.fillRect(TRUNK_X - hw + 4, top, 5, bottom - top);
      ctx.fillStyle = '#4a3220';
      ctx.fillRect(TRUNK_X - hw, top, 3, bottom - top);
      ctx.fillRect(TRUNK_X + hw - 4, top, 4, bottom - top);
      ctx.fillStyle = '#5a3a20';
      for (let y = Math.floor(top / 4) * 4; y < bottom; y += 4) {
        const wob = Math.floor(hash2(3, Math.floor(y / 16)) * 3);
        if (hash2(2, y) > 0.35) ctx.fillRect(TRUNK_X - 1 + wob, y, 2, 3);
        if (hash2(9, y) > 0.6) ctx.fillRect(TRUNK_X - hw + 6, y, 2, 2);
      }
      for (let y = Math.floor(top / 40) * 40; y < bottom; y += 40) {
        if (hash2(5, y) > 0.5) { // knot
          const kx = TRUNK_X - 4 + Math.floor(hash2(6, y) * 8);
          ctx.fillStyle = '#4a3220';
          pixelCircle(kx, y + 20, 3, '#4a3220');
          ctx.fillStyle = '#3a2618';
          ctx.fillRect(kx - 1, y + 19, 2, 2);
        }
      }
    }
    // roots flare (the treebase sprite replaces this, drawn over the ground)
    const g = toScreen(0, 0);
    if (g.y < H + 30 && !spr('treebase')) {
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(TRUNK_X - hw - 6, g.y + 2, TRUNK_W + 12, 8);
      ctx.fillRect(TRUNK_X - hw - 12, g.y + 7, TRUNK_W + 24, 4);
      ctx.fillStyle = '#4a3220';
      ctx.fillRect(TRUNK_X - hw - 12, g.y + 9, 6, 2);
      ctx.fillRect(TRUNK_X + hw + 6, g.y + 9, 6, 2);
    }

    // branches with leaf clusters and the odd berry
    for (let k = 1; k <= maxBranch + 6; k++) {
      const p = toScreen(TRUNK_X, -k * BRANCH_DY);
      if (p.y < -60 || p.y > H + 60) continue;
      const side = branchSide(k);
      const bs = spr('branch');
      if (bs) {
        const x = side > 0 ? TRUNK_X + hw - 8 : TRUNK_X - hw + 8 - bs.frames[0].w;
        drawSpr('branch', x, p.y - 23, { dark: dk, flip: side < 0 });
        continue;
      }
      const x0 = side > 0 ? TRUNK_X + hw - 2 : TRUNK_X - hw + 2 - BRANCH_LEN;
      // branch wood: top light, body, under-shadow, tapered tip
      ctx.fillStyle = '#5a3a20';
      ctx.fillRect(x0, p.y, BRANCH_LEN, 6);
      ctx.fillStyle = '#7d5836';
      ctx.fillRect(x0, p.y, BRANCH_LEN, 2);
      ctx.fillStyle = '#3a2618';
      ctx.fillRect(x0, p.y + 5, BRANCH_LEN, 1);
      const tipX = side > 0 ? x0 + BRANCH_LEN - 4 : x0 + 4;
      ctx.fillStyle = '#5a3a20';
      ctx.fillRect(tipX - 2, p.y - 2, 5, 3); // upturned nub
      // foliage: cluster at the tip + tuft at the trunk joint
      const r1 = 6 + Math.floor(hash2(k, 1) * 2);
      leafBlob(tipX - side * 6, p.y - 8, r1 + 2, leaves);
      leafBlob(tipX + side * 3, p.y - 4, r1, leaves);
      leafBlob(tipX - side * 2, p.y - 13, r1 - 1, leaves);
      const jointX = side > 0 ? x0 + 4 : x0 + BRANCH_LEN - 4;
      leafBlob(jointX, p.y - 6, 4, leaves);
      // berries on some branches (fade at night)
      if (hash2(k, 8) > 0.55 && darkness(alt) < 0.6) {
        ctx.fillStyle = '#d84a3a';
        ctx.fillRect(tipX - side * 9, p.y - 10, 2, 2);
        ctx.fillRect(tipX + side * 1, p.y - 15, 2, 2);
        ctx.fillRect(tipX - side * 3, p.y - 5, 2, 2);
      }
    }
  }

  // The generated tree base (roots + grass tufts) sits ON the ground layer
  function drawTreeBase(alt) {
    const s = spr('treebase');
    if (!s) return;
    const p = toScreen(0, 0);
    if (p.y > H + 100) return;
    const f = s.frames[0];
    drawSpr('treebase', TRUNK_X - f.w / 2, p.y + 20 - f.h, { dark: darkness(alt) });
  }

  // The stump the squirrel starts on: its top surface meets the ground
  // perch (branchTip(0)) so the squirrel stands ON something.
  function drawStump(alt) {
    const g = toScreen(0, 0);
    if (g.y > H + 100) return;
    const t = branchTip(0);
    const p = toScreen(t.x, t.y);
    const s = spr('stump');
    if (s) {
      const f = s.frames[0];
      drawSpr('stump', p.x - f.w / 2, p.y - 2, { dark: darkness(alt) });
    } else {
      const dk = darkness(alt);
      ctx.fillStyle = css(lerpC([90, 58, 32], [40, 30, 24], dk));
      ctx.fillRect(p.x - 11, p.y + 1, 22, 16);
      ctx.fillRect(p.x - 14, p.y + 13, 28, 4);           // root flare
      ctx.fillStyle = css(lerpC([216, 176, 106], [96, 84, 62], dk));
      ctx.fillRect(p.x - 10, p.y - 1, 20, 4);            // sawn top
      ctx.fillStyle = css(lerpC([166, 126, 66], [72, 62, 46], dk));
      ctx.fillRect(p.x - 5, p.y, 10, 2);                 // growth ring
    }
  }

  function squirrelPos(now) {
    if (!jump) return branchTip(branch);
    const t = Math.min(1, (now - jump.t0) / jump.dur);
    if (t >= 1) { branch = jump.to; jump = null; return branchTip(branch); }
    const a = branchTip(jump.from), b = branchTip(jump.to);
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * 34;
    return { x, y, mid: true };
  }

  function drawSquirrel(now) {
    const pos = squirrelPos(now);
    const p = toScreen(pos.x, pos.y);
    const scale = 2;
    const map = pos.mid ? SQ_JUMP : SQ_SIT;
    const flip = jump ? branchTip(jump.to).x < branchTip(jump.from).x
                      : branch !== 0 && branchSide(branch) > 0;
    if (sprites && sprites.squirrel) {
      const s = sprites.squirrel;
      const fr = s.frames[pos.mid ? 1 : 0];
      const img = sprImage(s, darkness(-cameraY / BRANCH_DY));
      ctx.save();
      if (flip) { ctx.translate(p.x, 0); ctx.scale(-1, 1); ctx.translate(-p.x, 0); }
      ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h,
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
    // keyboard up → the visible strip shrinks; ride the squirrel higher in
    // it than the usual 62% so he sits clearly above the keyboard
    const rel = 0.62 - (1 - viewFrac) * 0.28;
    anchor += (H * viewFrac * rel - anchor) * 0.15;
    const alt = -cameraY / BRANCH_DY;

    drawSky(alt);
    drawStars(alt);
    drawCelestials(alt, now);
    drawClouds(alt);
    drawBirds(alt, now);
    drawTree(alt, Math.max(branch, jump ? jump.to : 0));
    drawGround(alt);
    drawTreeBase(alt);
    drawStump(alt);
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
    } catch { sprites = null; }
    running = true;
    requestAnimationFrame(frame);
  }

  function reset() { branch = 0; jump = null; cameraY = branchTip(0).y; }

  function hopTo(k) {
    const from = jump ? jump.to : branch;
    if (jump) branch = jump.to;
    jump = { from, to: k, t0: performance.now(), dur: 320 };
  }

  function setViewFraction(f) {
    viewFrac = Math.max(0.35, Math.min(1, f));
  }

  return { init, reset, hopTo, setViewFraction };
})();
