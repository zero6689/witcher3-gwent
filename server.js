#!/usr/bin/env node
/* ============================================================
 * 昆特牌静态服务器 —— 零依赖，Node 原生 http
 * 用法：
 *   node server.js                # 默认 0.0.0.0:8080
 *   node server.js 3000           # 指定端口
 *   PORT=3000 node server.js      # 环境变量指定端口
 *   node server.js --host 127.0.0.1 8080
 * 启动后会在终端打印本机 / 局域网 / 公网可用的访问地址。
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
let host = process.env.HOST || '0.0.0.0';
let port = Number(process.env.PORT) || 8080;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--host' && argv[i + 1]) { host = argv[++i]; }
  else if (a === '--port' && argv[i + 1]) { port = Number(argv[++i]); }
  else if (/^\d+$/.test(a)) { port = Number(a); }
  else if (a === '--help' || a === '-h') {
    console.log('用法: node server.js [端口] [--host 地址]');
    process.exit(0);
  }
}

/* ---------- MIME ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/* ---------- 工具 ---------- */
function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  }, headers || {}));
  res.end(body);
}

function safeJoin(root, urlPath) {
  // 防目录穿越
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const p = path.normalize(path.join(root, decoded));
  return p.startsWith(root) ? p : null;
}

function listDir(dir, urlPath) {
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => !d.name.startsWith('.'))
    .map(d => {
      const name = d.name + (d.isDirectory() ? '/' : '');
      return `<li><a href="${path.posix.join(urlPath, name)}">${name}</a></li>`;
    }).join('');
  return `<!DOCTYPE html><meta charset="utf-8"><title>${urlPath}</title>
<body style="font-family:system-ui;background:#14110c;color:#e6dcc8;padding:24px">
<h3 style="color:#f0d48a">${urlPath}</h3><ul>${items}</ul></body>`;
}

/* ---------- 服务器 ---------- */
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  let filePath = safeJoin(ROOT, req.url === '/' ? '/index.html' : req.url);
  if (!filePath) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      const idx = path.join(filePath, 'index.html');
      if (fs.existsSync(idx)) filePath = idx;
      else return send(res, 200, listDir(filePath, req.url), { 'Content-Type': 'text/html; charset=utf-8' });
    }
    fs.readFile(filePath, (e, data) => {
      if (e) {
        // 找不到页面时回落到 index.html（单页应用友好）
        if (e.code === 'ENOENT' && !path.extname(filePath)) {
          return fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
            if (e2) return send(res, 404, '404 Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
            send(res, 200, html, { 'Content-Type': MIME['.html'] });
          });
        }
        return send(res, 404, '404 Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      const ext = path.extname(filePath).toLowerCase();
      const body = req.method === 'HEAD' ? '' : data;
      send(res, 200, body, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': data.length,
      });
    });
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n❌ 端口 ${port} 已被占用。换一个端口，例如：node server.js ${port + 1}\n`);
  } else {
    console.error('服务器错误：', e.message);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) lan.push({ name, address: ni.address });
    }
  }
  const shownPort = (host === '0.0.0.0' || host === '::') ? port : port;
  console.log('\n🎴 昆特牌 · 巫师3 网页版 —— 服务器已启动\n');
  console.log(`   本机：    http://localhost:${shownPort}/`);
  console.log(`   本机：    http://127.0.0.1:${shownPort}/`);
  if (lan.length) {
    console.log('\n   局域网（同一 WiFi / 内网的其他设备可直接打开）：');
    for (const { name, address } of lan) console.log(`     http://${address}:${shownPort}/    (${name})`);
  } else {
    console.log('\n   （未检测到局域网 IPv4 地址）');
  }
  console.log('\n   云服务器：放行安全组/防火墙的 ' + shownPort + ' 端口后，用 http://公网IP:' + shownPort + '/ 访问');
  console.log('   Windows 本机防火墙若拦截，可执行（管理员 PowerShell）：');
  console.log(`     New-NetFirewallRule -DisplayName "Gwent ${shownPort}" -Direction Inbound -Protocol TCP -LocalPort ${shownPort} -Action Allow`);
  console.log('\n   按 Ctrl+C 停止\n');
});

process.on('SIGINT', () => { console.log('\n已停止服务器。'); process.exit(0); });
