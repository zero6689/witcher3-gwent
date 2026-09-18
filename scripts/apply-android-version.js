/* ============================================================
 * 把根 package.json 的版本写进 Android 工程的 versionCode / versionName
 *
 * 为什么要有这个脚本：
 *   `npx cap add android` 生成的模板写死 versionCode 1 / versionName "1.0"，
 *   之前只有本地 build-apk.ps1 里一段 PowerShell 会改它 ⇒ 云端 CI 出的包
 *   版本号永远是 1.0（实测 v1.0.5 的 Release 包就是 versionCode=1/versionName=1.0）。
 *   现在本地与 CI 共用这一个脚本，两边不再漂移。
 *
 * 用法：node scripts/apply-android-version.js
 * 口径：versionCode = 各段两位拼接（1.1.1 → 10101），versionName = 原样
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const gradle = path.join(ROOT, 'android-app', 'android', 'app', 'build.gradle');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const ver = String(pkg.version || '').trim();

if (!/^\d+(?:\.\d+)*$/.test(ver)) {
  console.error(`[version] package.json 里的 version 不可用：${JSON.stringify(pkg.version)}`);
  process.exit(1);
}
if (!fs.existsSync(gradle)) {
  console.error(`[version] 未找到 ${gradle}（先跑 npx cap add android）`);
  process.exit(1);
}

const code = Math.max(1, parseInt(ver.split('.').map(n => String(n).padStart(2, '0')).join(''), 10) || 1);

let txt = fs.readFileSync(gradle, 'utf8');
const before = txt;
txt = txt.replace(/versionCode\s+\d+/, `versionCode ${code}`);
txt = txt.replace(/versionName\s+"[^"]*"/, `versionName "${ver}"`);
if (txt === before) {
  console.error('[version] build.gradle 里没找到 versionCode/versionName，模板可能变了');
  process.exit(1);
}
fs.writeFileSync(gradle, txt);

// 硬门：写完再读回来断言，避免"看起来改了其实没改"
const after = fs.readFileSync(gradle, 'utf8');
const gotCode = (after.match(/versionCode\s+(\d+)/) || [])[1];
const gotName = (after.match(/versionName\s+"([^"]*)"/) || [])[1];
if (gotCode !== String(code) || gotName !== ver) {
  console.error(`[version] 校验失败：versionCode=${gotCode} versionName=${gotName}`);
  process.exit(1);
}
console.log(`[version] Android 版本：versionCode=${code}  versionName=${ver}`);
