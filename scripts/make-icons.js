/* ============================================================
 * 生成应用图标（纯 Node，无需任何图像库）
 * 图案 = 开场动画的狼首徽章（金色圆环 + 狼头剪影 + 余烬）
 * 输出：icons/*.png（PWA）、android-app/assets/*.png（Capacitor 图标源）
 * 用法：node scripts/make-icons.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

/* ---------------- 最小 PNG 编码器 ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 画布工具（超采样抗锯齿） ---------------- */
function makeCanvas(size, ss) {
  const W = size * ss, H = size * ss;
  const buf = new Float32Array(W * H * 4);   // 0..1 线性累加
  return {
    W, H, ss, buf,
    set(x, y, r, g, b, a) {
      if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
      const i = (y * W + x) * 4;
      const ia = 1 - a;
      buf[i] = buf[i] * ia + r * a;
      buf[i + 1] = buf[i + 1] * ia + g * a;
      buf[i + 2] = buf[i + 2] * ia + b * a;
      buf[i + 3] = buf[i + 3] * ia + a;
    },
  };
}
function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function fillCircle(cv, cx, cy, r, col, alpha = 1) {
  const [cr, cg, cb] = hex(col);
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(cv.W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(cv.H - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2) {
      const edge = Math.min(1, (r - Math.sqrt(d2)) * 1.2 + 0.5);
      cv.set(x, y, cr, cg, cb, alpha * Math.min(1, edge));
    }
  }
}
function ringCircle(cv, cx, cy, r, w, col, alpha = 1) {
  const [cr, cg, cb] = hex(col);
  const ro = r + w / 2, ri = r - w / 2;
  const x0 = Math.max(0, Math.floor(cx - ro)), x1 = Math.min(cv.W - 1, Math.ceil(cx + ro));
  const y0 = Math.max(0, Math.floor(cy - ro)), y1 = Math.min(cv.H - 1, Math.ceil(cy + ro));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= ro && d >= ri) {
      const e = Math.min(1, Math.min(ro - d, d - ri) * 1.2 + 0.5);
      cv.set(x, y, cr, cg, cb, alpha * Math.max(0, e));
    }
  }
}
function fillPoly(cv, pts, col, alpha = 1) {
  const [cr, cg, cb] = hex(col);
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const [x, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(cv.H - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + (y - ay) / (by - ay) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k])), xb = Math.min(cv.W - 1, Math.ceil(xs[k + 1]));
      for (let x = xa; x <= xb; x++) cv.set(x, y, cr, cg, cb, alpha);
    }
  }
}
/** 旋转矩形（眼睛等） */
function fillRotRect(cv, cx, cy, hw, hh, deg, col, alpha = 1) {
  const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) =>
    [cx + x * ca - y * sa, cy + x * sa + y * ca]);
  fillPoly(cv, pts, col, alpha);
}
function downsample(cv, size) {
  const out = Buffer.alloc(size * size * 4);
  const s = cv.ss, n = s * s;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const i = ((y * s + dy) * cv.W + (x * s + dx)) * 4;
      r += cv.buf[i]; g += cv.buf[i + 1]; b += cv.buf[i + 2]; a += cv.buf[i + 3];
    }
    const o = (y * size + x) * 4;
    out[o] = Math.round(Math.min(1, r / n) * 255);
    out[o + 1] = Math.round(Math.min(1, g / n) * 255);
    out[o + 2] = Math.round(Math.min(1, b / n) * 255);
    out[o + 3] = Math.round(Math.min(1, a / n) * 255);
  }
  return out;
}

/* ---------------- 图案绘制 ---------------- */
/**
 * @param {number} size 输出边长
 * @param {object} opt  { scale: 狼头缩放, ringR: 金环半径(0 则不画), transparent, bgOnly }
 */
function drawIcon(size, opt) {
  opt = opt || {};
  const scale = opt.scale == null ? 1 : opt.scale;
  const ringR = opt.ringR == null ? 0.437 : opt.ringR;
  const ss = 3;
  const cv = makeCanvas(size, ss);
  const S = size * ss;
  const P = (v) => v * S;

  // 背景：深棕径向渐变（bgOnly 时只画背景）
  if (!opt.transparent) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x / S - 0.5) * 2, dy = (y / S - 0.5) * 2;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 1.25);
      const k = Math.pow(1 - d, 1.4);
      const r = 0.075 + 0.115 * k, g = 0.052 + 0.075 * k, b = 0.032 + 0.045 * k;
      cv.set(x, y, r, g, b, 1);
    }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x / S - 0.5) * 2, dy = (y / S - 0.5) * 2;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 1.42);
      cv.set(x, y, 0, 0, 0, 0.42 * Math.pow(d, 2.2));
    }
  }
  if (opt.bgOnly) return downsample(cv, size);

  // 金环（可指定半径；自适应图标前景用小半径以留在安全区内）
  if (ringR > 0) {
    ringCircle(cv, P(0.5), P(0.5), P(ringR), P(0.026 * (opt.ringW || 1)), '#d9b56b', 1);
    ringCircle(cv, P(0.5), P(0.5), P(ringR * 0.915), P(0.008 * (opt.ringW || 1)), '#f0d9a0', 0.55);
  }

  // ---- 狼头（中心 0.5, 0.485；整体按 scale 缩放）----
  const cx = 0.5, cy = 0.485;
  const T = (x, y) => [P(cx + (x - 0.5) * scale), P(cy + (y - cy) * scale)];

  // 耳朵：加长、收窄、向内聚（避免像狐狸）
  const earL = [T(0.318, 0.150), T(0.412, 0.330), T(0.318, 0.400)];
  const earR = [T(0.682, 0.150), T(0.588, 0.330), T(0.682, 0.400)];
  // 头部：上宽下收，下巴收成尖
  const head = [
    T(0.302, 0.332), T(0.698, 0.332), T(0.648, 0.520), T(0.572, 0.648),
    T(0.500, 0.782), T(0.428, 0.648), T(0.352, 0.520),
  ];
  // 眼睛：显式镜像多边形（保证左右完全对称）
  const eyeL = [T(0.398, 0.452), T(0.470, 0.468), T(0.466, 0.496), T(0.392, 0.480)];
  const eyeR = eyeL.map(([x, y]) => [2 * P(0.5) - x, y]);

  // 外发光
  for (const [k, a] of [[1.10, 0.10], [1.055, 0.16]]) {
    const sc = (pts) => pts.map(([x, y]) => [P(0.5) + (x - P(0.5)) * k, P(0.5) + (y - P(0.5)) * k]);
    fillPoly(cv, sc(head), '#d9b56b', a);
    fillPoly(cv, sc(earL), '#d9b56b', a);
    fillPoly(cv, sc(earR), '#d9b56b', a);
  }

  fillPoly(cv, earL, '#e8cd93', 1);
  fillPoly(cv, earR, '#e8cd93', 1);
  fillPoly(cv, head, '#e8cd93', 1);

  // 内耳
  fillPoly(cv, [T(0.332, 0.196), T(0.396, 0.330), T(0.338, 0.372)], '#3a2410', 0.85);
  fillPoly(cv, [T(0.668, 0.196), T(0.604, 0.330), T(0.662, 0.372)], '#3a2410', 0.85);

  // 吻部：一整块向下的楔形（居中），不再是两片散件
  fillPoly(cv, [T(0.432, 0.548), T(0.568, 0.548), T(0.500, 0.760)], '#c9a35c', 0.85);
  // 鼻：居中小楔形
  fillPoly(cv, [T(0.470, 0.556), T(0.530, 0.556), T(0.500, 0.618)], '#2a1a0a', 0.95);

  // 眼睛（镜像，琥珀色）
  fillPoly(cv, eyeL, '#ffd24a', 1);
  fillPoly(cv, eyeR, '#ffd24a', 1);

  // 余烬：放大提亮，位置分布在下环两侧 + 上方一颗
  const embers = [
    [0.215, 0.760, 0.017, 0.95], [0.785, 0.735, 0.015, 0.95],
    [0.330, 0.885, 0.013, 0.85], [0.672, 0.890, 0.012, 0.85],
    [0.500, 0.155, 0.014, 0.9],
  ];
  for (const [ex, ey, er, ea] of embers) {
    fillCircle(cv, P(ex), P(ey), P(er * (0.6 + 0.4 * scale)), '#ffb45a', ea);
    fillCircle(cv, P(ex), P(ey), P(er * 0.45 * (0.6 + 0.4 * scale)), '#fff0c8', ea * 0.9);
  }

  return downsample(cv, size);
}

/* ---------------- 输出 ---------------- */
const outDir = path.join(ROOT, 'icons');
const andDir = path.join(ROOT, 'android-app', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(andDir, { recursive: true });

const targets = [
  // PWA / 网页图标：完整金环 + 狼头（头缩小到 0.9，下巴不再顶环）
  ['icons/icon-192.png', 192, { scale: 0.9, ringR: 0.437 }],
  ['icons/icon-512.png', 512, { scale: 0.9, ringR: 0.437 }],
  ['icons/apple-touch-icon.png', 180, { scale: 0.9, ringR: 0.437 }],
  ['icons/favicon-32.png', 32, { scale: 0.98, ringR: 0.42, ringW: 1.7 }],
  // maskable：内容收进安全区（半径 ≤ 0.4）
  ['icons/icon-maskable-512.png', 512, { scale: 0.72, ringR: 0.355 }],
  // Android 自适应图标：前景层带金环（半径 0.30，落在 66% 安全区内），背景层只有渐变
  ['android-app/assets/icon-only.png', 1024, { scale: 0.9, ringR: 0.437 }],
  ['android-app/assets/icon-foreground.png', 1024, { scale: 0.55, ringR: 0.30, transparent: true }],
  ['android-app/assets/icon-background.png', 1024, { bgOnly: true }],
  ['android-app/assets/splash.png', 2732, { scale: 0.42, ringR: 0.24, transparent: true }],
];

for (const [rel, size, opt] of targets) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rgba = drawIcon(size, opt);
  const png = encodePNG(size, size, rgba);
  fs.writeFileSync(file, png);
  console.log(`${rel.padEnd(42)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
console.log('\n图标生成完成。');
