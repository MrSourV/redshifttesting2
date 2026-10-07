// pixel / grain effects: hero horizon, logo loader, dither reveals

const FX_REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// palette pulled from the logo
const PAL = {
  rim:     [255, 214, 214],
  red:     [242, 35, 47],
  crimson: [204, 32, 84],
  plum:    [110, 22, 70],
  ink:     [9, 9, 11],
};

// cheap deterministic hash -> [0,1)
function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n, 9);
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}

// ---------- horizon: a glowing planet edge that dissolves into dithered pixels ----------
function Horizon(canvas, opts) {
  opts = Object.assign({ cell: 3, rise: 0.86, image: null, imageStrength: 0.32, flip: false }, opts);
  const ctx = canvas.getContext('2d');
  let W, H, cols, rows, P, phase, speed, col32, img, buf, running = false, raf, last = 0;
  let mouse = { x: -1e4, y: -1e4, a: 0 };
  let imgLum = null;

  // pre-sample the background photo into luminance once it loads
  let photo = null;
  if (opts.image) {
    photo = new Image();
    photo.onload = () => { if (cols) build(); };
    photo.src = opts.image;
  }

  function sampleImage() {
    if (!photo || !photo.complete || !photo.naturalWidth) return null;
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const g = c.getContext('2d');
    // cover-fit
    const s = Math.max(cols / photo.naturalWidth, rows / photo.naturalHeight);
    const w = photo.naturalWidth * s, h = photo.naturalHeight * s;
    g.drawImage(photo, (cols - w) / 2, (rows - h) * 0.35, w, h);
    let d;
    try { d = g.getImageData(0, 0, cols, rows).data; } catch (e) { return null; } // file:// taints canvas
    const out = new Float32Array(cols * rows);
    for (let i = 0; i < out.length; i++) {
      const l = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
      out[i] = Math.pow(l, 1.6);
    }
    return out;
  }

  function build() {
    const r = canvas.getBoundingClientRect();
    const cell = r.width < 700 ? Math.max(2, opts.cell - 1) : opts.cell;
    cols = Math.max(1, Math.ceil(r.width / cell));
    rows = Math.max(1, Math.ceil(r.height / cell));
    canvas.width = cols; canvas.height = rows;
    W = cols; H = rows;

    img = ctx.createImageData(cols, rows);
    buf = new Uint32Array(img.data.buffer);
    const n = cols * rows;
    P = new Float32Array(n);
    phase = new Float32Array(n);
    speed = new Float32Array(n);
    col32 = new Float32Array(n * 3);
    imgLum = sampleImage();

    // planet: huge circle whose top sits at `rise` of the height
    // portrait screens get a rounder planet sitting lower
    const portrait = H > W * 1.1;
    const R = portrait ? W * 1.3 : Math.max(W * 1.7, H * 2.4);
    const cx = W * 0.5;
    const top = H * (portrait ? Math.max(opts.rise, 0.93) : opts.rise);
    const cy = top + R;
    const k = Math.max(W, H * 0.9) / 640; // keep falloff consistent across sizes
    const fRim = 1.6 * k, fRed = 8 * k, fCrim = 34 * k, fPlum = 130 * k;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const yy = opts.flip ? H - 1 - y : y;
        const dx = x - cx, dy = yy - cy;
        const d = Math.hypot(dx, dy) - R; // distance outside the planet
        const ang = Math.atan2(dy, dx);
        // vignette toward the sides
        const vx = (x - cx) / (W * 0.62);
        const vig = Math.max(0.18, 1 - vx * vx * vx * vx);
        // faint banding across the rim
        const band = 1 + 0.18 * Math.sin(ang * 140);

        let p = 0, c = null;
        if (d < 0) {
          // inside the planet: near-black with a whisper of rim light
          const inner = Math.exp(d / (2.2 * k)) * 0.9;
          p = inner; c = PAL.red;
        } else {
          const a = Math.exp(-d / fRim);
          const b = Math.exp(-d / fRed) * 0.95;
          const e = Math.exp(-d / fCrim) * Math.min(1, d / (6 * k)) * 0.62;
          const f = Math.exp(-d / fPlum) * Math.min(1, d / (20 * k)) * 0.3;
          p = Math.min(1, a + b + e + f);
          const pick = hash(i ^ 0x2f6b1a3) * p;
          c = pick < a ? PAL.rim : pick < a + b ? PAL.red : pick < a + b + e ? PAL.crimson : PAL.plum;
        }
        // darker toward the far edge so the copy sits in shadow
        const fall = 0.25 + 0.75 * Math.min(1, yy / H);
        p *= vig * (d > 0 ? fall : 1);
        let br = vig * band;

        // dithered photo underneath
        if (imgLum && d > 0) {
          const ip = imgLum[i] * opts.imageStrength * Math.min(1, d / (30 * k)) * fall;
          if (hash(i ^ 0x51ed27) < ip / (p + ip + 1e-6)) { c = ip > 0.16 ? PAL.crimson : PAL.plum; br = 0.55 + ip; }
          p = 1 - (1 - p) * (1 - ip);
        }

        P[i] = p;
        phase[i] = hash(i * 7 + 13);
        speed[i] = 0.05 + hash(i * 31 + 7) * 0.22;
        const grain = 1 + (hash(i ^ 0x9e3779b9) - 0.5) * 0.35;
        col32[i * 3]     = c[0] * br * grain;
        col32[i * 3 + 1] = c[1] * br * grain;
        col32[i * 3 + 2] = c[2] * br * grain;
      }
    }
    draw(performance.now());
  }

  const bg = (255 << 24) | (PAL.ink[2] << 16) | (PAL.ink[1] << 8) | PAL.ink[0];

  function draw(now) {
    const t = now / 1000;
    const n = W * H;
    // mouse in cell space
    const mr = 46 * (Math.max(W, H * 0.9) / 640), mr2 = mr * mr;
    for (let i = 0; i < n; i++) {
      let p = P[i];
      if (p < 0.002) { buf[i] = bg; continue; }
      // each pixel breathes on its own clock -> triangle wave threshold
      let f = phase[i] + t * speed[i]; f -= Math.floor(f);
      const thr = f < 0.5 ? f * 2 : 2 - f * 2;
      if (mouse.a > 0) {
        const x = i % W, y = (i / W) | 0;
        const dx = x - mouse.x, dy = y - mouse.y, dd = dx * dx + dy * dy;
        if (dd < mr2) p += (1 - dd / mr2) * 0.35 * mouse.a;
      }
      let a = (p - thr) * 5 + 0.5;
      if (a <= 0) { buf[i] = bg; continue; }
      if (a > 1) a = 1;
      const j = i * 3;
      const r = PAL.ink[0] + (col32[j] - PAL.ink[0]) * a;
      const g = PAL.ink[1] + (col32[j + 1] - PAL.ink[1]) * a;
      const b = PAL.ink[2] + (col32[j + 2] - PAL.ink[2]) * a;
      buf[i] = (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
    }
    // sparse salt & pepper speckle, re-rolled every frame
    const specks = (n * 0.0025) | 0;
    const seed = (t * 60) | 0;
    for (let s = 0; s < specks; s++) {
      const i = (hash(seed * 7919 + s) * n) | 0;
      buf[i] = hash(i + seed) < 0.5 ? bg : (255 << 24) | (60 << 16) | (40 << 8) | 90;
    }
    ctx.putImageData(img, 0, 0);
  }

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (now - last < 33) return; // ~30fps is plenty for this
    last = now;
    if (mouse.a > 0 && !mouse.on) mouse.a = Math.max(0, mouse.a - 0.04);
    draw(now);
  }

  function start() { if (running || FX_REDUCED) return; running = true; raf = requestAnimationFrame(loop); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  // only animate while visible
  new IntersectionObserver(es => es[0].isIntersecting ? start() : stop()).observe(canvas);

  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(build, 150); }, { passive: true });

  const host = canvas.parentElement;
  host.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width * W;
    mouse.y = (e.clientY - r.top) / r.height * H;
    mouse.on = true; mouse.a = Math.min(1, mouse.a + 0.15);
  }, { passive: true });
  host.addEventListener('pointerleave', () => { mouse.on = false; });

  build();
}

// ---------- logo assembled from pixels (loader) ----------
function PixelLogo(canvas, src) {
  const ctx = canvas.getContext('2d');
  const CW = 64, CH = 85; // cell grid, matches logo aspect
  canvas.width = CW; canvas.height = CH;
  const img = ctx.createImageData(CW, CH);
  const buf = new Uint32Array(img.data.buffer);
  let cells = [], t0 = performance.now(), outAt = 0, raf, ready = false, fallback = false;

  const logo = new Image();
  logo.onload = () => {
    const c = document.createElement('canvas');
    c.width = CW; c.height = CH;
    const g = c.getContext('2d');
    g.drawImage(logo, 0, 0, CW, CH);
    let d;
    try { d = g.getImageData(0, 0, CW, CH).data; }
    catch (e) { fallback = true; ready = true; return; } // file:// taints canvas, just draw it chunky

    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const i = y * CW + x, a = d[i * 4 + 3];
      if (a < 90) continue;
      let r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
      // lift the black stroke so it reads on the dark page
      if (r + gg + b < 200) { const v = 46 + (r + gg + b) / 3; r = gg = b = v; }
      const n = 1 + (hash(i ^ 0xabc) - 0.5) * 0.3;
      cells.push({
        i, r: r * n, g: gg * n, b: b * n,
        // assemble bottom-up with scatter
        delay: (1 - y / CH) * 0.7 + hash(i * 3) * 0.6,
        out: hash(i * 5 + 1) * 0.5,
        tw: hash(i * 11) * 6.28,
      });
    }
    ready = true;
  };
  logo.src = src;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    buf.fill(0);
    const t = (now - t0) / 1000;
    const to = outAt ? (now - outAt) / 1000 : 0;
    if (!ready) return;
    if (fallback) {
      ctx.clearRect(0, 0, CW, CH);
      ctx.globalAlpha = outAt ? Math.max(0, 1 - to / 0.6) : Math.min(1, t / 0.8);
      ctx.drawImage(logo, 0, 0, CW, CH);
      return;
    }
    let alive = false;
    for (const c of cells) {
      let a = Math.min(1, Math.max(0, (t - c.delay) / 0.22));
      // once formed, a slow shimmer runs through the pixels
      if (a >= 1) a = 0.82 + 0.18 * Math.sin(t * 3 + c.tw + c.i * 0.002);
      if (outAt) a *= 1 - Math.min(1, Math.max(0, (to - c.out) / 0.2));
      if (a <= 0.01) continue;
      alive = true;
      // stepped alpha keeps it crunchy
      a = Math.round(a * 4) / 4;
      buf[c.i] = ((a * 255) << 24) | ((c.b > 255 ? 255 : c.b) << 16) | ((c.g > 255 ? 255 : c.g) << 8) | (c.r > 255 ? 255 : c.r);
    }
    ctx.putImageData(img, 0, 0);
    if (outAt && !alive) cancelAnimationFrame(raf);
  }
  raf = requestAnimationFrame(frame);

  return {
    dissolve() { outAt = performance.now(); },
  };
}

// ---------- dither dissolve reveal (bayer masks) ----------
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];
const DITHER_STEPS = 16;
const ditherMasks = (() => {
  const out = [];
  // 8x8 bayer at 4px per cell so the mask stays crisp when the browser scales it
  const Z = 4, c = document.createElement('canvas');
  c.width = c.height = 8 * Z;
  const g = c.getContext('2d');
  for (let s = 0; s <= DITHER_STEPS; s++) {
    g.clearRect(0, 0, c.width, c.height);
    for (let k = 0; k < 64; k++) {
      if (BAYER[k] < (s / DITHER_STEPS) * 64) g.fillRect((k % 8) * Z, (k >> 3) * Z, Z, Z);
    }
    out.push(`url(${c.toDataURL()})`);
  }
  return out;
})();

function ditherIn(el, dur = 520, delay = 0) {
  if (FX_REDUCED) { el.classList.add('in'); return; }
  const set = m => { el.style.webkitMaskImage = m; el.style.maskImage = m; };
  set(ditherMasks[0]);
  setTimeout(() => {
    el.classList.add('in');
    const t0 = performance.now();
    (function step(now) {
      const p = Math.min(1, (now - t0) / dur);
      const s = Math.round(p * DITHER_STEPS);
      if (p < 1) { set(ditherMasks[s]); requestAnimationFrame(step); }
      else { set(''); }
    })(t0);
  }, delay);
}

// dithered gradient strip used for section rules
(function () {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 2;
  const g = c.getContext('2d');
  const id = g.createImageData(256, 2);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 256; x++) {
    const d = Math.abs(x - 128) / 128;
    const p = Math.pow(1 - d, 1.8);
    const k = (y * 256 + x);
    const on = BAYER[(y % 8) * 8 + (x % 8)] / 64 < p;
    const hot = p > 0.7;
    id.data[k * 4] = hot ? 242 : 204;
    id.data[k * 4 + 1] = hot ? 35 : 32;
    id.data[k * 4 + 2] = hot ? 47 : 84;
    id.data[k * 4 + 3] = on ? 255 : 0;
  }
  g.putImageData(id, 0, 0);
  document.documentElement.style.setProperty('--dither-rule', `url(${c.toDataURL()})`);
})();
