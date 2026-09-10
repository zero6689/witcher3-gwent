/* ============================================================
 * 下载「小尺寸」卡图（默认宽 320px），替换 assets/cards/*.webp
 * 用法：node scripts/fetch-art-small.js [宽度]
 * 来源：_probe_gwent/gwent_urls.tsv（文件名 → CDN 原始 URL）
 *   CDN 支持 /revision/latest/scale-to-width-down/<n>
 *   320px ≈ 46 KB/张（相比原始 393px 的 86 KB 减半）
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const TSV = process.env.GWENT_TSV || 'V:/CodexProjects/_probe_gwent/gwent_urls.tsv';
const OUT = path.join(ROOT, 'assets', 'cards');
const WIDTH = Number(process.argv[2]) || 320;
const CONCURRENCY = 8;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

if (!fs.existsSync(TSV)) {
  console.error('找不到卡图清单：' + TSV);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

/* ---------- 1. TSV → 卡名 → CDN URL ---------- */
const norm = (s) => String(s || '')
  .replace(/\s*\(\d+\s*of\s*\d+\)\s*/gi, '')
  .replace(/\s*\(\d+\)\s*$/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

const lines = fs.readFileSync(TSV, 'utf8').split(/\r?\n/).filter(Boolean);
const header = lines.shift().split('\t');
const iUrl = header.indexOf('png_url') >= 0 ? header.indexOf('png_url') : header.indexOf('webp_url');
const iUsed = header.indexOf('used_by');

const byName = new Map();
for (const line of lines) {
  const cols = line.split('\t');
  if (cols.length <= iUsed) continue;
  const url = cols[iUrl];
  for (const seg of (cols[iUsed] || '').split(/[;/]/)) {
    const parts = seg.split('|').map(s => s.trim());
    if (parts.length < 2) continue;
    const key = norm(parts[1]);
    if (key && !byName.has(key)) byName.set(key, url);
  }
}

/* ---------- 2. 卡牌 id → CDN URL ---------- */
const artSrc = fs.readFileSync(path.join(ROOT, 'js', 'art.js'), 'utf8');
const localMap = JSON.parse(artSrc.match(/const CARD_ART = (\{[\s\S]*?\});/)[1]);

const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
const ids = Object.keys(localMap);
const nameById = new Map();
{
  const ctx = { console, Math, JSON, Object, Array, String, Number, Date };
  ctx.globalThis = ctx;
  const vm = require('vm');
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'art.js'), 'utf8'), ctx, { filename: 'art.js' });
  vm.runInContext(dataSrc, ctx, { filename: 'data.js' });
  vm.runInContext('globalThis.__C=ALL_CARDS;globalThis.__L=LEADERS;', ctx, { filename: 'x.js' });
  for (const [id, def] of Object.entries(ctx.__C)) nameById.set(id, def.en);
  for (const fac of Object.keys(ctx.__L)) {
    for (const l of ctx.__L[fac]) nameById.set(l.id, (l.name && l.name.en) || l.en);
  }
}

const jobs = [];
const missing = [];
for (const id of ids) {
  const url = byName.get(norm(nameById.get(id)));
  if (url) jobs.push({ id, url });
  else missing.push(id);
}

/* ---------- 3. 下载 ---------- */
function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const r = https.request(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, 'Accept': 'image/webp,image/*' },
      timeout: 40000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 4) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('TIMEOUT')));
    r.end();
  });
}
const isImage = (b) => b && b.length > 512 &&
  (b.slice(0, 4).toString('ascii') === 'RIFF' || (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xFF && b[1] === 0xD8));

(async () => {
  let ok = 0, failed = [], bytes = 0;
  const queue = jobs.slice();
  console.log(`开始下载 ${jobs.length} 张卡图（宽 ${WIDTH}px）${missing.length ? '，另有 ' + missing.length + ' 张无映射' : ''}`);
  async function worker() {
    while (queue.length) {
      const { id, url } = queue.shift();
      const target = url.replace(/\/revision\/latest.*$/, '') + `/revision/latest/scale-to-width-down/${WIDTH}`;
      try {
        const buf = await download(target);
        if (!isImage(buf)) throw new Error('不是图片 (' + buf.length + 'B)');
        fs.writeFileSync(path.join(OUT, id + '.webp'), buf);
        ok++; bytes += buf.length;
        if ((ok + failed.length) % 30 === 0) console.log(`  已处理 ${ok + failed.length}/${jobs.length}`);
      } catch (e) {
        failed.push(id + ' :: ' + e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n完成：成功 ${ok}，失败 ${failed.length}，合计 ${(bytes / 1024 / 1024).toFixed(1)} MB（平均 ${(bytes / Math.max(1, ok) / 1024).toFixed(0)} KB/张）`);
  if (failed.length) failed.slice(0, 10).forEach(f => console.log('  ✗ ' + f));
  if (missing.length) console.log('无映射：' + missing.slice(0, 10).join(', '));
  process.exit(failed.length ? 1 : 0);
})();
