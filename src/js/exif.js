/* ============ EXIF CAM · EXIF 解析与格式化 ============
 * 自研轻量 EXIF 读取器，零依赖、纯前端可用。
 * 支持 JPEG(APP1/Exif)；PNG(eXIf chunk) 作尽力解析。
 * ==================================================== */

const Exif = (() => {
  // 需要的 TIFF 标签
  const T = {
    Make: 0x010f, Model: 0x0110, Software: 0x0131,
    DateTime: 0x0132, Orientation: 0x0112,
    DateTimeOriginal: 0x9003, DateTimeDigitized: 0x9004,
    FNumber: 0x829d, ExposureTime: 0x829a, ISO: 0x8827,
    FocalLength: 0x920a, FocalLength35: 0xa405,
    LensModel: 0xa434, LensSpec: 0xa432,
    ExifIFD: 0x8769, GpsIFD: 0x8825,
    PixelX: 0xa002, PixelY: 0xa003,
    Flash: 0x9209, ExposureBias: 0x9204, MeteringMode: 0x9207,
    WhiteBalance: 0xa403
  };

  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  /** 读取 TIFF 结构（Exif 主体），返回 tag->value 的原始映射 */
  function readTiff(dv, tiffStart) {
    const order = dv.getUint16(tiffStart);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const le = order === 0x4949;               // II = 小端, MM = 大端
    const tiffBase = tiffStart;
    const ifd0 = dv.getUint32(tiffStart + 4, le);
    const tags = {};

    /**
     * @param type  数据类型
     * @param count 元素个数
     * @param fieldPos 条目里 4 字节"值域"的绝对位置（≤4 字节时值直接内联在此）
     * @param offset    >4 字节时，值相对 TIFF 头的偏移
     */
    function readValue(type, count, fieldPos, offset) {
      const unit = SIZE[type] || 1;
      const size = unit * count;
      const base = size > 4 ? tiffBase + offset : fieldPos;

      if (type === 2) {                        // ASCII
        let s = '';
        for (let j = 0; j < count; j++) {
          const pos = base + j;
          if (pos >= dv.byteLength) break;
          const c = dv.getUint8(pos);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s.trim();
      }

      const out = [];
      for (let i = 0; i < count; i++) {
        const pos = base + i * unit;
        if (pos + unit > dv.byteLength) { out.push(null); continue; }
        switch (type) {
          case 1: case 7: out.push(dv.getUint8(pos)); break;
          case 3: out.push(dv.getUint16(pos, le)); break;
          case 4: case 9: out.push(dv.getUint32(pos, le)); break;
          case 5: case 10: {
            out.push(readRational(pos, false));
            break;
          }
          case 6: out.push(dv.getInt8(pos)); break;
          case 8: out.push(dv.getInt16(pos, le)); break;
          case 11: out.push(dv.getFloat32(pos, le)); break;
          case 12: {
            out.push(readRational(pos, true));
            break;
          }
          default: out.push(null);
        }
      }
      return count === 1 ? out[0] : out;
    }

    /**
     * 读取 8 字节比值。部分写入器（如 Pillow）把浮点值直接以 IEEE754 double
     * 写进 RATIONAL/SRATIONAL 槽位，故按"分子分母是否合理"做判别回退。
     */
    function readRational(pos, signed) {
      const n = signed ? dv.getInt32(pos, le) : dv.getUint32(pos, le);
      const d = signed ? dv.getInt32(pos + 4, le) : dv.getUint32(pos + 4, le);
      const sane = d !== 0 && Math.abs(d) <= 100000 && Math.abs(n) <= 1000000;
      if (sane) {
        const r = n / d;
        if (Number.isFinite(r)) return r;
      }
      const f = dv.getFloat64(pos, le);
      if (Number.isFinite(f) && Math.abs(f) > 0 && Math.abs(f) < 1e6) return f;
      return d === 0 ? null : n / d;
    }

    function readIfd(ifdOffset) {
      const p = tiffBase + ifdOffset;
      if (p + 2 > dv.byteLength) return 0;
      const n = dv.getUint16(p, le);
      for (let i = 0; i < n; i++) {
        const e = p + 2 + i * 12;
        if (e + 12 > dv.byteLength) return 0;
        const tag = dv.getUint16(e, le);
        const type = dv.getUint16(e + 2, le);
        const count = dv.getUint32(e + 4, le);
        const valOff = dv.getUint32(e + 8, le);
        if (tags[tag] === undefined) {
          try { tags[tag] = readValue(type, count, e + 8, valOff); } catch (_) { tags[tag] = null; }
        }
      }
      const nextP = p + 2 + n * 12;
      if (nextP + 4 <= dv.byteLength) {
        const next = dv.getUint32(nextP, le);
        if (next) return next;
      }
      return 0;
    }

    readIfd(ifd0);
    if (tags[T.ExifIFD]) readIfd(tags[T.ExifIFD]);   // Exif 子 IFD
    return tags;
  }

  /** 在 JPEG 段中寻找 APP1/Exif */
  function findJpegExif(buf) {
    if (!buf) return null;
    const total = buf.byteLength != null ? buf.byteLength : buf.length;
    if (!total || total < 4) return null;
    const dv = buf instanceof DataView ? buf : new DataView(buf);
    if (dv.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 <= total) {
      if (dv.getUint8(off) !== 0xff) { off++; continue; }
      const marker = dv.getUint8(off + 1);
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
      if (marker === 0xda || marker === 0xd9) break; // SOS/EOI 之后不再有元数据
      const segLen = dv.getUint16(off + 2);
      if (marker === 0xe1 && segLen > 8) {
        const s = off + 4;
        // "Exif\0\0"
        if (dv.getUint32(s) === 0x45786966 && dv.getUint16(s + 4) === 0) return { start: off, end: off + 2 + segLen, tiffStart: s + 6 };
      }
      off += 2 + segLen;
    }
    return null;
  }

  /** 取出原始 APP1 Exif 段（用于输出时回填） */
  function extractApp1(buf) {
    const info = findJpegExif(buf);
    if (!info) return null;
    return new Uint8Array(buf, info.start, info.end - info.start).slice();
  }

  /** 主入口：ArrayBuffer -> 结构化信息 */
  function read(buffer) {
    const out = {
      make: '', model: '', lens: '', software: '',
      fnum: null, exposure: null, iso: null, focal: null, focal35: null,
      date: '', orientation: 1, width: 0, height: 0, flash: null, bias: null, wb: null,
      ok: false
    };
    try {
      const hit = findJpegExif(buffer);
      if (!hit) return out;
      const dv = new DataView(buffer);
      const tags = readTiff(dv, hit.tiffStart);
      if (!tags) return out;
      const g = k => tags[k] === undefined ? null : tags[k];
      out.make = clean(g(T.Make));
      out.model = clean(g(T.Model));
      out.lens = clean(g(T.LensModel)) || lensSpec(g(T.LensSpec));
      out.software = clean(g(T.Software));
      out.fnum = ratio(g(T.FNumber));
      out.exposure = ratio(g(T.ExposureTime));
      out.iso = num(g(T.ISO));
      out.focal = ratio(g(T.FocalLength));
      out.focal35 = ratio(g(T.FocalLength35));
      out.date = clean(g(T.DateTimeOriginal)) || clean(g(T.DateTime)) || '';
      out.orientation = num(g(T.Orientation)) || 1;
      out.width = num(g(T.PixelX)) || 0;
      out.height = num(g(T.PixelY)) || 0;
      out.flash = g(T.Flash);
      out.bias = num(g(T.ExposureBias));
      out.wb = g(T.WhiteBalance);
      out.ok = !!(out.make || out.model || out.fnum || out.exposure);
      return out;
    } catch (e) {
      console.warn('[exif] 解析失败', e);
      return out;
    }
  }

  function clean(v) {
    if (v == null) return '';
    if (Array.isArray(v)) v = v[0];
    return String(v).replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  }
  function num(v) {
    if (v == null) return null;
    if (Array.isArray(v)) v = v[0];
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  /** 兼容分数型写法：RATIONAL / SRATIONAL / [分子,分母] */
  function ratio(v) {
    if (v == null) return null;
    if (Array.isArray(v)) {
      if (v.length >= 2 && Number(v[1])) {
        const r = Number(v[0]) / Number(v[1]);
        return Number.isFinite(r) ? r : null;
      }
      v = v[0];
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function lensSpec(v) {
    if (!v) return '';
    const a = (Array.isArray(v) ? v : [v]).map(x => Number(x)).filter(Number.isFinite);
    if (a.length >= 2 && a[0]) return `${round(a[0])}-${round(a[1])}mm`;
    return '';
  }
  function round(n) { return Math.round(n * 10) / 10; }

  // ---------- 格式化 ----------
  const fmt = {
    aperture(v) {
      if (!v) return '';
      const s = (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
      return `f/${s}`;
    },
    shutter(v) {
      if (!v) return '';
      if (v >= 1) return `${(Math.round(v * 10) / 10).toString().replace(/\.0$/, '')}s`;
      const denom = Math.round(1 / v);
      // 贴合常见档位，避免 1/249.6 之类
      const std = [8000, 6400, 5000, 4000, 3200, 2500, 2000, 1600, 1250, 1000, 800, 640, 500, 400, 320, 250, 200, 160, 125, 100, 80, 60, 50, 40, 30, 25, 20, 15, 13, 10, 8, 6, 5, 4, 3, 2];
      const near = std.find(x => Math.abs(x - denom) / x < 0.04);
      return `1/${near || denom}s`;
    },
    iso(v) { return v ? `ISO ${Math.round(v)}` : ''; },
    focal(v, v35, withEq) {
      if (!v) return '';
      const f = Math.round(v);
      if (withEq && v35 && Math.abs(v35 - v) >= 1) return `${f}mm (${Math.round(v35)}mm eq)`;
      return `${f}mm`;
    },
    date(v, style) {
      if (!v) return '';
      const m = String(v).match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})/);
      if (!m) return v;
      const [, y, mo, d, h, mi] = m;
      if (style === 'date') return `${y}.${mo}.${d}`;
      if (style === 'iso') return `${y}-${mo}-${d}`;
      if (style === 'slash') return `${y}/${mo}/${d}`;
      return `${y}.${mo}.${d} ${h}:${mi}`;
    }
  };

  /** 依配置拼参数串 */
  function paramLine(info, cfg) {
    const parts = [];
    const order = (cfg.paramOrder || ['aperture', 'shutter', 'iso', 'focal']);
    const on = cfg.params || {};
    for (const k of order) {
      if (!on[k]) continue;
      let s = '';
      if (k === 'aperture') s = fmt.aperture(info.fnum);
      else if (k === 'shutter') s = fmt.shutter(info.exposure);
      else if (k === 'iso') s = fmt.iso(info.iso);
      else if (k === 'focal') s = fmt.focal(info.focal, info.focal35, cfg.focalEq);
      else if (k === 'lens') s = info.lens || '';
      else if (k === 'date') s = fmt.date(info.date, cfg.dateStyle);
      if (!s) continue;
      if (cfg.paramLabels) {
        const L = { aperture: '光圈', shutter: '快门', iso: '', focal: '焦距', lens: '镜头', date: '' };
        if (L[k]) s = `${L[k]} ${s}`;
      }
      parts.push(s);
    }
    return parts.join(cfg.sep == null ? ' · ' : cfg.sep);
  }

  return { read, fmt, paramLine, extractApp1, findJpegExif };
})();

if (typeof module !== 'undefined') module.exports = Exif;
