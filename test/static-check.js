/* ============================================================
 * 静态一致性检查（替代 jsdom 的浏览器加载验证）
 *  1) 按 index.html 的加载顺序拼接全部脚本 → node --check（捕获全局重复声明/语法错）
 *  2) index.html 的 id 集合 ↔ 代码里 getElementById('x') 的集合
 *  3) 跨文件全局符号引用（函数/类/常量）是否都有定义
 * ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

let fail = 0;
const ok = (m) => console.log('✅ ' + m);
const bad = (m) => { fail++; console.log('❌ ' + m); };

console.log('加载顺序：' + scripts.join(' → ') + '\n');

// ---------- 1) 拼接后语法检查 ----------
const concat = scripts.map(s => `\n/* ==== ${s} ==== */\n` + fs.readFileSync(path.join(ROOT, s), 'utf8')).join('\n');
const tmp = path.join(os.tmpdir(), 'gwent-concat-check.js');
fs.writeFileSync(tmp, concat, 'utf8');
try {
  new vm.Script(concat, { filename: 'concat-all.js' });
  ok('全部脚本拼接后语法/全局声明无冲突（无重复 let/const/class/function）');
} catch (e) {
  bad('拼接检查失败：' + e.message);
}

// ---------- 2) DOM id 核对 ----------
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const usedIds = new Set();
for (const s of scripts) {
  const code = fs.readFileSync(path.join(ROOT, s), 'utf8');
  for (const m of code.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) usedIds.add(m[1]);
  for (const m of code.matchAll(/\bel\(['"]([^'"]+)['"]\)/g)) usedIds.add(m[1]);
}
// 动态创建的 id（在 innerHTML 里出现）也算
const dynamicIds = new Set([...concat.matchAll(/id="([^"$]+)"/g)].map(m => m[1]));
const missing = [...usedIds].filter(id => !htmlIds.has(id) && !dynamicIds.has(id));
if (missing.length) bad('代码引用了不存在且未动态创建的 id: ' + missing.join(', '));
else ok(`DOM id 全部可解析（静态 ${htmlIds.size} 个，引用 ${usedIds.size} 个）`);

// ---------- 3) 跨文件全局符号 ----------
const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date, Set, Map, RegExp, Error, isNaN, parseInt, parseFloat };
ctx.globalThis = ctx;
ctx.window = { AudioContext: undefined, webkitAudioContext: undefined, addEventListener: () => {} };
ctx.localStorage = { getItem: () => null, setItem: () => {} };
ctx.document = { addEventListener: () => {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }), body: { appendChild() {} } };
ctx.fetch = () => Promise.reject(new Error('no fetch'));
vm.createContext(ctx);
try {
  for (const s of scripts) {
    if (s.includes('ui.js') || s.includes('main.js')) continue;   // 依赖完整 DOM，跳过执行
    vm.runInContext(fs.readFileSync(path.join(ROOT, s), 'utf8'), ctx, { filename: s });
  }
  ok('非 DOM 脚本可在独立作用域执行（art/data/engine/ai/audio/deckbuilder）');
} catch (e) {
  bad('脚本执行失败：' + e.message);
}

// 收集 ui.js/main.js 引用的全局名，检查是否存在于已执行上下文
const GLOBALS_OK = new Set(['document', 'window', 'location', 'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Set', 'Map', 'WeakMap', 'Image', 'URL', 'Blob', 'FileReader', 'indexedDB', 'requestIdleCallback', 'cancelIdleCallback', 'parseInt', 'parseFloat', 'isNaN', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'navigator', 'localStorage', 'sessionStorage', 'fetch', 'AudioContext', 'webkitAudioContext', 'Audio', 'Promise', 'Error', 'RegExp', 'undefined', 'null', 'true', 'false', 'this', 'arguments', 'function', 'return', 'typeof', 'new', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'var', 'let', 'const', 'class', 'extends', 'super', 'try', 'catch', 'finally', 'throw', 'delete', 'in', 'of', 'instanceof', 'void', 'do', 'yield', 'await', 'async', 'static', 'get', 'set']);
const known = new Set([...GLOBALS_OK, ...Object.keys(ctx)]);
const localDecl = new Set([...concat.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
for (const m of concat.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) localDecl.add(m[1]);

const suspicious = [];
for (const s of ['js/ui.js', 'js/main.js']) {
  const code = fs.readFileSync(path.join(ROOT, s), 'utf8');
  // 只查形如 Foo.bar( 或 new Foo( 的全局构造/命名空间引用
  for (const m of code.matchAll(/\bnew\s+([A-Z][\w$]*)\s*\(/g)) {
    const n = m[1];
    if (!known.has(n) && !localDecl.has(n) && !/^(Date|Set|Map|Promise|Error|RegExp|Array|Object|String|Number|Boolean)$/.test(n)) suspicious.push(`${s}: new ${n}()`);
  }
  for (const m of code.matchAll(/\b(GwentGame|GwentAI|FACTIONS|LEADERS|CARDS|CARD_ART|cardArt|makeCard|buildDeck|WEATHER|ROW_CN|ROWS|ABILITY_CN|cardHtml|emblemSvg|EMBLEM|DIFFICULTIES|DIFFICULTY_ORDER|DECK_RULES|ALL_CARDS|autoPicks|buildCustomDeck|validatePicks|DeckBuilder|SFX)\b/g)) {
    if (!known.has(m[1]) && !localDecl.has(m[1])) suspicious.push(`${s}: ${m[1]}`);
  }
}
const uniq = [...new Set(suspicious)];
if (uniq.length) bad('可能未定义的跨文件引用：\n    ' + uniq.join('\n    '));
else ok('ui.js / main.js 引用的跨文件全局符号均有定义');

console.log(fail ? `\n${fail} 项检查未通过` : '\n全部静态检查通过');
process.exit(fail ? 1 : 0);
