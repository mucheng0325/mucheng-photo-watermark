/* ============ 品牌识别 + Logo 绘制 ============
 * 官方标识内置于 js/logos.js（window.BRAND_LOGOS），提供白色版与品牌色版；
 * 用户仍可在「品牌」面板为任一品牌上传自己的 Logo 图片。
 * ============================================ */

const Brands = (() => {
  const LIST = [
    { key: 'canon',      name: 'Canon',      mono: 'C',  color: '#E4002B', re: /canon|eos|powershot|ixus/i },
    { key: 'nikon',      name: 'Nikon',      mono: 'N',  color: '#FFD100', re: /nikon|^z ?[5-9]|^d[1-9]\d{2,3}|coolpix/i },
    { key: 'sony',       name: 'SONY',       mono: 'S',  color: '#00A0E9', re: /sony|ilce|ilca|nex-|dsc-|sl[ta]-/i },
    { key: 'fujifilm',   name: 'FUJIFILM',   mono: 'F',  color: '#00A94F', re: /fujifilm|^x-?[a-z]\d|^x-\w|gfx/i },
    { key: 'leica',      name: 'LEICA',      mono: 'L',  color: '#E30613', re: /^leica|leica camera|^m\d{1,2}\b/i },
    { key: 'hasselblad', name: 'HASSELBLAD', mono: 'H',  color: '#C8A45C', re: /hasselblad|^x[12]d|^h[3-6]d/i },
    { key: 'panasonic',  name: 'LUMIX',      mono: 'P',  color: '#0B5CAB', re: /panasonic|lumix|^dc-|^gh\d|^s[15][rm]?/i },
    { key: 'omsystem',   name: 'OM SYSTEM',  mono: 'O',  color: '#0072BC', re: /olympus|om digital|^om-?\d|^e-m\d/i },
    { key: 'pentax',     name: 'PENTAX',     mono: 'P',  color: '#B5121B', re: /pentax|ricoh imaging/i },
    { key: 'ricoh',      name: 'RICOH',      mono: 'R',  color: '#D7000F', re: /ricoh|^gr ?(ii|iii|x)/i },
    { key: 'dji',        name: 'DJI',        mono: 'D',  color: '#00B4FF', re: /dji|mavic|osmo/i },
    { key: 'gopro',      name: 'GoPro',      mono: 'G',  color: '#00A6E0', re: /gopro|hero ?\d/i },
    { key: 'insta360',   name: 'Insta360',   mono: 'I',  color: '#00E0A4', re: /insta ?360/i },
    { key: 'kodak',      name: 'KODAK',      mono: 'K',  color: '#FFB000', re: /kodak/i },
    { key: 'xiaomi',     name: 'Xiaomi',     mono: 'MI', color: '#FF6900', re: /xiaomi|redmi|^mi\b|poco/i },
    { key: 'huawei',     name: 'HUAWEI',     mono: 'H',  color: '#CF0A2C', re: /huawei|^hm[0-9a-z]/i },
    { key: 'honor',      name: 'HONOR',      mono: 'H',  color: '#29B6F6', re: /honor|^bvl-|^any-|^elt-/i },
    { key: 'oneplus',    name: 'OnePlus',    mono: '1+', color: '#EB0028', re: /oneplus|^le2\d|^kb2|^pjd/i },
    { key: 'meizu',      name: 'MEIZU',      mono: 'M',  color: '#00BFFF', re: /meizu|^m\d{3}[a-z]?$/i },
    { key: 'vivo',       name: 'vivo',       mono: 'V',  color: '#415FFF', re: /vivo|^v\d{4}|iqoo/i },
    { key: 'oppo',       name: 'OPPO',       mono: 'O',  color: '#0AA84C', re: /oppo|find ?x|reno|^p[a-z]{2}\d/i },
    { key: 'samsung',    name: 'SAMSUNG',    mono: 'S',  color: '#1428A0', re: /samsung|^sm-/i },
    { key: 'google',     name: 'Pixel',      mono: 'G',  color: '#4285F4', re: /google|pixel/i },
    { key: 'motorola',   name: 'motorola',   mono: 'M',  color: '#5C6BC0', re: /motorola|^xt\d{3}|^moto/i },
    { key: 'nokia',      name: 'NOKIA',      mono: 'N',  color: '#124191', re: /nokia|^ta-\d/i },
    { key: 'asus',       name: 'ASUS',       mono: 'A',  color: '#F0F0F0', re: /asus|zenfone|rog ?phone/i },
    { key: 'apple',      name: 'iPhone',     mono: 'i',  color: '#F5F5F7', re: /apple|iphone/i }
  ];

  const FALLBACK = { key: 'generic', name: 'CAMERA', mono: '◎', color: '#9AA6B8', re: null };

  /** 依 Make/Model 猜测品牌 */
  function detect(make, model) {
    const src = `${make || ''} ${model || ''}`;
    if (!src.trim()) return FALLBACK;
    for (const b of LIST) if (b.re.test(src)) return b;
    // 兜底：直接用厂商名
    const m = (make || model || '').trim();
    if (m) return { key: 'custom_' + m.toLowerCase().replace(/\s+/g, '_'), name: m.toUpperCase().slice(0, 18), mono: m[0].toUpperCase(), color: '#9AA6B8', re: null };
    return FALLBACK;
  }

  /** 机型精简：去掉厂商前缀，保留型号主体 */
  function modelShort(make, model) {
    if (!model) return '';
    let s = model.trim();
    if (make) {
      const mk = make.trim();
      if (s.toLowerCase().startsWith(mk.toLowerCase())) s = s.slice(mk.length).trim();
    }
    return s.replace(/\s+/g, ' ');
  }

  // ---------- 官方标识资源 ----------
  const IMG = {};        // key -> { w: Image, c: Image }
  const TINTED = {};     // 缓存着色后的画布（按图片实例唯一 id 命名，避免同长度串号）
  const LUM = new WeakMap();   // 图片 -> 平均亮度
  let uidSeq = 0;
  const idOf = im => (im.__ecwId || (im.__ecwId = 'i' + (++uidSeq)));

  /** 文字型标识使用的字体族，由 Render 在每帧开始时注入 */
  let UI_FONT = '"PuHuiTi","Alibaba PuHuiTi 3.0","Microsoft YaHei UI","PingFang SC",sans-serif';
  function setFont(stack) { if (stack) UI_FONT = stack; }

  /** 预载全部内置标识（data URL，不污染画布，可直接导出） */
  function preload() {
    const L = (typeof window !== 'undefined' && window.BRAND_LOGOS) || {};
    const jobs = [];
    for (const k of Object.keys(L)) {
      IMG[k] = IMG[k] || {};
      for (const v of ['w', 'c']) {
        if (!L[k][v]) continue;
        jobs.push(new Promise(res => {
          const im = new Image();
          im.onload = () => { IMG[k][v] = im; res(); };
          im.onerror = () => res();
          im.src = L[k][v];
        }));
      }
    }
    return Promise.all(jobs);
  }

  const hasOfficial = key => !!(window.BRAND_LOGOS && window.BRAND_LOGOS[key] && IMG[key] && IMG[key].w);

  /** 把白色标识染成指定颜色（用于主题色 / 深色版本） */
  function tint(img, color) {
    const id = `${idOf(img)}_${color}`;
    if (TINTED[id]) return TINTED[id];
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    return (TINTED[id] = c);
  }

  /** 纯色剪影，用于描边/发光 */
  function silhouette(img, color) {
    const id = `${idOf(img)}_sil_${color}`;
    if (TINTED[id]) return TINTED[id];
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    return (TINTED[id] = c);
  }

  /** 标识自身平均亮度（0 暗 → 1 亮），用于自动描边方向 */
  function luminance(img) {
    if (LUM.has(img)) return LUM.get(img);
    let v = 0.5;
    try {
      const s = 24;
      const c = document.createElement('canvas');
      c.width = s; c.height = s;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, s, s);
      const d = x.getImageData(0, 0, s, s).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 40) continue;
        sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        n++;
      }
      if (n) v = sum / n;
    } catch (_) {}
    LUM.set(img, v);
    return v;
  }

  /** 按配色取图：white / brand / accent / dark / auto */
  function officialImage(brand, cfg, lum) {
    const set = IMG[brand.key];
    const L = window.BRAND_LOGOS && window.BRAND_LOGOS[brand.key];
    if (!set || !L) return null;
    let v = cfg.logoVariant || 'white';
    if (v === 'auto') v = (lum != null && lum > 0.56) ? 'dark' : 'white';
    if (v === 'brand') return set.c || set.w;
    if (v === 'accent') return set.w ? tint(set.w, cfg.accent || brand.color) : null;
    if (v === 'dark') return set.w ? tint(set.w, '#0A0E14') : null;
    return set.w || set.c;
  }

  /** 等比适配：给定目标高度与最大宽度，返回实际宽高 */
  function fitLogo(h, ratio, maxW) {
    let w = h * ratio, hh = h;
    if (maxW && w > maxW) { w = maxW; hh = maxW / ratio; }
    return { w, h: hh };
  }

  /**
   * 带对比度保护的位图绘制：
   * - 整数像素对齐 + 高质量重采样：半像素定位和低质量双线性会让标识整体发虚
   * - 描边只在「标识与背景亮度接近」时启用，颜色永远取背景的反方向
   *   （亮底压深 / 暗底提亮）——之前按 Logo 自身亮度选色，白/彩 Logo 落亮底上会镶一圈白边
   * - 描边厚度限制在 1–3px，投影收窄，避免糊成一团
   */
  function drawRaster(ctx, im, x, y, w, h, cfg, bgLum) {
    x = Math.round(x); y = Math.round(y);
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));

    const prevQ = ctx.imageSmoothingQuality;
    ctx.imageSmoothingQuality = 'high';

    const lg = luminance(im);
    const bg = bgLum == null ? 0.3 : bgLum;
    const edge = cfg.logoEdge == null ? 0.6 : cfg.logoEdge;
    // 原色标识（佳能红 / 尼康黄 / 徕卡红白…）靠色相就足够分离，任何描边都会变成一圈毛边 —— 直接跳过。
    // 只有单色版（白 / 主题色 / 深色）才需要按亮度补边。
    const mono = (cfg.logoVariant || 'white') !== 'brand';

    if (edge > 0 && mono && Math.abs(lg - bg) < 0.34) {
      const col = bg > 0.46 ? 'rgba(8,10,14,0.62)' : 'rgba(255,255,255,0.52)';
      const t = Math.max(1, Math.min(3, h * 0.009 * edge));
      const sil = silhouette(im, col);
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]];
      for (const [ax, ay] of dirs) {
        ctx.drawImage(sil, x + Math.round(ax * t), y + Math.round(ay * t), w, h);
      }
    }

    const sh = cfg.logoShadow == null ? 0.6 : cfg.logoShadow;
    ctx.save();
    if (sh > 0) {
      ctx.shadowColor = 'rgba(0,0,0,0.38)';
      ctx.shadowBlur = h * 0.2 * sh;     // 原 0.55 过糊，投影会吃掉标识边缘的锐度
      ctx.shadowOffsetY = h * 0.05;
    }
    ctx.drawImage(im, x, y, w, h);
    ctx.restore();

    ctx.imageSmoothingQuality = prevQ;
  }

  /** 计算标识宽度（布局阶段需要先知道占位，避免溢出） */
  function widthOf(ctx, h, brand, cfg, customImg, maxW) {
    const mode = cfg.logoMode || 'official';
    if (mode === 'custom' && customImg && customImg.width) {
      return fitLogo(h, customImg.width / customImg.height, maxW).w;
    }
    if (mode === 'official' && hasOfficial(brand.key)) {
      return fitLogo(h, window.BRAND_LOGOS[brand.key].r, maxW).w;
    }
    if (mode === 'badge') return h;
    const label = cfg.logoUpper ? brand.name.toUpperCase() : brand.name;
    const fs = h * 0.82;
    ctx.save();
    ctx.font = `700 ${fs}px ${UI_FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${fs * 0.06}px`;
    const w = ctx.measureText(label).width;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();
    return w;
  }

  // ---------- 绘制 ----------
  // mode: official(官方标识) | wordmark(字标) | badge(方牌) | plain(纯文字) | custom(用户上传)
  // 说明：在 [y, y+h] 的垂直盒内居中绘制，返回实际占用的宽度
  // lum: 背景局部亮度（0 暗 → 1 亮），供 auto 配色与描边方向使用
  function draw(ctx, x, y, h, brand, cfg, customImg, maxW, lum) {
    ctx.save();
    const mode = cfg.logoMode || 'official';

    if (mode === 'custom' && customImg && customImg.width) {
      const fit = fitLogo(h, customImg.width / customImg.height, maxW);
      drawRaster(ctx, customImg, x, y + (h - fit.h) / 2, fit.w, fit.h, cfg, lum);
      ctx.restore();
      return fit.w;
    }

    if (mode === 'official') {
      const im = officialImage(brand, cfg, lum);
      if (im) {
        const ratio = (im.naturalWidth || im.width) / (im.naturalHeight || im.height);
        const fit = fitLogo(h, ratio, maxW);
        drawRaster(ctx, im, x, y + (h - fit.h) / 2, fit.w, fit.h, cfg, lum);
        ctx.restore();
        return fit.w;
      }
      // 无对应官方资源 → 回落到字标
    }

    if (mode === 'badge') {
      const r = h * 0.28;
      const w = h;
      roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = hexA(brand.color, 0.16);
      ctx.fill();
      ctx.lineWidth = Math.max(1, h * 0.035);
      ctx.strokeStyle = hexA(brand.color, 0.55);
      ctx.stroke();
      ctx.fillStyle = brand.color;
      ctx.font = `700 ${h * 0.46}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(brand.mono, x + w / 2, y + h / 2 + h * 0.02);
      ctx.restore();
      return w;
    }

    const label = cfg.logoUpper ? brand.name.toUpperCase() : brand.name;
    const fs = h * 0.82;
    ctx.font = `700 ${fs}px ${UI_FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${fs * 0.06}px`;
    const w = ctx.measureText(label).width;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (mode === 'wordmark') {
      // 字标 + 主题色短线，科技感
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(label, x, y + h * 0.82);
      ctx.fillStyle = cfg.accent || brand.color;
      ctx.fillRect(x, y + h * 0.92, Math.max(w * 0.5, h * 0.5), Math.max(2, h * 0.06));
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(label, x, y + h * 0.82);
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();
    return w;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  return { LIST, FALLBACK, detect, modelShort, draw, widthOf, preload, hasOfficial, roundRect, hexA, setFont, luminance, tint, officialImage };
})();

if (typeof module !== 'undefined') module.exports = Brands;
