/* ============================================================
 * 极简 PNG 解码 / 缩放（纯 Node，无第三方依赖）
 * ============================================================ */
'use strict';
const zlib = require('zlib');

/** 解码 8 位 PNG（支持 RGBA / RGB / 调色板 / 灰度），返回 {width,height,data:RGBA} */
function decodePNG(buf) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('不是 PNG 文件');
  let pos = 8, w = 0, h = 0, depth = 8, color = 6, interlace = 0;
  const idat = [];
  let palette = null, trns = null;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error('仅支持 8 位 PNG（当前 ' + depth + '）');
  if (interlace) throw new Error('不支持交错 PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error('不支持的颜色类型 ' + color);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = cur[i];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 255;
      }
      cur[i] = v;
    }
    cur.copy(px, y * stride);
    prev = cur;
  }

  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (color === 6) px.copy(rgba, o, i * 4, i * 4 + 4);
    else if (color === 2) { rgba[o] = px[i * 3]; rgba[o + 1] = px[i * 3 + 1]; rgba[o + 2] = px[i * 3 + 2]; rgba[o + 3] = 255; }
    else if (color === 4) { const v = px[i * 2]; rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = px[i * 2 + 1]; }
    else if (color === 0) { const v = px[i]; rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = 255; }
    else if (color === 3) {
      const p = px[i] * 3;
      rgba[o] = palette[p]; rgba[o + 1] = palette[p + 1]; rgba[o + 2] = palette[p + 2];
      rgba[o + 3] = (trns && px[i] < trns.length) ? trns[px[i]] : 255;
    }
  }
  return { width: w, height: h, data: rgba };
}

/** 面积平均缩放（缩小画质好；放大为双线性近似） */
function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const xr = sw / dw, yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const x0 = x * xr, x1 = (x + 1) * xr, y0 = y * yr, y1 = (y + 1) * yr;
      const ix0 = Math.max(0, Math.floor(x0)), ix1 = Math.min(sw, Math.max(ix0 + 1, Math.ceil(x1)));
      const iy0 = Math.max(0, Math.floor(y0)), iy1 = Math.min(sh, Math.max(iy0 + 1, Math.ceil(y1)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        for (let sx = ix0; sx < ix1; sx++) {
          const o = (sy * sw + sx) * 4;
          r += src[o]; g += src[o + 1]; b += src[o + 2]; a += src[o + 3]; n++;
        }
      }
      const o = (y * dw + x) * 4;
      if (n) { out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n); }
    }
  }
  return out;
}

/** 把画布合成到目标尺寸的正方形上（居中，可指定占比与背景色） */
function composite(art, aw, ah, size, fillRatio, bg) {
  const out = Buffer.alloc(size * size * 4);
  if (bg) {
    const [br, bg2, bb] = bg;
    for (let i = 0; i < size * size; i++) { out[i * 4] = br; out[i * 4 + 1] = bg2; out[i * 4 + 2] = bb; out[i * 4 + 3] = 255; }
  }
  const dw = Math.max(1, Math.round(size * fillRatio));
  const dh = Math.max(1, Math.round(size * fillRatio * (ah / aw)));
  const scaled = resize(art, aw, ah, dw, dh);
  const ox = Math.round((size - dw) / 2), oy = Math.round((size - dh) / 2);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const so = (y * dw + x) * 4;
      const dx = ox + x, dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= size || dy >= size) continue;
      const dof = (dy * size + dx) * 4;
      const sa = scaled[so + 3] / 255, ia = 1 - sa;
      out[dof] = Math.round(scaled[so] * sa + out[dof] * ia);
      out[dof + 1] = Math.round(scaled[so + 1] * sa + out[dof + 1] * ia);
      out[dof + 2] = Math.round(scaled[so + 2] * sa + out[dof + 2] * ia);
      out[dof + 3] = Math.max(out[dof + 3], scaled[so + 3]);
    }
  }
  return out;
}

/** 圆形裁切（自动探测圆环半径，边缘羽化） */
function circleMask(rgba, w, h) {
  const cx = w / 2, cy = h / 2;
  const cyi = Math.floor(h / 2);
  const lum = (x) => {
    const o = (cyi * w + x) * 4;
    return 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
  };
  let left = 0, right = w - 1;
  for (let x = 0; x < w; x++) if (lum(x) < 110) { left = x; break; }
  for (let x = w - 1; x >= 0; x--) if (lum(x) < 110) { right = x; break; }
  let R = Math.max(cx - left, right - cx) + 1;
  if (!(R > w * 0.3)) R = Math.min(w, h) / 2;      // 探测失败则用整幅半径
  const feather = Math.max(1, R * 0.006);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const t = Math.min(1, Math.max(0, (R - d) / feather + 0.5));
      rgba[(y * w + x) * 4 + 3] = Math.round(rgba[(y * w + x) * 4 + 3] * t);
    }
  }
  return R;
}

module.exports = { decodePNG, resize, composite, circleMask };
