/* ============================================================
 * 把网页游戏打包进 android-app/www（供 Capacitor 打包 APK）
 * 用法：node scripts/prepare-www.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'android-app', 'www');

/* 需要打进 APK 的目录/文件（不含测试、脚本、Android 工程本身） */
const INCLUDE = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'css',
  'js',
  'assets',
  'icons',
];

/* 只应存在于开发机、不该进 APK 的东西（否则白涨十几 MB） */
const EXCLUDE_DIRS = new Set([
  'cards.bak',      // 卡面压缩前的备份（12 MB）
  'icon-src',       // 图标源图（应用图标已生成到 icons/ 与 android res/）
  'out',            // 性能体检产物
  '.tools', '.npm-cache', '.npm-tmp', '.release', 'node_modules',
  'test', 'scripts', 'android-app', '.git', '.github', '.vscode',
]);

function copyRecursive(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (EXCLUDE_DIRS.has(name) || name.startsWith('.')) continue;
      copyRecursive(path.join(src, name), path.join(dst, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

let files = 0, bytes = 0;
for (const rel of INCLUDE) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { console.warn('跳过（不存在）：' + rel); continue; }
  copyRecursive(src, path.join(WWW, rel));
}
for (const f of (function walk(dir, acc = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
})(WWW)) { files++; bytes += fs.statSync(f).size; }

console.log(`已准备 android-app/www：${files} 个文件，${(bytes / 1024 / 1024).toFixed(1)} MB`);
