/* ============================================================
 * 下载卡面到本地 assets/cards/，并把 js/art.js 改写为本地路径
 * 用法：node scripts/fetch-art.js
 * 好处：不再依赖 fandom CDN，离线 / 局域网 / 手机都能正常显示
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const ART_JS = path.join(ROOT, 'js', 'art.js');
const OUT_DIR = path.join(ROOT, 'assets', 'cards');
const CONCURRENCY = 6;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* ---------- 读取现有映射 ---------- */
const src = fs.readFileSync(ART_JS, 'utf8');
const m = src.match(/const CARD_ART = (\{[\s\S]*?\});/);
if (!m) { console.error('无法解析 js/art.js'); process.exit(1); }
const map = JSON.parse(m[1]);
const ids = Object.keys(map);

fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---------- 下载 ---------- */
function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, 'Accept': 'image/webp,image/png,image/*;q=0.8', 'Referer': 'https://witcher.fandom.com/' },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 4) {
        res.resume();
        return resolve(fetchBuffer(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('TIMEOUT')); });
    req.end();
  });
}

function isImage(buf) {
  if (!buf || buf.length < 512) return false;
  const b = buf;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
  const webp = b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP';
  const jpg = b[0] === 0xFF && b[1] === 0xD8;
  return png || webp || jpg;
}

(async () => {
  let ok = 0, skipped = 0, failed = [];
  const local = {};
  const queue = ids.slice();

  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const file = path.join(OUT_DIR, id + '.webp');
      if (fs.existsSync(file) && fs.statSync(file).size > 2048) {
        local[id] = 'assets/cards/' + id + '.webp';
        skipped++;
        continue;
      }
      try {
        const buf = await fetchBuffer(map[id]);
        if (!isImage(buf)) throw new Error('not an image (' + buf.length + 'B)');
        fs.writeFileSync(file, buf);
        local[id] = 'assets/cards/' + id + '.webp';
        ok++;
        if ((ok + skipped) % 25 === 0) console.log(`  已处理 ${ok + skipped}/${ids.length}`);
      } catch (e) {
        failed.push(id + ' :: ' + e.message);
      }
    }
  }

  console.log(`开始下载 ${ids.length} 张卡面 → ${OUT_DIR}`);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  /* ---------- 重写 art.js ---------- */
  const body = `/* 自动生成：巫师3 昆特牌卡面（本地文件，由 scripts/fetch-art.js 下载）
 * 重新下载：node scripts/fetch-art.js
 * 版权归 CD Projekt RED / 原作者所有，仅作学习用途。 */
'use strict';
const CARD_ART = ${JSON.stringify(local)};
function cardArt(def) { return (def && CARD_ART[def.defId || def.id]) || null; }
`;
  fs.writeFileSync(ART_JS, body, 'utf8');

  const totalKB = ids.reduce((a, id) => {
    const f = path.join(OUT_DIR, id + '.webp');
    return a + (fs.existsSync(f) ? fs.statSync(f).size : 0);
  }, 0) / 1024;

  console.log(`\n完成：新增 ${ok}，已存在 ${skipped}，失败 ${failed.length}，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`本地体积：${(totalKB / 1024).toFixed(1)} MB（${local ? Object.keys(local).length : 0}/${ids.length} 张已映射）`);
  if (failed.length) {
    console.log('\n失败清单：');
    failed.forEach(f => console.log('  - ' + f));
  }
  process.exit(failed.length ? 1 : 0);
})();
