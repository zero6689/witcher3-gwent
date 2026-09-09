/* ============================================================
 * 用自定义图片生成全套图标（PWA + Android）
 * 源图：assets/icon-src/witcher3.png（默认；可换成任意方形 PNG）
 * 用法：node scripts/make-icons-from-image.js [源图路径]
 * 输出：icons/*.png、android-app/assets/*.png、android res/mipmap-*、启动图
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { decodePNG, resize, composite, circleMask } = require('./png-lib.js');
const { encodePNG } = require('./make-icons.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.argv[2] || path.join(ROOT, 'assets', 'icon-src', 'witcher3.png');
const BG = [11, 7, 5];                       // #0B0705 深棕底

if (!fs.existsSync(SRC)) {
  console.error('找不到源图：' + SRC);
  console.error('请把一张方形 PNG 放到 assets/icon-src/witcher3.png（或作为参数传入）');
  process.exit(1);
}

function write(file, rgba, w, h) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePNG(w, h, rgba));
}

/* ---------- 1. 解码 + 圆形裁切 ---------- */
const img = decodePNG(fs.readFileSync(SRC));
console.log(`源图 ${img.width}×${img.height}  ${(fs.statSync(SRC).size / 1024).toFixed(0)} KB`);
const art = Buffer.from(img.data);
const R = circleMask(art, img.width, img.height);
console.log(`圆形裁切半径 ${R.toFixed(1)}px（画布 ${img.width}px）`);
const AW = img.width, AH = img.height;

/* ---------- 2. PWA / 网页图标 ---------- */
write(path.join(ROOT, 'icons', 'icon-512.png'), resize(art, AW, AH, 512, 512), 512, 512);
write(path.join(ROOT, 'icons', 'icon-192.png'), resize(art, AW, AH, 192, 192), 192, 192);
write(path.join(ROOT, 'icons', 'apple-touch-icon.png'), resize(art, AW, AH, 180, 180), 180, 180);
write(path.join(ROOT, 'icons', 'favicon-32.png'), resize(art, AW, AH, 32, 32), 32, 32);
// maskable：内容缩到 78% 落在安全圆内，四周补深色底
write(path.join(ROOT, 'icons', 'icon-maskable-512.png'), composite(art, AW, AH, 512, 0.78, BG), 512, 512);

/* ---------- 3. Android 工程图标源（供 Capacitor / 参考） ---------- */
write(path.join(ROOT, 'android-app', 'assets', 'icon-only.png'), resize(art, AW, AH, 1024, 1024), 1024, 1024);
write(path.join(ROOT, 'android-app', 'assets', 'icon-foreground.png'), composite(art, AW, AH, 1024, 0.62, null), 1024, 1024);
write(path.join(ROOT, 'android-app', 'assets', 'icon-background.png'), composite(art, 1, 1, 1024, 0, BG), 1024, 1024);
write(path.join(ROOT, 'android-app', 'assets', 'splash.png'), composite(art, AW, AH, 2732, 0.28, BG), 2732, 2732);

/* ---------- 4. Android res：各密度图标 + 启动图 ---------- */
const RES = path.join(ROOT, 'android-app', 'android', 'app', 'src', 'main', 'res');
const DENSITIES = [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]];
if (fs.existsSync(RES)) {
  for (const [d, size] of DENSITIES) {
    const dir = path.join(RES, 'mipmap-' + d);
    write(path.join(dir, 'ic_launcher.png'), resize(art, AW, AH, size, size), size, size);
    write(path.join(dir, 'ic_launcher_round.png'), resize(art, AW, AH, size, size), size, size);
    const fg = Math.round(size * 108 / 48);
    write(path.join(dir, 'ic_launcher_foreground.png'), composite(art, AW, AH, fg, 0.62, null), fg, fg);
  }
  // 自适应图标 XML + 背景色
  const anydpi = path.join(RES, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpi, { recursive: true });
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), xml);
  fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), xml);
  fs.mkdirSync(path.join(RES, 'values'), { recursive: true });
  fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0B0705</color>
</resources>
`);
  // 启动图：按模板原有尺寸重绘
  function pngSize(file) {
    const b = fs.readFileSync(file);
    if (b.length < 24 || b[0] !== 0x89) return null;
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
  let n = 0;
  for (const f of walk(RES)) {
    const dim = pngSize(f);
    if (!dim || dim.w < 2 || dim.h < 2 || dim.w > 4096 || dim.h > 4096) continue;
    const art2 = composite(art, AW, AH, Math.min(dim.w, dim.h), 0.42, null);
    // 合成到目标尺寸（深色底）
    const canvas = Buffer.alloc(dim.w * dim.h * 4);
    for (let i = 0; i < dim.w * dim.h; i++) { canvas[i * 4] = BG[0]; canvas[i * 4 + 1] = BG[1]; canvas[i * 4 + 2] = BG[2]; canvas[i * 4 + 3] = 255; }
    const side = Math.min(dim.w, dim.h);
    const ox = Math.round((dim.w - side) / 2), oy = Math.round((dim.h - side) / 2);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const so = (y * side + x) * 4;
      const a = art2[so + 3] / 255;
      const dof = ((oy + y) * dim.w + (ox + x)) * 4;
      canvas[dof] = Math.round(art2[so] * a + canvas[dof] * (1 - a));
      canvas[dof + 1] = Math.round(art2[so + 1] * a + canvas[dof + 1] * (1 - a));
      canvas[dof + 2] = Math.round(art2[so + 2] * a + canvas[dof + 2] * (1 - a));
    }
    fs.writeFileSync(f, encodePNG(dim.w, dim.h, canvas));
    n++;
  }
  console.log(`Android res：15 个图标 + ${n} 张启动图`);
} else {
  console.log('（未找到 Android res 目录，跳过 Android 图标）');
}

console.log('\n完成。源图：' + SRC);
