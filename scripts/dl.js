/* ============================================================
 * 通用下载器（Node，跟随重定向，带进度）
 * 用法：node scripts/dl.js <url> <输出文件>
 * 为什么不用 curl：本机沙箱下 curl/schannel 报 SEC_E_NO_CREDENTIALS，
 * 而 Node 自带 OpenSSL，TLS 正常。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const [, , url, out] = process.argv;
if (!url || !out) {
  console.error('用法: node scripts/dl.js <url> <输出文件>');
  process.exit(2);
}

function fetchTo(url, out, redirects = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' },
      timeout: 120000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects > 6) return reject(new Error('重定向过多'));
        return resolve(fetchTo(new URL(res.headers.location, url).toString(), out, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      }
      const total = Number(res.headers['content-length'] || 0);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const ws = fs.createWriteStream(out);
      let got = 0, lastPct = -1;
      res.on('data', (c) => {
        got += c.length;
        if (total) {
          const pct = Math.floor((got / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) { process.stdout.write(`  进度 ${pct}%\n`); lastPct = pct; }
        }
      });
      res.pipe(ws);
      ws.on('finish', () => {
        ws.close(() => resolve({ bytes: got, total }));
      });
      ws.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('下载超时')); });
    req.end();
  });
}

fetchTo(url, out)
  .then(({ bytes }) => {
    console.log(`下载完成：${out}  ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  })
  .catch((e) => {
    console.error('下载失败：' + e.message);
    process.exit(1);
  });
