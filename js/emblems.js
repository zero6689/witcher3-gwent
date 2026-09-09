/* ============================================================
 * 阵营徽章
 *  - EMBLEM_IMG：巫师3 官方阵营盾徽（用户提供，已存入 assets/emblems/）
 *  - EMBLEM：手绘 SVG 兜底（图片加载失败时使用）
 * ============================================================ */
'use strict';

const EMBLEM_IMG = {
  northern: 'assets/emblems/northern.png',
  nilfgaard: 'assets/emblems/nilfgaard.png',
  scoiatael: 'assets/emblems/scoiatael.png',
  monsters: 'assets/emblems/monsters.png',
  neutral: 'assets/emblems/skellige.png',
};

function emblemImg(faction) { return EMBLEM_IMG[faction] || EMBLEM_IMG.neutral; }

/** 徽章 HTML：优先官方盾徽图片，onerror 时退回内联 SVG */
function emblemHtml(faction, cls) {
  const img = emblemImg(faction);
  const svg = (EMBLEM[faction] || EMBLEM.neutral).replace(/"/g, '&quot;');
  return `<img class="${cls || 'crest'}" src="${img}" alt="${faction}"
    onerror="this.outerHTML='<span class=\\'emblem-fallback\\'>${svg}</span>'">`;
}

function _rays(n, inner, outer, w) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n;
    const x1 = 50 + Math.cos(a) * inner, y1 = 50 + Math.sin(a) * inner;
    const x2 = 50 + Math.cos(a) * outer, y2 = 50 + Math.sin(a) * outer;
    const px = Math.cos(a + Math.PI / 2) * w, py = Math.sin(a + Math.PI / 2) * w;
    s += `<path d="M${(x1 - px).toFixed(1)} ${(y1 - py).toFixed(1)}L${(x2).toFixed(1)} ${(y2).toFixed(1)}L${(x1 + px).toFixed(1)} ${(y1 + py).toFixed(1)}Z"/>`;
  }
  return s;
}

const EMBLEM = {
  /* 北方领域：狮首 + 鬃毛 */
  northern: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 6l6 10 11-5-1 12 12 2-7 10 9 8-11 4 3 12-12-2-10 9-10-9-12 2 3-12-11-4 9-8-7-10 12-2-1-12 11 5z" fill="currentColor" opacity=".85"/>
    <circle cx="50" cy="52" r="21" fill="#e9d6ab"/>
    <circle cx="36" cy="35" r="7" fill="#e9d6ab"/><circle cx="64" cy="35" r="7" fill="#e9d6ab"/>
    <circle cx="36" cy="35" r="3.4" fill="#c8a15a"/><circle cx="64" cy="35" r="3.4" fill="#c8a15a"/>
    <path d="M50 54c-6 0-10 4-10 8s5 9 10 9 10-5 10-9-4-8-10-8z" fill="#f6ecd4"/>
    <circle cx="43" cy="49" r="2.6" fill="#2a1a0a"/><circle cx="57" cy="49" r="2.6" fill="#2a1a0a"/>
    <path d="M50 60l-3.2 5h6.4z" fill="#2a1a0a"/>
  </svg>`,

  /* 尼弗迦德：烈日 */
  nilfgaard: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <g fill="currentColor">${_rays(16, 20, 44, 2.6)}</g>
    <circle cx="50" cy="50" r="19" fill="currentColor"/>
    <circle cx="50" cy="50" r="13" fill="#1a1408" opacity=".55"/>
    <circle cx="50" cy="50" r="6" fill="currentColor"/>
  </svg>`,

  /* 松鼠党：橡叶与箭 */
  scoiatael: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 10c17 15 25 31 25 47 0 13-10 25-25 33-15-8-25-20-25-33 0-16 8-32 25-47z" fill="currentColor" opacity=".9"/>
    <path d="M50 18v66" stroke="#12200f" stroke-width="2.6" opacity=".7"/>
    <path d="M50 30l-11 7M50 42l-12 7M50 54l-11 7M50 30l11 7M50 42l12 7M50 54l11 7" stroke="#12200f" stroke-width="1.6" opacity=".5" fill="none"/>
    <path d="M18 84L82 20" stroke="currentColor" stroke-width="3.2" fill="none"/>
    <path d="M82 20l-13 2 11 11z" fill="currentColor"/>
  </svg>`,

  /* 怪物：狼首 */
  monsters: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 12l-9 8-12-9 3 13-10 5 7 9-5 11 9 3 3 13 14 13 14-13 3-13 9-3-5-11 7-9-10-5 3-13-12 9z" fill="currentColor" opacity=".9"/>
    <path d="M38 48l9 4-9 4z" fill="#ffd24a"/><path d="M62 48l-9 4 9 4z" fill="#ffd24a"/>
    <path d="M50 60l-6 10h12z" fill="#e9d6ab"/>
    <path d="M46 70l1.6 7 2.4-7zM54 70l-1.6 7-2.4-7z" fill="#fff"/>
  </svg>`,

  /* 中立：星形罗盘 */
  neutral: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 6l10 30 30 14-30 14-10 30-10-30-30-14 30-14z" fill="currentColor" opacity=".9"/>
    <circle cx="50" cy="50" r="8" fill="#1a1408" opacity=".6"/>
  </svg>`,
};

function emblemSvg(faction) { return EMBLEM[faction] || EMBLEM.neutral; }

/* ============================================================
 *  月桂花环徽章（比分用）
 *  两条贝塞尔弧线上的叶片，右侧生成后镜像到左侧
 * ============================================================ */
function _laurelBranch(mirror) {
  const P0 = [54, 86], P1 = [95, 50], P2 = [60, 14];
  let out = '';
  const N = 11;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), mt = 1 - t;
    const x = mt * mt * P0[0] + 2 * mt * t * P1[0] + t * t * P2[0];
    const y = mt * mt * P0[1] + 2 * mt * t * P1[1] + t * t * P2[1];
    const dx = 2 * mt * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]);
    const dy = 2 * mt * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
    const deg = Math.atan2(dy, dx) * 180 / Math.PI;
    const side = i % 2 === 0 ? 1 : -1;                    // 叶片左右交替
    const ox = Math.cos((deg + 90 * side) * Math.PI / 180) * 3.2;
    const oy = Math.sin((deg + 90 * side) * Math.PI / 180) * 3.2;
    const rx = 5.4 - i * 0.12, ry = 2.5 - i * 0.05;
    out += `<ellipse cx="0" cy="0" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" transform="translate(${(x + ox).toFixed(1)},${(y + oy).toFixed(1)}) rotate(${deg.toFixed(0)})"/>`;
  }
  return mirror
    ? `<g transform="translate(100,0) scale(-1,1)">${out}</g>`
    : `<g>${out}</g>`;
}

function laurelSvg() {
  return `<svg viewBox="0 0 100 100" class="laurel-svg" aria-hidden="true">
    <g fill="currentColor">${_laurelBranch(false)}${_laurelBranch(true)}</g>
    <path d="M54 86 Q95 50 60 14" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".65"/>
    <path d="M46 86 Q5 50 40 14" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".65"/>
  </svg>`;
}

/** 月桂花环比分徽章 */
function laurelHtml(value, cls) {
  return `<div class="laurel ${cls || ''}">${laurelSvg()}<b class="laurel-num">${value}</b></div>`;
}
