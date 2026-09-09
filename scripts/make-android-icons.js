/* ============================================================
 * 直接生成 Android 各密度图标与启动图（不依赖 sharp / @capacitor/assets）
 * 用法：node scripts/make-android-icons.js
 * 前提：android-app/android 工程已由 cap add android 生成
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { drawIcon, drawSplash, encodePNG } = require('./make-icons.js');

const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'android-app', 'android', 'app', 'src', 'main', 'res');

if (!fs.existsSync(RES)) {
  console.error('未找到 Android res 目录：' + RES + '\n请先运行 scripts\\build-apk.ps1（会执行 cap add android）');
  process.exit(1);
}

function write(file, rgba, w, h) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePNG(w, h, rgba));
}

/* ---------- 1. 启动图标（legacy + 圆形 + 自适应前景） ---------- */
const DENSITIES = [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]];
let count = 0;
for (const [d, size] of DENSITIES) {
  const dir = path.join(RES, 'mipmap-' + d);
  write(path.join(dir, 'ic_launcher.png'), drawIcon(size, { scale: 0.9, ringR: 0.437 }), size, size);
  write(path.join(dir, 'ic_launcher_round.png'), drawIcon(size, { scale: 0.9, ringR: 0.437, round: true }), size, size);
  const fg = Math.round(size * 108 / 48);      // 自适应前景为 108dp
  write(path.join(dir, 'ic_launcher_foreground.png'),
    drawIcon(fg, { scale: 0.55, ringR: 0.30, transparent: true, emberR: 0.34 }), fg, fg);
  count += 3;
  console.log(`mipmap-${d.padEnd(9)} ic_launcher ${size}px · round ${size}px · foreground ${fg}px`);
}

/* ---------- 2. 自适应图标 XML + 背景色 ---------- */
const anydpi = path.join(RES, 'mipmap-anydpi-v26');
fs.mkdirSync(anydpi, { recursive: true });
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptiveXml);
fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptiveXml);
fs.mkdirSync(path.join(RES, 'values'), { recursive: true });
fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0B0705</color>
</resources>
`);
console.log('已写入 mipmap-anydpi-v26 自适应图标 XML 与背景色 #0B0705');

/* ---------- 3. 启动图：按模板原有尺寸重绘 ---------- */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function walk(dir, acc = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (n === 'splash.png') acc.push(p);
  }
  return acc;
}
let splashes = 0;
for (const f of walk(RES)) {
  const dim = pngSize(f);
  if (!dim || dim.w < 2 || dim.h < 2 || dim.w > 4096 || dim.h > 4096) continue;
  fs.writeFileSync(f, encodePNG(dim.w, dim.h, drawSplash(dim.w, dim.h)));
  splashes++;
}
console.log(`已重绘 ${splashes} 张启动图（保持原尺寸）`);

console.log(`\n完成：${count} 个图标 + ${splashes} 张启动图 → ${RES}`);
