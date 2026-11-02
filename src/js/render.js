/* ============ 水印合成渲染 v3 ============
 * 统一内容块： [Logo] | 竖线 | [文字行]
 * 五种版式共用同一套内容几何与定位算法，只改变「底板形态」与「参数是否分行」，
 * 因此九宫格任意位置、任意版式下的视觉尺寸/间距完全一致。
 * 白框版式会在照片外围加一圈白色边框，并扩大输出画布 —— 尺寸由 frameGeom() 先行给出。
 * 全部尺寸以照片宽度为基准等比缩放，预览(缩小)与导出(原图)结果一致。
 *
 * v3.1 新增四款风格化版式（film / hud / edge / gallery）：
 *   前三款是「贴边绘制」，自己排布文字、不吃内容块几何，但字号/颜色/主题色照旧生效；
 *   gallery 与 frame 同属「扩画布」家族，走 frameGeom 的 framed 分支。
 * ============================================ */

const Render = (() => {

  /* ---------- 字体族 ---------- */
  const FAM = {
    alibaba: '"PuHuiTi","Alibaba PuHuiTi 3.0","AlibabaPuHuiTi-3","阿里巴巴普惠体 3.0","Microsoft YaHei UI","PingFang SC",sans-serif',
    system: '"Segoe UI","Microsoft YaHei UI","PingFang SC","Helvetica Neue",Arial,sans-serif',
    serif: '"Source Han Serif SC","Noto Serif SC","Songti SC","SimSun",serif',
    mono: '"Cascadia Mono","JetBrains Mono",Consolas,"Courier New",monospace'
  };
  const FAM_MONO = FAM.mono;
  let UI = FAM.alibaba;
  let LOCAL_ALIAS = Object.create(null);   // 中文族名 → 英文别名，canvas 需要两手准备

  function setLocalFonts(map) { LOCAL_ALIAS = map || Object.create(null); }

  /** 解析字体选择：内置键位 / local:本机字体名 */
  function resolveFamily(v) {
    if (!v) return FAM.alibaba;
    if (FAM[v]) return FAM[v];
    if (typeof v === 'string' && v.indexOf('local:') === 0) {
      const name = v.slice(6).replace(/"/g, '').trim();
      if (name) {
        // 中文族名 + 英文别名一起给，避免 DirectWrite 只认其中一种
        const alts = (LOCAL_ALIAS[name] || []).slice(0, 3).map(a => `"${a}"`);
        const stack = [`"${name}"`, ...alts].join(',');
        return `${stack}, "PuHuiTi", "Microsoft YaHei UI", sans-serif`;
      }
    }
    return FAM.alibaba;
  }
  /** 当前是否本机字体（无需等待 web 字体加载） */
  const isLocal = v => typeof v === 'string' && v.indexOf('local:') === 0;
  const localName = v => (isLocal(v) ? v.slice(6) : '');

  function font(size, mono, weight) {
    const s = Math.max(1, Math.round(size * 100) / 100);
    return `${weight || 400} ${s}px ${mono ? FAM_MONO : UI}`;
  }

  /* ---------- 九宫格定位 ---------- */
  // [纵向 t/m/b, 横向 l/c/r]
  const POS = {
    'top-left': ['t', 'l'], 'top-center': ['t', 'c'], 'top-right': ['t', 'r'],
    'middle-left': ['m', 'l'], 'center': ['m', 'c'], 'middle-right': ['m', 'r'],
    'bottom-left': ['b', 'l'], 'bottom-center': ['b', 'c'], 'bottom-right': ['b', 'r']
  };
  const parts = p => POS[p] || POS['bottom-left'];

  /** 依据位置把 (w×h) 的盒子放进照片区域，返回左上角绝对坐标 */
  function anchor(M, w, h) {
    const [v, z] = parts(M.cfg.position);
    const x = z === 'l' ? M.pad : z === 'r' ? M.W - M.pad - w : (M.W - w) / 2;
    const y = v === 't' ? M.pad : v === 'm' ? (M.H - h) / 2 : M.H - M.pad - h;
    // 对齐到整数像素：九个位置的抗锯齿/墨迹边界完全一致
    return { x: Math.round(x + M.dx) + (M.ox || 0), y: Math.round(y + M.dy) + (M.oy || 0) };
  }

  /* ---------- 白色边框版式几何 ----------
   * 照片外圈加白边，底部留出更高的白色区域放水印（题注式）。
   * 输出画布比照片大，所以要「先问尺寸、再定 canvas」—— 预览与导出都走这里。 */
  const FRAME_SIDE = 0.03;      // 白边宽度默认值（相对照片宽度）
  const FRAME_BOTTOM = 2.6;     // 底部留白 = 白边宽 × 该倍数

  const GALLERY_SIDE = 0.062;   // 美术馆卡纸：左右/上 边宽（相对照片宽度）
  const GALLERY_BOTTOM = 2.35;  // 底部卡纸 = 侧宽 × 该倍数

  /** 扩画布类版式（白框 / 美术馆）的卡纸底色 */
  function matColor(cfg, layout) {
    if (layout === 'gallery') return cfg.galleryColor || '#F5F1E9';
    return cfg.frameColor || '#FFFFFF';
  }

  function frameGeom(cfg, W, H) {
    const c = cfg || {};
    const layout = c.layout || 'card';

    // 美术馆装裱：全套卡纸，底部留给展签
    if (layout === 'gallery') {
      const pct = Math.max(0.02, Math.min(0.16, c.galleryPad == null ? GALLERY_SIDE : c.galleryPad));
      const side = Math.max(2, Math.round(W * pct));
      const bottom = Math.max(side + 2, Math.round(side * GALLERY_BOTTOM));
      return {
        framed: true, gallery: true, bg: matColor(c, 'gallery'),
        side, bottom, outW: W + side * 2, outH: H + side + bottom, w: W, h: H
      };
    }

    if (layout !== 'frame') {
      return { framed: false, side: 0, bottom: 0, outW: W, outH: H, w: W, h: H };
    }
    const side = Math.max(1, Math.round(W * (c.framePct == null ? FRAME_SIDE : c.framePct)));
    const bottom = Math.max(side + 2, Math.round(side * (c.frameBottomMul == null ? FRAME_BOTTOM : c.frameBottomMul)));
    return {
      framed: true, bg: matColor(c, 'frame'),
      side, bottom, outW: W + side * 2, outH: H + side + bottom, w: W, h: H
    };
  }

  /** 相对亮度（0 暗 → 1 亮），用于白框上的墨色判断 */
  function lumOf(hex) {
    try {
      const h = String(hex || '').replace('#', '');
      const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
      if (!(n >= 0)) return 0.5;
      const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
    } catch (_) { return 0.5; }
  }

  /** 白框版式：白底上的白字/白标识会直接消失，自动换成深色墨；投影在白底上是脏的 */
  function inkOnFrame(cfg, bgOverride) {
    const bg = bgOverride || matColor(cfg, (cfg.layout || 'card'));
    if (lumOf(bg) < 0.5) return cfg;                 // 深色边框按用户配色原样来
    const out = Object.assign({}, cfg);
    if (lumOf(cfg.textColor || '#FFFFFF') > 0.4) out.textColor = '#16181D';
    if (lumOf(cfg.subColor || '#DCE6F3') > 0.26) out.subColor = '#5A6068';
    if (!cfg.logoVariant || cfg.logoVariant === 'white') out.logoVariant = 'dark';
    else if (cfg.logoVariant === 'accent' && lumOf(cfg.accent || '#35E0F0') > 0.62) out.logoVariant = 'dark';
    else if (cfg.logoVariant === 'auto') out.logoVariant = 'dark';
    out.textShadow = false;
    out.logoShadow = 0;          // 白底上的投影只会糊成一团灰，且会让标识越出照片左沿
    out.logoEdge = 0;
    // 渐变竖线在白底上「下半截消失」，看着像断线 —— 白框上一律走纯色
    if ((cfg.sepStyle || 'gradient') === 'gradient') out.sepStyle = 'solid';
    return out;
  }

  /* ---------- 主入口 ---------- */
  /**
   * @param opts.photo 照片在画布中的矩形 {x,y,w,h}；白框版式下即内缩后的那块。
   *                   不传则视为满幅（其余四种版式）。
   */
  function draw(ctx, W, H, cfg, info, assets, opts) {
    const opt = opts || {};
    const photo = opt.photo || { x: 0, y: 0, w: W, h: H };
    const layout = cfg.layout || 'card';
    const framed = layout === 'frame' || layout === 'gallery';
    const E = framed ? inkOnFrame(cfg, matColor(cfg, layout)) : cfg;

    UI = resolveFamily(E.fontFamily);
    if (Brands.setFont) Brands.setFont(UI);

    const S = photo.w / 1000;
    // 默认水印尺寸基准（0.5 = 相较早期版本整体缩小一半，仍可按字号倍率放大回来）
    const BASE = 0.5;
    const accent = E.accent || '#35E0F0';
    const brand = assets.brand || { name: 'CAMERA', color: '#9AA6B8', mono: '◎' };
    const scale = E.scaleComposition == null ? 1 : E.scaleComposition;

    const M = {
      W: photo.w, H: photo.h, ox: photo.x, oy: photo.y, outH: H,
      S, accent, brand, cfg: E, info, assets, k: 1,
      pad: framed ? 0 : photo.w * (E.padPct == null ? 0.035 : E.padPct),
      dx: (E.offsetX || 0) / 100 * photo.w,
      dy: (E.offsetY || 0) / 100 * photo.h,
      paramText: info.paramText || '',
      modelText: E.showModel ? info.modelShort || '' : '',
      copyright: E.showCopyright ? (E.copyright || '') : ''
    };
    M.fs = v => Math.max(1, v * S * BASE * (E.fontScale || 1) * M.k);
    M.logoH = M.fs(34) * (E.logoSize || 1) * scale;

    let C = buildContent(ctx, M);
    if (!C.lines.length && !C.logoW) return;

    // 白框版式：内容必须装进底部白区，装不下就整体缩一档（Logo 与字号同步）
    if (framed) {
      const stripH = Math.max(1, H - (photo.y + photo.h));
      const need = stripH * 0.74;
      if (C.h > need) {
        M.k = Math.max(0.3, need / C.h);
        M.logoH *= M.k;
        C = buildContent(ctx, M);
      }
    }

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    if (layout === 'banner') drawBanner(ctx, M, C);
    else if (layout === 'side') drawSide(ctx, M, C);
    else if (layout === 'minimal') drawMinimal(ctx, M, C);
    else if (layout === 'frame') drawFrame(ctx, M, C);
    else if (layout === 'film') drawFilm(ctx, M, C);
    else if (layout === 'hud') drawHud(ctx, M, C);
    else if (layout === 'edge') drawFilmEdge(ctx, M, C);
    else if (layout === 'gallery') drawGallery(ctx, M, C);
    else drawCard(ctx, M, C);
    ctx.restore();
  }


  // ---------- 文本测量 ----------
  function measure(ctx, text, f) {
    ctx.save(); ctx.font = f;
    const w = ctx.measureText(text).width;
    ctx.restore();
    return w;
  }

  function lineW(ctx, l) {
    const base = measure(ctx, l.t, font(l.size, l.mono, l.weight));
    return base + (l.track ? l.size * l.track * Math.max(0, l.t.length - 1) : 0);
  }

  function textWithSpacing(ctx, text, x, y, spacing) {
    // 字距为 0 时不要碰 letterSpacing：Chrome 会因此切换文本整形路径，
    // 有阴影时阴影仍按默认字距绘制，白字上就出现错位重影。
    if (!spacing || !('letterSpacing' in ctx)) { ctx.fillText(text, x, y); return; }
    const old = ctx.letterSpacing;
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = old || '0px';
  }

  /** 在限定宽度内自适应字号，返回 { text, size } */
  function fitText(ctx, text, size, mono, weight, maxW, minScale) {
    let s2 = size;
    const w = measure(ctx, text, font(s2, mono, weight));
    if (maxW > 0 && w > maxW) s2 = Math.max(size * (minScale || 0.6), size * (maxW / w));
    return { size: s2, width: measure(ctx, text, font(s2, mono, weight)) };
  }

  // ---------- 内容行 ----------
  function splitParams(M) {
    const raw = M.paramText;
    if (!raw) return [];
    if (M.cfg.layout !== 'side' && !M.cfg.paramLines) return [raw];
    const sep = M.cfg.sep == null ? ' · ' : M.cfg.sep;
    const ps = raw.split(sep).map(s => s.trim()).filter(Boolean);
    return ps.length > 1 ? ps : [raw];
  }

  function makeLines(ctx, M) {
    const { cfg, fs } = M;
    const mainSize = fs(22) * (cfg.mainSize || 1);
    const subSize = fs(15) * (cfg.subSize || 1);
    const mainWeight = cfg.mainWeight || 600;
    const subWeight = cfg.subWeight || 400;
    const track = cfg.textTrack || 0;
    const mainColor = cfg.textColor || '#FFFFFF';
    const subColor = Brands.hexA(cfg.subColor || '#DCE6F3', cfg.subOpacity == null ? 0.78 : cfg.subOpacity);

    const out = [];
    const block = (cfg.textBlock || '').trim();
    if (block) {
      block.split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 4).forEach((t, i) => {
        const main = i === 0;
        out.push({
          t,
          size: main ? mainSize : subSize,
          color: main ? mainColor : subColor,
          weight: main ? mainWeight : subWeight,
          mono: main && !!cfg.numMono,
          track: main ? track : track * 0.6
        });
      });
      return out;
    }

    const mainLine = {
      size: mainSize, color: mainColor, weight: mainWeight,
      mono: !!cfg.numMono, track
    };
    for (const t of splitParams(M)) out.push(Object.assign({ t }, mainLine));

    const sub = [M.modelText, M.copyright].filter(Boolean).join('   ');
    if (sub) out.push({ t: sub, size: subSize, color: subColor, weight: subWeight, mono: false, track: track * 0.6 });
    return out;
  }

  /** 计算内容块几何：宽高、Logo 宽、竖线位置 */
  function buildContent(ctx, M) {
    const { cfg, fs } = M;
    const lines = makeLines(ctx, M);
    const showLogo = cfg.showLogo !== false && M.logoH > 0;
    const logoMaxW = Math.min(M.W * 0.32, M.logoH * 6.6);
    let logoW = showLogo
      ? Math.min(Brands.widthOf(ctx, M.logoH, M.brand, cfg, M.assets.logo, logoMaxW), logoMaxW)
      : 0;

    const sepOn = showLogo && cfg.sepShow !== false && lines.length > 0;
    const sepGap = fs(16) * (cfg.sepGap == null ? 1 : cfg.sepGap);
    const sepW = sepOn ? Math.max(1, fs(2) * (cfg.sepWidth || 1)) : 0;
    const sepBlock = sepOn ? sepW + sepGap * 2 : 0;

    // 超宽 → 等比缩字（Logo 不动）
    const maxW = M.W - M.pad * 2;
    let textW = lines.length ? Math.max(...lines.map(l => lineW(ctx, l))) : 0;
    if (textW > 0 && logoW + sepBlock + textW > maxW) {
      const k = Math.max(0.42, (maxW - logoW - sepBlock) / textW);
      lines.forEach(l => { l.size = Math.max(fs(8), l.size * k); });
      textW = Math.max(...lines.map(l => lineW(ctx, l)));
    }

    const linesH = lines.reduce((a, l) => a + l.size * 1.34, 0);
    const h = Math.max(linesH, showLogo ? M.logoH : 0);
    return { lines, logoW, sepW, sepGap, sepOn, textW, linesH, w: logoW + sepBlock + textW, h };
  }

  // ---------- 竖线 ----------
  function sepColor(M) {
    const cfg = M.cfg;
    const mode = cfg.sepColorMode || 'accent';
    if (mode === 'custom') return cfg.sepColor || '#35E0F0';
    if (mode === 'brand') return M.brand.color || M.accent;
    if (mode === 'text') return cfg.textColor || '#FFFFFF';
    return M.accent;
  }

  function drawSep(ctx, x, y, h, M) {
    const cfg = M.cfg;
    const c = sepColor(M);
    const op = cfg.sepOpacity == null ? 0.85 : cfg.sepOpacity;
    const w = Math.max(1, M.fs(2) * (cfg.sepWidth || 1));
    const style = cfg.sepStyle || 'gradient';
    ctx.save();
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    if (style === 'dash') {
      ctx.setLineDash([Math.max(2, h * 0.10), Math.max(2, h * 0.09)]);
      ctx.strokeStyle = Brands.hexA(c, op);
    } else if (style === 'solid') {
      ctx.strokeStyle = Brands.hexA(c, op);
    } else {
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, Brands.hexA(c, op));
      g.addColorStop(0.55, Brands.hexA(c, op * 0.78));
      g.addColorStop(1, Brands.hexA(c, op * 0.1));
      ctx.strokeStyle = g;
    }
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- 背景底板 ----------
  const rr = (ctx, x, y, w, h, r) => Brands.roundRect(ctx, x, y, w, h, r);

  /** 底板：只填色，不描边也不画顶部高光（悬浮卡片与竖排面板共用） */
  function bgFill(ctx, x, y, w, h, r, cfg, M) {
    const op = cfg.opacity == null ? 0.55 : cfg.opacity;
    const style = cfg.bgStyle || 'glass';
    if (style === 'none') return;
    ctx.save();
    rr(ctx, x, y, w, h, r);
    if (style === 'solid') {
      ctx.fillStyle = `rgba(6,8,12,${op})`;
    } else {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, `rgba(10,14,20,${Math.min(0.95, op + 0.12)})`);
      g.addColorStop(1, `rgba(6,8,12,${Math.max(0, op - 0.12)})`);
      ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.restore();
  }

  /** 采样局部背景亮度（0 暗 → 1 亮），用于 Logo 自动配色 */
  function sampleLum(ctx, x, y, w, h) {
    try {
      const sw = Math.max(1, Math.min(180, Math.round(w)));
      const sh = Math.max(1, Math.min(70, Math.round(h)));
      const sx = Math.max(0, Math.round(x + (w - sw) / 2));
      const sy = Math.max(0, Math.round(y + (h - sh) / 2));
      const d = ctx.getImageData(sx, sy, sw, sh).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) {
        sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        n++;
      }
      return n ? sum / n : null;
    } catch (_) { return null; }
  }

  /** 叠加底板后的真实底色亮度：底板越不透明，底色越接近深色板体 */
  function effLum(M, lum, strength) {
    if (lum == null) return 0.14;
    const s = strength == null ? (M.cfg.opacity == null ? 0.55 : M.cfg.opacity) : strength;
    if (M.cfg.bgStyle === 'none') return lum;
    return lum * (1 - s) + 0.02 * s;
  }

  // ---------- 内容绘制（横向骨架）----------
  function drawContent(ctx, x, y, C, M, lum) {
    const { cfg } = M;
    let cx = x;

    if (C.logoW) {
      Brands.draw(ctx, cx, y + (C.h - M.logoH) / 2, M.logoH, M.brand, cfg, M.assets.logo, C.logoW, lum);
      cx += C.logoW;
      if (C.sepOn) {
        cx += C.sepGap;
        const sh = C.h * (cfg.sepHeight == null ? 0.82 : cfg.sepHeight);
        drawSep(ctx, cx, y + (C.h - sh) / 2, sh, M);
        cx += C.sepW + C.sepGap;
      }
    }

    let cy = y + (C.h - C.linesH) / 2;
    for (const l of C.lines) {
      ctx.save();
      ctx.font = font(l.size, l.mono, l.weight);
      ctx.fillStyle = l.color;
      ctx.textBaseline = 'top';
      if (cfg.textShadow !== false) {
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = l.size * 0.5;
        ctx.shadowOffsetY = l.size * 0.08;
      }
      textWithSpacing(ctx, l.t, cx, cy + (l.size * 1.34 - l.size) / 2, l.size * (l.track || 0));
      ctx.restore();
      cy += l.size * 1.34;
    }
  }

  // ---------- 版式 A：悬浮卡片（无边框、无角标，只有一层半透明底板）----------
  function drawCard(ctx, M, C) {
    const { cfg, fs } = M;
    const inner = fs(20);
    const boxW = C.w + inner * 2;
    const boxH = C.h + inner * 2;
    const p = anchor(M, boxW, boxH);
    const lum = effLum(M, sampleLum(ctx, p.x, p.y, boxW, boxH));
    const radius = Math.min(fs(cfg.radius == null ? 16 : cfg.radius) * 0.55 + fs(5), boxH / 2);
    bgFill(ctx, p.x, p.y, boxW, boxH, radius, cfg, M);
    drawContent(ctx, p.x + inner, p.y + inner, C, M, lum);
  }

  // ---------- 版式 B：通栏渐变带 ----------
  function drawBanner(ctx, M, C) {
    const { cfg, fs } = M;
    const [v, z] = parts(cfg.position);
    const ox = M.ox || 0, oy = M.oy || 0;
    const bandH = C.h + fs(46);
    const bandY = oy + (v === 't' ? 0 : v === 'm' ? (M.H - bandH) / 2 : M.H - bandH);
    const op = cfg.opacity == null ? 0.55 : cfg.opacity;

    if (cfg.bgStyle !== 'none') {
      const g = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
      if (v === 't') {
        g.addColorStop(0, `rgba(4,6,10,${Math.min(0.95, op + 0.3)})`);
        g.addColorStop(0.5, `rgba(4,6,10,${op * 0.85})`);
        g.addColorStop(1, 'rgba(4,6,10,0)');
      } else if (v === 'm') {
        g.addColorStop(0, 'rgba(4,6,10,0)');
        g.addColorStop(0.3, `rgba(4,6,10,${op * 0.92})`);
        g.addColorStop(0.7, `rgba(4,6,10,${op * 0.92})`);
        g.addColorStop(1, 'rgba(4,6,10,0)');
      } else {
        g.addColorStop(0, 'rgba(4,6,10,0)');
        g.addColorStop(0.5, `rgba(4,6,10,${op * 0.85})`);
        g.addColorStop(1, `rgba(4,6,10,${Math.min(0.95, op + 0.3)})`);
      }
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(ox, bandY, M.W, bandH);
      ctx.restore();
    }

    const x = ox + (z === 'l' ? M.pad : z === 'r' ? M.W - M.pad - C.w : (M.W - C.w) / 2);
    drawContent(ctx, Math.round(x + M.dx), Math.round(bandY + (bandH - C.h) / 2 + M.dy), C, M,
      effLum(M, sampleLum(ctx, x, bandY, C.w, bandH), 0.8));
  }

  // ---------- 版式 C：竖排面板（参数逐项分行）----------
  function drawSide(ctx, M, C) {
    const { cfg, fs } = M;
    const inner = fs(20);
    const boxW = C.w + inner * 2;
    const boxH = C.h + inner * 2;
    const p = anchor(M, boxW, boxH);
    const lum = effLum(M, sampleLum(ctx, p.x, p.y, boxW, boxH));
    const radius = Math.min(fs(cfg.radius == null ? 16 : cfg.radius) * 0.5 + fs(4), boxH / 2);
    bgFill(ctx, p.x, p.y, boxW, boxH, radius, cfg, M);
    drawContent(ctx, p.x + inner, p.y + inner, C, M, lum);
  }

  // ---------- 版式 D：无底板极简 ----------
  function drawMinimal(ctx, M, C) {
    const { cfg, fs } = M;
    const p = anchor(M, C.w, C.h);
    // 先取原始背景亮度，再压遮罩，避免遮罩把「亮背景」误判成暗背景
    const lum = effLum(M, sampleLum(ctx, p.x, p.y, C.w, C.h), 0.3);

    // 极薄柔光遮罩，保证压在亮部也能读
    if (cfg.bgStyle !== 'none') {
      const op = cfg.opacity == null ? 0.55 : cfg.opacity;
      const sh = Math.min(M.H * 0.3, C.h + fs(64));
      const sy = Math.max(0, Math.min(M.H - sh, p.y - fs(32) - (M.oy || 0))) + (M.oy || 0);
      const g = ctx.createLinearGradient(0, sy, 0, sy + sh);
      g.addColorStop(0, 'rgba(2,4,8,0)');
      g.addColorStop(0.5, `rgba(2,4,8,${0.34 * op / 0.55})`);
      g.addColorStop(1, 'rgba(2,4,8,0)');
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(M.ox || 0, sy, M.W, sh);
      ctx.restore();
    }

    drawContent(ctx, p.x, p.y, C, M, lum);
  }

  // ---------- 版式 E：白色边框 + 底部题注 ----------
  // 白边与底色由调用方先铺好（画布已含边框），这里只负责把内容块放进底部白区
  function drawFrame(ctx, M, C) {
    const stripY = (M.oy || 0) + M.H;
    const stripH = Math.max(1, M.outH - stripY);
    const z = parts(M.cfg.position)[1];
    const x = z === 'l' ? 0 : z === 'r' ? M.W - C.w : (M.W - C.w) / 2;
    const y = (stripH - C.h) / 2;
    drawContent(ctx, Math.round((M.ox || 0) + x + M.dx), Math.round(stripY + y + M.dy), C, M, 0.94);
  }

  /* ================= 风格化版式 =================
   * 下面四款自己排布文字，不套用内容块几何；
   * 取景/贴边类（film / hud / edge）是满幅绘制，gallery 是扩画布绘制。
   * ============================================= */

  /** 带内文字：统一处理字重、字距、对齐与投影 */
  function bandText(ctx, t, x, y, o) {
    if (!t) return;
    ctx.save();
    ctx.font = font(o.size, !!o.mono, o.weight || 500);
    ctx.fillStyle = o.color || '#fff';
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = 'alphabetic';
    if (o.shadow) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = o.shadow; }
    textWithSpacing(ctx, t, x, y, o.track || 0);
    ctx.restore();
  }

  // ---------- 版式 F：胶片齿孔 ----------
  // 上下各一条片基带：文字行贴画面、发丝线分层、齿孔走外沿
  function drawFilm(ctx, M, C) {
    const W = M.W, H = M.H;
    const base = '#171310';
    const ink = 'rgba(228,221,207,.84)';
    const edge = M.accent;

    const topH = Math.round(Math.max(H * 0.105, M.fs(58)));
    const botH = Math.round(Math.max(H * 0.145, M.fs(84)));

    ctx.save();
    ctx.translate(M.ox || 0, M.oy || 0);

    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, topH);
    ctx.fillRect(0, H - botH, W, botH);
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.fillRect(0, topH - 1, W, 1);
    ctx.fillRect(0, H - botH, W, 1);

    // 齿孔：贴带子外沿，宽度:间距 ≈ 1:0.86（接近真 35mm 一帧的孔距）
    const ph = Math.max(4, Math.round(Math.min(topH * 0.33, M.fs(24))));
    const pw = Math.round(ph * 1.42);
    const gap = Math.round(pw * 0.86);
    const step = pw + gap;
    const n = Math.max(1, Math.floor(W / step));
    const x0 = (W - (n * step - gap)) / 2;
    const pad = Math.round(ph * 0.42);
    ctx.fillStyle = ink;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step;
      rr(ctx, x, topH - ph - pad, pw, ph, ph * 0.2); ctx.fill();
      rr(ctx, x, H - ph - pad, pw, ph, ph * 0.2); ctx.fill();
    }

    const track = M.fs(1.5) * (1 + (M.cfg.textTrack || 0) * 0.5);   // 字距随画幅缩放，不能写死 px
    const padX = Math.max(M.fs(14), W * 0.022);

    // 上带：品牌（左）+ 机型（右），文字行在上、发丝线居中、齿孔贴外沿
    const t1y = Math.round(topH * 0.44);
    bandText(ctx, (M.brand.name || 'PHOTO').toUpperCase(), padX, t1y,
      { size: M.fs(14), color: edge, mono: true, weight: 500, track: track * 1.6 });
    bandText(ctx, M.modelText, W - padX, t1y,
      { size: M.fs(13), color: 'rgba(243,235,220,.92)', mono: true, weight: 600, align: 'right', track: track * 1.2 });
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(0, Math.round(topH * 0.50), W, 1);

    // 下带：参数（大）在上、发丝线居中、齿孔贴外沿
    const t2y = H - botH + Math.round(botH * 0.36);
    bandText(ctx, M.paramText, padX, t2y,
      { size: M.fs(30), color: '#F5EFE3', mono: true, weight: 500, track: track * 0.6 });
    bandText(ctx, M.copyright || (M.modelText ? '' : M.brand.name), W - padX, t2y - M.fs(4),
      { size: M.fs(14), color: 'rgba(238,231,218,.62)', mono: true, align: 'right', track: track });
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(0, H - botH + Math.round(botH * 0.62), W, 1);

    ctx.restore();
  }

  // ---------- 版式 G：取景器 HUD ----------
  // 四角取景框 + 中心准星 + 顶部水平仪 + 底部刻度尺，靠径向暗角托底
  function drawHud(ctx, M, C) {
    const W = M.W, H = M.H;
    const A = M.accent;
    const cfg = M.cfg;

    ctx.save();
    ctx.translate(M.ox || 0, M.oy || 0);

    // 暗角 + 底部压暗：纯线稿压在亮背景上会糊掉，必须有底衬
    if (cfg.bgStyle !== 'none') {
      const op = cfg.opacity == null ? 0.55 : cfg.opacity;
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.26, W / 2, H / 2, Math.max(W, H) * 0.74);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${(0.28 * op / 0.55).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      const bgh = Math.round(H * 0.24);
      const g2 = ctx.createLinearGradient(0, H - bgh, 0, H);
      g2.addColorStop(0, 'rgba(2,4,8,0)');
      g2.addColorStop(0.5, `rgba(2,4,8,${(0.42 * op / 0.55).toFixed(3)})`);
      g2.addColorStop(1, `rgba(2,4,8,${(0.72 * op / 0.55).toFixed(3)})`);
      ctx.fillStyle = g2;
      ctx.fillRect(0, H - bgh, W, bgh);
    }

    const p = Math.max(M.pad || 0, M.fs(18));
    const len = Math.min(W, H) * 0.062;
    const lw = Math.max(1, M.fs(2.2));

    // 四角取景框
    ctx.save();
    ctx.strokeStyle = Brands.hexA(A, 0.9);
    ctx.lineWidth = lw;
    ctx.lineCap = 'square';
    const corners = [
      [p, p, 1, 1], [W - p, p, -1, 1], [p, H - p, 1, -1], [W - p, H - p, -1, -1]
    ];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + sy * len);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + sx * len, cy);
      ctx.stroke();
    }
    ctx.restore();

    // 顶部中央：水平仪 + 品牌
    const tcx = W / 2, ty = p + Math.max(M.fs(16), 8);
    ctx.save();
    ctx.strokeStyle = Brands.hexA(A, 0.85);
    ctx.lineWidth = Math.max(1, lw * 0.8);
    ctx.beginPath(); ctx.moveTo(tcx - M.fs(26), ty); ctx.lineTo(tcx - M.fs(9), ty); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tcx + M.fs(9), ty); ctx.lineTo(tcx + M.fs(26), ty); ctx.stroke();
    ctx.fillStyle = Brands.hexA(A, 0.95);
    ctx.beginPath();
    ctx.moveTo(tcx, ty - M.fs(5));
    ctx.lineTo(tcx - M.fs(5), ty + M.fs(4));
    ctx.lineTo(tcx + M.fs(5), ty + M.fs(4));
    ctx.closePath(); ctx.fill();
    ctx.restore();

    bandText(ctx, (M.brand.name || 'PHOTO').toUpperCase(), tcx, ty + M.fs(26),
      { size: M.fs(13), color: Brands.hexA(A, 0.72), mono: true, align: 'center', track: M.fs(2.4) });

    // 中心准星
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = Math.max(1, M.fs(1.6));
    const cr = Math.min(W, H) * 0.014;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, cr, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W / 2 - cr * 2.4, H / 2); ctx.lineTo(W / 2 - cr * 1.3, H / 2);
    ctx.moveTo(W / 2 + cr * 1.3, H / 2); ctx.lineTo(W / 2 + cr * 2.4, H / 2);
    ctx.moveTo(W / 2, H / 2 - cr * 2.4); ctx.lineTo(W / 2, H / 2 - cr * 1.3);
    ctx.moveTo(W / 2, H / 2 + cr * 1.3); ctx.lineTo(W / 2, H / 2 + cr * 2.4);
    ctx.stroke();
    ctx.restore();

    // 底部：参数与刻度整体压在角线之上，水平内缩到角线内侧
    const inset = p + len * 1.25;   // 躲开四角取景线的水平段
    const by = H - p - len - Math.max(M.fs(26), 14);
    bandText(ctx, M.paramText, inset, by,
      { size: M.fs(26), color: '#fff', mono: true, weight: 500 });
    const rightTxt = M.modelText || M.copyright;
    bandText(ctx, rightTxt, W - inset, by,
      { size: M.fs(14), color: '#fff', mono: true, weight: 600, align: 'right' });

    // 参数行下的短基准线：铺满的刻度尺在杂背景上会碎成噪点，一根短线反而像信息条收边
    const x1 = inset, x2 = W - inset, rw = x2 - x1;
    const barW = Math.min(rw * 0.42, Math.max(M.fs(240), 120));
    ctx.save();
    ctx.fillStyle = Brands.hexA(A, 0.55);
    ctx.fillRect(x1, Math.round(by + Math.max(M.fs(14), 8)), Math.round(barW), Math.max(1, M.fs(1.6)));
    ctx.fillStyle = Brands.hexA(A, 0.95);
    ctx.fillRect(x1, Math.round(by + Math.max(M.fs(14), 8)) - Math.round(M.fs(2)), Math.round(M.fs(26)), Math.max(1, M.fs(3.2)));
    ctx.restore();

    ctx.restore();
  }

  // ---------- 版式 H：胶片竖边 ----------
  // 右侧窄带竖排参数，刻度走左缘，互不遮挡
  function drawFilmEdge(ctx, M, C) {
    const W = M.W, H = M.H;
    const A = M.accent;
    const bw = Math.round(Math.max(W * 0.082, M.fs(92)));
    const x0 = W - bw;

    ctx.save();
    ctx.translate(M.ox || 0, M.oy || 0);

    ctx.fillStyle = 'rgba(9,10,14,.84)';
    ctx.fillRect(x0, 0, bw, H);

    const g = ctx.createLinearGradient(x0, 0, x0 + Math.max(2, M.fs(3)), 0);
    g.addColorStop(0, Brands.hexA(A, 0.8));
    g.addColorStop(1, Brands.hexA(A, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, Math.max(2, M.fs(3)), H);

    // 顶部三角标记
    ctx.fillStyle = Brands.hexA(A, 0.95);
    const tv = Math.max(M.fs(20), 10);
    ctx.beginPath();
    ctx.moveTo(x0 + bw * 0.5, M.fs(22));
    ctx.lineTo(x0 + bw * 0.5 - tv * 0.55, M.fs(22) + tv * 0.75);
    ctx.lineTo(x0 + bw * 0.5 + tv * 0.55, M.fs(22) + tv * 0.75);
    ctx.closePath(); ctx.fill();

    // 刻度：带子左缘，约占画面上三分之一
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.20)';
    ctx.lineWidth = Math.max(1, M.fs(1));
    const tStart = Math.max(M.fs(64), 30);
    const tStep = Math.max(M.fs(13), 7);
    const tCount = Math.max(6, Math.floor((H * 0.34) / tStep));
    const shortLen = Math.max(M.fs(13), 7), longLen = Math.max(M.fs(20), 10);
    for (let i = 0; i < tCount; i++) {
      const y = tStart + i * tStep;
      ctx.beginPath();
      ctx.moveTo(x0 + Math.max(M.fs(6), 3), y);
      ctx.lineTo(x0 + (i % 5 === 0 ? longLen : shortLen), y);
      ctx.stroke();
    }
    ctx.restore();

    // 竖排：主行靠带子右侧、副行靠左侧，两行都在带内，四周留白均衡
    // 注意 rotate(-90) 后，负 y 方向对应画面的「向右」
    ctx.save();
    ctx.translate(x0 + bw * 0.58, H - Math.max(M.pad || 0, M.fs(18)));
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font(M.fs(28), true, 500);
    ctx.fillStyle = 'rgba(240,246,255,.96)';
    textWithSpacing(ctx, M.paramText, 0, -M.fs(7), Math.max(1, M.fs(2.4)));
    const sub = [M.modelText, M.copyright].filter(Boolean).join('  ·  ');
    if (sub) {
      ctx.font = font(M.fs(14), true, 400);
      ctx.fillStyle = 'rgba(240,246,255,.60)';
      textWithSpacing(ctx, sub, 0, M.fs(17), Math.max(1, M.fs(1.4)));
    }
    ctx.restore();

    ctx.restore();
  }

  // ---------- 版式 I：美术馆装裱 ----------
  // 宽卡纸 + 底部展签；卡纸底色与墨色由 inkOnFrame 处理
  function drawGallery(ctx, M, C) {
    const ox = M.ox || 0, oy = M.oy || 0;
    const stripY = oy + M.H;
    const stripH = Math.max(1, M.outH - stripY);

    const x = Math.round(ox + (M.W - C.w) / 2 + M.dx);
    const y = Math.round(stripY + (stripH - C.h) / 2 + M.dy);

    // 展签上方的细分隔线
    const lw = Math.min(C.w * 1.3, M.W * 0.30);
    const sepY = Math.max(stripY + stripH * 0.12, Math.round(y - Math.max(M.fs(11), 7)));
    ctx.save();
    ctx.fillStyle = Brands.hexA(M.cfg.textColor || '#221F1B', 0.26);
    ctx.fillRect(Math.round(ox + (M.W - lw) / 2), sepY, Math.round(lw), Math.max(1, M.fs(1.2)));
    ctx.restore();

    drawContent(ctx, x, y, C, M, 0.94);
  }

  /** 按 EXIF 方向修正绘制 */
  function drawImageOriented(ctx, img, orientation, W, H) {
    const o = orientation || 1;
    ctx.save();
    switch (o) {
      case 2: ctx.translate(W, 0); ctx.scale(-1, 1); break;
      case 3: ctx.translate(W, H); ctx.rotate(Math.PI); break;
      case 4: ctx.translate(0, H); ctx.scale(1, -1); break;
      case 5: ctx.translate(0, H); ctx.rotate(-Math.PI / 2); ctx.scale(-1, 1); break;
      case 6: ctx.translate(W, 0); ctx.rotate(Math.PI / 2); break;
      case 7: ctx.translate(W, 0); ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); break;
      case 8: ctx.translate(0, H); ctx.rotate(-Math.PI / 2); break;
      default: break;
    }
    if (o >= 5 && o <= 8) ctx.drawImage(img, 0, 0, H, W);
    else ctx.drawImage(img, 0, 0, W, H);
    ctx.restore();
  }

  return { draw, drawImageOriented, font, POS, parts, anchor, sampleLum, resolveFamily, isLocal, localName, setLocalFonts, frameGeom, inkOnFrame, lumOf, FAM };
})();

if (typeof module !== 'undefined') module.exports = Render;
