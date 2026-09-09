/* ============================================================
 * 极简 DOM 垫片 —— 仅覆盖本项目 ui.js / main.js 用到的 API
 * 目的：在没有 jsdom/浏览器的情况下，真实执行 UI 代码路径。
 * 支持：createElement / getElementById / innerHTML 解析 / querySelector(All)
 *       classList / dataset / style / textContent / addEventListener / dispatchEvent
 * ============================================================ */
'use strict';

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link']);
let CURRENT_DOC = null;   // 供 innerHTML 动态注册 id

class ClassList {
  constructor(el) { this.el = el; }
  add(...c) { c.forEach(x => x && this.el._class.add(x)); }
  remove(...c) { c.forEach(x => this.el._class.delete(x)); }
  contains(c) { return this.el._class.has(c); }
  toggle(c) { this.el._class.has(c) ? this.el._class.delete(c) : this.el._class.add(c); }
  toString() { return [...this.el._class].join(' '); }
}

class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this._class = new Set();
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this._textNodes = [];
    this._listeners = {};
    this._attrs = {};
    this._html = '';
    this._id = '';
  }
  get classList() { return new ClassList(this); }
  set className(v) { this._class = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get className() { return [...this._class].join(' '); }
  set id(v) { this._id = String(v); }
  get id() { return this._id; }
  set textContent(v) { this._textNodes = v == null ? [] : [String(v)]; this.children = []; }
  get textContent() { return this._textNodes.join('') + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'class') this.className = v; if (k === 'id') this._id = v; }
  getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; }
  set innerHTML(v) {
    this._html = String(v == null ? '' : v);
    this.children = [];
    this._textNodes = [];
    const { nodes, texts } = parseHTML(this._html);
    nodes.forEach(n => { n.parentNode = this; this.children.push(n); });
    this._textNodes = texts;
    // 模拟浏览器：动态插入的 id 也可被 getElementById 找到
    if (CURRENT_DOC && CURRENT_DOC._ids) {
      const walk = (el) => { if (el._id) CURRENT_DOC._ids.set(el._id, el); el.children.forEach(walk); };
      nodes.forEach(walk);
    }
  }
  get innerHTML() { return this._html; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { const a = this._listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  dispatchEvent(ev) { (this._listeners[ev.type] || []).forEach(fn => fn.call(this, ev)); return true; }
  _all(acc = []) { for (const c of this.children) { acc.push(c); c._all(acc); } return acc; }
  querySelectorAll(sel) { return this._all().filter(n => matchesSelector(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function parseAttrs(str) {
  const out = { class: null, id: null, dataset: {}, style: null, attrs: {} };
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(str))) {
    const name = m[1].toLowerCase();
    const val = m[3] != null ? m[3] : (m[4] != null ? m[4] : (m[5] != null ? m[5] : ''));
    if (name === 'class') out.class = val;
    else if (name === 'id') out.id = val;
    else if (name.startsWith('data-')) out.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
    else if (name === 'style') out.style = val;
    else out.attrs[name] = val;
  }
  return out;
}

/** 极简 HTML 解析：返回顶层节点与文本片段 */
function parseHTML(html) {
  const root = [];
  const stack = [];
  const texts = [];
  const re = /<!--[\s\S]*?-->|<\/\s*([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m;
  const push = (node) => { if (stack.length) { node.parentNode = stack[stack.length - 1]; stack[stack.length - 1].children.push(node); } else root.push(node); };
  const addText = (t) => {
    if (!t) return;
    if (stack.length) stack[stack.length - 1]._textNodes.push(t);
    else texts.push(t);
  };
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { // 闭合
      const tag = m[1].toUpperCase();
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName === tag) { stack.length = i; break; }
      }
    } else if (m[2]) { // 开始
      const el = new El(m[2]);
      const a = parseAttrs(m[3] || '');
      if (a.class) el.className = a.class;
      if (a.id) el._id = a.id;
      el.dataset = a.dataset;
      if (typeof a.style === 'string') {
        for (const kv of a.style.split(';')) {
          const idx = kv.indexOf(':');
          if (idx <= 0) continue;
          const k = kv.slice(0, idx).trim();
          const v = kv.slice(idx + 1).trim();
          if (!k || !v) continue;
          // CSS 属性名 → 驼峰（background-image → backgroundImage），与浏览器行为一致
          el.style[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
        }
      }
      el._attrs = a.attrs;
      push(el);
      if (!m[4] && !VOID_TAGS.has(el.tagName.toLowerCase())) stack.push(el);
    } else if (m[5] != null) {
      addText(m[5]);
    }
  }
  return { nodes: root, texts };
}

function matchesSelector(node, sel) {
  const parts = String(sel).trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (!matchesSimple(node, last)) return false;
  let cur = node.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    let found = false;
    while (cur) { if (matchesSimple(cur, parts[i])) { found = true; cur = cur.parentNode; break; } cur = cur.parentNode; }
    if (!found) return false;
  }
  return true;
}

function matchesSimple(node, s) {
  s = String(s);
  // 属性选择器：[attr] / [attr="value"] / [attr='value']
  const attrRe = /\[([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]/g;
  let am;
  while ((am = attrRe.exec(s))) {
    const name = am[1];
    const want = am[2] != null ? am[2] : (am[3] != null ? am[3] : (am[4] != null ? am[4] : undefined));
    let actual;
    if (name.startsWith('data-')) {
      actual = node.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    } else {
      actual = node._attrs[name];
      if (actual == null && name === 'id') actual = node._id;
      if (actual == null && name === 'class') actual = node.className;
    }
    if (actual == null) return false;
    if (want !== undefined && String(actual) !== want) return false;
  }
  s = s.replace(/\[[^\]]*\]/g, '').trim();
  if (!s) return true;
  const idM = s.match(/#([\w-]+)/);
  const clsM = [...s.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
  const tagM = s.match(/^([a-zA-Z][\w-]*)/);
  if (idM && node._id !== idM[1]) return false;
  if (tagM && node.tagName !== tagM[1].toUpperCase()) return false;
  for (const c of clsM) if (!node._class.has(c)) return false;
  return true;
}

/* ---------------- document / window ---------------- */
function createDocument(html) {
  const doc = new El('html');
  doc.readyState = 'complete';
  const ids = new Map();

  // 解析 index.html 的 body 结构，注册 id
  const bodyM = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyM ? bodyM[1] : html;
  const { nodes } = parseHTML(bodyHtml);
  const body = new El('body');
  nodes.forEach(n => body.appendChild(n));
  doc.appendChild(body);

  const collect = (el) => {
    if (el._id) ids.set(el._id, el);
    el.children.forEach(collect);
  };
  collect(body);

  doc.body = body;
  doc.documentElement = doc;
  doc._ids = ids;
  CURRENT_DOC = doc;
  doc.getElementById = (id) => ids.get(id) || null;
  doc.querySelectorAll = (sel) => body.querySelectorAll(sel);
  doc.querySelector = (sel) => body.querySelector(sel);
  doc.createElement = (t) => new El(t);
  doc.createEvent = () => ({ type: null, initEvent(t) { this.type = t; }, preventDefault() {}, stopPropagation() {} });
  doc.addEventListener = () => {};
  doc.dispatchEvent = () => true;
  doc._ids = ids;
  return doc;
}

function createWindow(doc) {
  const win = {
    document: doc,
    navigator: { userAgent: 'dom-shim' },
    location: { reload() { win._reloaded = true; } },
    _listeners: {},
    addEventListener(t, fn) { (win._listeners[t] = win._listeners[t] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(ev) { (win._listeners[ev.type] || []).forEach(fn => fn(ev)); return true; },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    console,
    Event: class { constructor(type) { this.type = type; } },
  };
  win.window = win;
  win.globalThis = win;
  return win;
}

module.exports = { El, parseHTML, createDocument, createWindow };
