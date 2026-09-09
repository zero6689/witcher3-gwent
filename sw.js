/* ============================================================
 * Service Worker —— 让游戏可安装、可离线
 * 策略：
 *   - 安装时预缓存应用外壳（HTML/CSS/JS/图标/盾徽）
 *   - 卡面等大文件：首次访问时按需缓存（cache-first）
 *   - 音频：不预缓存，按需缓存
 * ============================================================ */
'use strict';

const VERSION = 'gwent-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/art.js',
  './js/emblems.js',
  './js/data.js',
  './js/engine.js',
  './js/ai.js',
  './js/audio.js',
  './js/bgm.js',
  './js/deckbuilder.js',
  './js/ui.js',
  './js/main.js',
  './assets/emblems/northern.png',
  './assets/emblems/nilfgaard.png',
  './assets/emblems/scoiatael.png',
  './assets/emblems/monsters.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // 只处理本站资源

  // 页面导航：网络优先，离线回落缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // 其它资源：缓存优先，回退网络并写入缓存
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
