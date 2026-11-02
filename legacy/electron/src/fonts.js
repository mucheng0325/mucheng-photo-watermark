/* ============ 本机字体枚举 ============
 * 不依赖 reg.exe / fontconfig，直接解析 TTF / OTF / TTC 的 name 表，
 * 取出真实的字体家族名（nameID 1 / 16），供渲染层下拉直接引用本地文字库。
 * 同时收集中文名与英文名，用户在搜索框里输「雅黑」或「yahei」都能命中。
 * ==================================== */

const fs = require('fs');
const path = require('path');

/** 精确读一段，越界时返回实际读到的部分 */
function readAt(fd, len, pos) {
  if (len <= 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    let n = 0;
    try { n = fs.readSync(fd, buf, off, len - off, pos + off); } catch (_) { break; }
    if (n <= 0) break;
    off += n;
  }
  return off === len ? buf : buf.subarray(0, off);
}

/** 返回文件内各字体的 sfnt 起始偏移（TTC 会返回多个） */
function fontOffsets(fd) {
  const head = readAt(fd, 12, 0);
  if (head.length < 12) return [];
  const tag = head.toString('latin1', 0, 4);
  if (tag === 'ttcf') {
    const num = head.readUInt32BE(8);
    if (!num || num > 512) return [0];
    const arr = readAt(fd, num * 4, 12);
    const out = [];
    for (let i = 0; i * 4 + 4 <= arr.length; i++) out.push(arr.readUInt32BE(i * 4));
    return out.length ? out : [0];
  }
  if (tag === 'wOFF' || tag === 'wOF2') return [];   // web 字体无需枚举
  return [0];
}

/** 在 sfnt 头里找 name 表的绝对偏移 */
function nameTableOffset(fd, base) {
  const hdr = readAt(fd, 12, base);
  if (hdr.length < 12) return 0;
  const numTables = hdr.readUInt16BE(4);
  if (!numTables || numTables > 4096) return 0;
  const recs = readAt(fd, numTables * 16, base + 12);
  for (let i = 0; i + 16 <= recs.length; i += 16) {
    if (recs.toString('latin1', i, i + 4) === 'name') return recs.readUInt32BE(i + 8);
  }
  return 0;
}

function decodeName(buf) {
  if (!buf.length) return '';
  // Windows / Unicode 平台是 UTF-16BE
  const even = buf.subarray(0, buf.length - (buf.length % 2));
  const tmp = Buffer.from(even);
  try { tmp.swap16(); } catch (_) { return ''; }
  return tmp.toString('utf16le');
}

/**
 * 名称洁净度检查。
 * 部分老字体把 GBK 字符串塞进 UTF-16 记录，解出来是「±Ð¨|³¡Áõ®Ñ」这类残渣，
 * 或者含私用区 / 提非纳等异常码位（如「呗ⵓ畮」），直接不进列表。
 */
function cleanName(raw) {
  const t = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!t || t.length > 64) return '';
  if (/[\ue000-\uf8ff]/.test(t)) return '';                       // 私用区
  if ((t.match(/[\u0080-\u00ff]/g) || []).length >= 2) return '';  // GBK 被当 UTF-16 解的典型特征
  if (/[\u2c80-\u2cff\u2d00-\u2d7f]/.test(t)) return '';           // 异常码位
  // Vai / 西里尔扩展-B / 拉丁扩展-D / 谚文扩展 A、B —— 正常字体名不会用到，出现即解码噪声
  if (/[\ua4d0-\ua64f\ua66e-\ua69f\ua960-\ua97f\ud7b0-\ud7ff]/.test(t)) return '';
  if (/[\u{10000}-\u{10ffff}]/u.test(t)) return '';                // 补充平面（私用区/扩展区），必为噪声
  if (!/[0-9a-z\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/i.test(t)) return '';
  return t;
}

/** 按字符集分类：zh（汉字）/ ja（假名）/ ko（谚文）/ latin */
function scriptOf(s) {
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(s)) return 'ko';
  if (/[\u3040-\u30ff]/.test(s)) return 'ja';
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(s)) return 'zh';
  return 'latin';
}

/**
 * 抢救「伪韩文/伪日文」名：老字体把 GBK 字节直接写进 UTF-16 记录，
 * 读出来是「쏔쓣볲훐쳘맣룦」这类谚文/假名残渣，按 GBK 逆解可还原成「迷你简中特广告」。
 * 还原结果必须是纯汉字且无替换符，否则判定失败（避免把真韩文名改坏）。
 */
function gbkRepair(s) {
  try {
    const b = Buffer.from(s, 'utf16le');
    b.swap16();
    const t = new TextDecoder('gbk').decode(b)
      .replace(/[\u0000-\u001f\u007f\ufffd]/g, '').trim();
    if (!t || t.length > 64) return '';
    if (/[\u3040-\u30ff\uac00-\ud7af\u0080-\u00ff\u{10000}-\u{10ffff}]/u.test(t)) return '';
    // 还原成功的名字应当以汉字为主，否则说明这次逆解也是错的
    const han = (t.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    if (!han || han / t.length < 0.6) return '';
    return t;
  } catch (_) { return ''; }
}

/** 读 name 表，返回 { cn:[], en:[] } */
function readNames(fd, off) {
  const head = readAt(fd, 6, off);
  if (head.length < 6) return null;
  const count = head.readUInt16BE(2);
  const strOff = head.readUInt16BE(4);
  if (!count || count > 4096) return null;
  const recs = readAt(fd, count * 12, off + 6);

  const cn = new Set(), en = new Set();
  const typo = { cn: new Set(), en: new Set() };   // nameID 16：排版家族，可把字重变体归并到同一族
  for (let i = 0; i + 12 <= recs.length; i += 12) {
    const platform = recs.readUInt16BE(i);
    const lang = recs.readUInt16BE(i + 4);
    const nameId = recs.readUInt16BE(i + 6);
    const len = recs.readUInt16BE(i + 8);
    const so = recs.readUInt16BE(i + 10);
    // 只关心家族名：1=家族 16=排版家族（合并粗斜体）
    if (nameId !== 1 && nameId !== 16) continue;
    if (!len || len > 256) continue;
    let text = '';
    if (platform === 3 || platform === 0) {
      text = decodeName(readAt(fd, len, off + strOff + so));
    } else if (platform === 1) {
      const raw = readAt(fd, len, off + strOff + so);
      // Mac 平台多为单字节编码，含高位字节时无法可靠解码，直接跳过避免乱码
      if (!raw.some(b => b > 0x7e)) text = raw.toString('latin1');
    }
    text = cleanName(text);
    if (!text) continue;
    // 伪韩文/伪日文 → 按 GBK 还原回中文名
    const sc0 = scriptOf(text);
    if (sc0 === 'ko' || sc0 === 'ja') {
      const fixed = gbkRepair(text);
      if (fixed) text = fixed;
      else if (sc0 === 'ko' && !/\s/.test(text)) continue;   // 无空格纯谚文串，基本是解码噪声
    }

    const script = scriptOf(text);
    const bucket = script === 'latin' ? 'en' : 'cn';
    (nameId === 16 ? typo : { cn, en })[bucket].add(text);
  }
  // 有排版家族名时优先用它，避免「微软雅黑 Light」「普惠体 65 Medium」被拆成独立字体
  return {
    cn: typo.cn.size ? [...typo.cn] : [...cn],
    en: typo.en.size ? [...typo.en] : [...en]
  };
}

function scanDir(dir, out) {
  let files = [];
  try { files = fs.readdirSync(dir); } catch (_) { return { dir, files: 0, err: 'readdir failed' }; }
  let n = 0;
  for (const f of files) {
    if (!/\.(ttf|ttc|otf|otc)$/i.test(f)) continue;
    const p = path.join(dir, f);
    let fd = -1;
    try {
      const st = fs.statSync(p);
      if (!st.isFile() || st.size < 256) continue;
      fd = fs.openSync(p, 'r');
      n++;
      for (const base of fontOffsets(fd)) {
        const no = nameTableOffset(fd, base);
        if (!no) continue;
        const nm = readNames(fd, no);
        if (!nm) continue;
        // 中文名作为显示名，英文名只作搜索别名，避免列表里同一字体出现两次
        if (nm.cn.length) {
          const alias = nm.en.join(' / ');
          nm.cn.forEach(name => addFont(out, name, alias));
        } else {
          nm.en.forEach(name => addFont(out, name, ''));
        }
      }
    } catch (_) {
      /* 单个文件失败不影响整体 */
    } finally {
      if (fd >= 0) { try { fs.closeSync(fd); } catch (_) {} }
    }
  }
  return { dir, files: n };
}

/** out: Map<显示名, { aliases:Set, script }> */
function addFont(out, name, alias) {
  const key = cleanName(name);
  if (!key) return;
  let rec = out.get(key);
  if (!rec) { rec = { aliases: new Set(), script: scriptOf(key) }; out.set(key, rec); }
  String(alias || '').split(/\s*\/\s*/).forEach(a => {
    const t = cleanName(a);
    if (t && t !== key) rec.aliases.add(t);
  });
}

let cache = null;

function listFonts() {
  if (cache) return cache;
  const dirs = [];
  if (process.platform === 'win32') {
    dirs.push(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'));
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
  } else if (process.platform === 'darwin') {
    dirs.push('/System/Library/Fonts', '/Library/Fonts', path.join(require('os').homedir(), 'Library/Fonts'));
  } else {
    dirs.push('/usr/share/fonts', '/usr/local/share/fonts', path.join(require('os').homedir(), '.local/share/fonts'));
  }

  const map = new Map();
  const scanInfo = [];
  let scanned = 0;
  for (const d of dirs) {
    const r = scanDir(d, map);
    scanInfo.push(r);
    scanned += r.files;
  }

  // 排序：中文字体最前 → 日文 → 韩文 → 拉丁；同组按中文习惯排序
  const ORDER = { zh: 0, ja: 1, ko: 2, latin: 3 };
  const fonts = [...map.entries()].map(([name, rec]) => ({
    name, aliases: [...rec.aliases], script: rec.script
  })).sort((a, b) => {
    const d = (ORDER[a.script] ?? 9) - (ORDER[b.script] ?? 9);
    if (d) return d;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  const stats = { zh: 0, ja: 0, ko: 0, latin: 0 };
  for (const f of fonts) stats[f.script]++;

  cache = { ok: fonts.length > 0, count: fonts.length, scanned, dirs: scanInfo, stats, fonts };
  return cache;
}

module.exports = { listFonts };
