/* 生成 js/art.js：把调研得到的卡面 URL 映射到本项目的卡牌 id
 * 输入：V:\CodexProjects\_probe_gwent\gwent_urls.tsv (filename/hash/webp_url/png_url/copies/used_by)
 * 输出：V:\CodexProjects\gwent-web\js\art.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const TSV = 'V:/CodexProjects/_probe_gwent/gwent_urls.tsv';
const ROOT = 'V:/CodexProjects/gwent-web/js';
const OUT = path.join(ROOT, 'art.js');

// ---- 1. 载入项目卡池 ----
const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date };
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
vm.runInContext('globalThis.CARDS=CARDS;globalThis.LEADERS=LEADERS;', ctx, { filename: 'e.js' });

const norm = (s) => String(s || '')
  .replace(/\s*\(\d+\s*of\s*\d+\)\s*/gi, '')   // "Arachas (1 of 3)" → "Arachas"
  .replace(/\s*\(\d+\)\s*$/g, '')              // "X (2)" → "X"
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

// ---- 2. 解析 TSV：cardName → url ----
const lines = fs.readFileSync(TSV, 'utf8').split(/\r?\n/).filter(Boolean);
const header = lines.shift().split('\t');
const iName = header.indexOf('webp_url');
const iUsed = header.indexOf('used_by');
const iFile = header.indexOf('filename');

const byName = new Map();     // normName -> url
for (const line of lines) {
  const cols = line.split('\t');
  if (cols.length <= iUsed) continue;
  const url = cols[iName];
  const used = cols[iUsed] || '';
  // used_by 形如 "Monsters|Arachas (1 of 3)|Base game"，可能有多段用 / 或 ; 分隔
  for (const seg of used.split(/[;/]/)) {
    const parts = seg.split('|').map(s => s.trim());
    if (parts.length < 2) continue;
    const cardName = norm(parts[1]);
    if (!cardName) continue;
    if (!byName.has(cardName)) byName.set(cardName, url);
  }
}

// ---- 3. 映射到项目卡牌 ----
const map = {};
const missed = [];
const addCard = (def, id) => {
  const key = norm(def.en || (def.name && def.name.en));
  const url = byName.get(key);
  if (url) map[id] = url; else missed.push(`${id} (${def.en || ''})`);
};

for (const fac of Object.keys(ctx.CARDS)) {
  for (const def of ctx.CARDS[fac]) addCard(def, def.id);
}
for (const fac of Object.keys(ctx.LEADERS)) {
  for (const l of ctx.LEADERS[fac]) addCard(l, l.id);
}

// ---- 4. 输出 ----
const body = `/* 自动生成：巫师3 昆特牌卡面（fandom CDN 直链，207 文件全量实测 200）
 * 生成器：scripts/build-art.js   来源：_probe_gwent/gwent_urls.tsv
 * 注意：图片版权归 CDK/原作者所有，仅作本地学习用。 */
'use strict';
const CARD_ART = ${JSON.stringify(map, null, 0)};
function cardArt(def) { return (def && CARD_ART[def.defId || def.id]) || null; }
`;
fs.writeFileSync(OUT, body, 'utf8');

console.log(`映射成功 ${Object.keys(map).length} 张，未匹配 ${missed.length} 张`);
if (missed.length) console.log('未匹配：\n  ' + missed.join('\n  '));
console.log('输出 →', OUT, `${(body.length/1024).toFixed(1)} KB`);
