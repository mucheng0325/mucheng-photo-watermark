/* ============ 本机字体枚举（fonts.js 的 Rust 移植） ============
 * 与 electron/fonts.js 逐函数对译：
 *   fontOffsets / nameTableOffset / decodeName / cleanName / scriptOf /
 *   gbkRepair / readNames / scanDir / addFont / listFonts
 * 不依赖 reg.exe / fontconfig，直接解析 TTF / OTF / TTC 的 name 表。
 * 取 nameID 16（排版家族）优先归并字重族，中文名显示、英文名做搜索别名。
 * ================================================================ */

use encoding_rs::GBK;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

fn be16(d: &[u8], o: usize) -> u16 {
    if o + 2 <= d.len() {
        u16::from_be_bytes([d[o], d[o + 1]])
    } else {
        0
    }
}

fn be32(d: &[u8], o: usize) -> u32 {
    if o + 4 <= d.len() {
        u32::from_be_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
    } else {
        0
    }
}

/// 返回文件内各字体的 sfnt 起始偏移（TTC 会返回多个）
fn font_offsets(data: &[u8]) -> Vec<usize> {
    if data.len() < 12 {
        return vec![];
    }
    let tag = &data[0..4];
    if tag == b"ttcf" {
        let num = be32(data, 8) as usize;
        if num == 0 || num > 512 {
            return vec![0];
        }
        let mut out = Vec::with_capacity(num);
        for i in 0..num {
            let p = 12 + i * 4;
            if p + 4 <= data.len() {
                out.push(be32(data, p) as usize);
            }
        }
        if out.is_empty() { vec![0] } else { out }
    } else if tag == b"wOFF" || tag == b"wOF2" {
        vec![] // web 字体无需枚举
    } else {
        vec![0]
    }
}

/// 在 sfnt 头里找 name 表的绝对偏移
fn name_table_offset(data: &[u8], base: usize) -> usize {
    if base + 12 > data.len() {
        return 0;
    }
    let num_tables = be16(data, base + 4) as usize;
    if num_tables == 0 || num_tables > 4096 {
        return 0;
    }
    for i in 0..num_tables {
        let rec = base + 12 + i * 16;
        if rec + 16 > data.len() {
            break;
        }
        if &data[rec..rec + 4] == b"name" {
            return be32(data, rec + 8) as usize;
        }
    }
    0
}

/// Windows / Unicode 平台的 name 记录是 UTF-16BE
fn decode_name(d: &[u8]) -> String {
    let n = d.len() - d.len() % 2;
    let units: Vec<u16> = (0..n)
        .step_by(2)
        .map(|i| u16::from_be_bytes([d[i], d[i + 1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

/// 名称洁净度检查（与 JS cleanName 对译）
fn clean_name(raw: &str) -> String {
    let t: String = raw
        .chars()
        .filter(|c| {
            let x = *c as u32;
            !(x <= 0x1f || x == 0x7f)
        })
        .collect();
    let t = t.trim();
    if t.is_empty() || t.chars().count() > 64 {
        return String::new();
    }
    for c in t.chars() {
        let x = c as u32;
        if (0xe000..=0xf8ff).contains(&x) {
            return String::new(); // 私用区
        }
    }
    if t.chars().filter(|c| (0x80..=0xff).contains(&(*c as u32))).count() >= 2 {
        return String::new(); // GBK 被当 UTF-16 解的典型特征
    }
    for c in t.chars() {
        let x = c as u32;
        if (0x2c80..=0x2cff).contains(&x) || (0x2d00..=0x2d7f).contains(&x) {
            return String::new(); // 异常码位
        }
    }
    // Vai / 西里尔扩展-B / 拉丁扩展-D / 谚文扩展 A、B —— 解码噪声
    for c in t.chars() {
        let x = c as u32;
        if (0xa4d0..=0xa64f).contains(&x)
            || (0xa66e..=0xa69f).contains(&x)
            || (0xa960..=0xa97f).contains(&x)
            || (0xd7b0..=0xd7ff).contains(&x)
        {
            return String::new();
        }
    }
    if t.chars().any(|c| (c as u32) > 0xffff) {
        return String::new(); // 补充平面，必为噪声
    }
    // 必须含 [0-9a-z]（不分大小写）/ 汉字区 / 假名 / 谚文
    let has_valid = t.chars().any(|c| {
        let x = c as u32;
        c.is_ascii_alphanumeric()
            || (0x3400..=0x9fff).contains(&x)
            || (0xf900..=0xfaff).contains(&x)
            || (0x3040..=0x30ff).contains(&x)
            || (0xac00..=0xd7af).contains(&x)
    });
    if !has_valid {
        return String::new();
    }
    t.to_string()
}

/// 按字符集分类：zh（汉字）/ ja（假名）/ ko（谚文）/ latin
fn script_of(s: &str) -> &'static str {
    for c in s.chars() {
        let x = c as u32;
        if (0xac00..=0xd7af).contains(&x) || (0x1100..=0x11ff).contains(&x) || (0x3130..=0x318f).contains(&x) {
            return "ko";
        }
    }
    for c in s.chars() {
        let x = c as u32;
        if (0x3040..=0x30ff).contains(&x) {
            return "ja";
        }
    }
    for c in s.chars() {
        let x = c as u32;
        if (0x3400..=0x9fff).contains(&x) || (0xf900..=0xfaff).contains(&x) {
            return "zh";
        }
    }
    "latin"
}

fn is_han(x: u32) -> bool {
    (0x3400..=0x9fff).contains(&x) || (0xf900..=0xfaff).contains(&x)
}

/// 抢救「伪韩文/伪日文」名：GBK 字节被写进 UTF-16 记录，按 GBK 逆解还原中文名。
/// 还原结果必须以汉字为主（≥60%）且无噪声，否则判定失败。
fn gbk_repair(s: &str) -> String {
    // s 的 UTF-16BE 字节序列当作 GBK 解
    let mut bytes = Vec::with_capacity(s.len() * 2);
    for u in s.encode_utf16() {
        bytes.extend_from_slice(&u.to_be_bytes());
    }
    let (decoded, _, had_errors) = GBK.decode(&bytes);
    if had_errors {
        return String::new();
    }
    let t: String = decoded
        .chars()
        .filter(|c| {
            let x = *c as u32;
            !(x <= 0x1f || x == 0x7f || x == 0xfffd)
        })
        .collect();
    let t = t.trim();
    if t.is_empty() || t.chars().count() > 64 {
        return String::new();
    }
    for c in t.chars() {
        let x = c as u32;
        if (0x3040..=0x30ff).contains(&x)
            || (0xac00..=0xd7af).contains(&x)
            || (0x80..=0xff).contains(&x)
            || x > 0xffff
        {
            return String::new();
        }
    }
    let han = t.chars().filter(|c| is_han(*c as u32)).count();
    let total = t.chars().count();
    if han == 0 || (han as f64) / (total as f64) < 0.6 {
        return String::new();
    }
    t.to_string()
}

/// 读 name 表，返回 (cn, en) 两个集合；有排版家族名（nameID 16）时优先
fn read_names(data: &[u8], off: usize) -> Option<(HashSet<String>, HashSet<String>)> {
    if off + 6 > data.len() {
        return None;
    }
    let count = be16(data, off + 2) as usize;
    let str_off = be16(data, off + 4) as usize;
    if count == 0 || count > 4096 {
        return None;
    }
    let mut cn = HashSet::new();
    let mut en = HashSet::new();
    let mut typo_cn = HashSet::new();
    let mut typo_en = HashSet::new();
    for i in 0..count {
        let rec = off + 6 + i * 12;
        if rec + 12 > data.len() {
            break;
        }
        let platform = be16(data, rec) as u32;
        let name_id = be16(data, rec + 6) as u32;
        let len = be16(data, rec + 8) as usize;
        let so = be16(data, rec + 10) as usize;
        if name_id != 1 && name_id != 16 {
            continue;
        }
        if len == 0 || len > 256 {
            continue;
        }
        let pos = off + str_off + so;
        if pos + len > data.len() {
            continue;
        }
        let mut text = match platform {
            3 | 0 => clean_name(&decode_name(&data[pos..pos + len])),
            1 => {
                let raw = &data[pos..pos + len];
                // Mac 平台多为单字节编码，含高位字节时无法可靠解码，跳过避免乱码
                if raw.iter().any(|b| *b > 0x7e) {
                    String::new()
                } else {
                    clean_name(&String::from_utf8_lossy(raw))
                }
            }
            _ => String::new(),
        };
        if text.is_empty() {
            continue;
        }
        // 伪韩文/伪日文 → 按 GBK 还原回中文名
        let sc0 = script_of(&text);
        if sc0 == "ko" || sc0 == "ja" {
            let fixed = gbk_repair(&text);
            if !fixed.is_empty() {
                text = fixed;
            } else if sc0 == "ko" && !text.contains(' ') {
                continue; // 无空格纯谚文串，基本是解码噪声
            }
        }
        let script = script_of(&text);
        let typo = name_id == 16;
        if script == "latin" {
            if typo { typo_en.insert(text); } else { en.insert(text); }
        } else {
            if typo { typo_cn.insert(text); } else { cn.insert(text); }
        }
    }
    let (cn, en) = if !typo_cn.is_empty() || !typo_en.is_empty() {
        (typo_cn, typo_en)
    } else {
        (cn, en)
    };
    Some((cn, en))
}

#[derive(Default)]
struct FontRec {
    aliases: HashSet<String>,
    script: &'static str,
}

/// out: Map<显示名, FontRec>
fn add_font(out: &mut HashMap<String, FontRec>, name: &str, alias: &str) {
    let key = clean_name(name);
    if key.is_empty() {
        return;
    }
    let rec = out
        .entry(key.clone())
        .or_insert_with(|| FontRec { aliases: HashSet::new(), script: script_of(&key) });
    if !alias.is_empty() {
        for a in alias.split('/') {
            let t = clean_name(a.trim());
            if !t.is_empty() && t != key {
                rec.aliases.insert(t);
            }
        }
    }
}

fn scan_dir(dir: &Path, out: &mut HashMap<String, FontRec>) -> (usize, Option<String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return (0, Some("readdir failed".into())),
    };
    let mut n = 0usize;
    for e in entries.flatten() {
        let p = e.path();
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
        if !matches!(ext.as_str(), "ttf" | "ttc" | "otf" | "otc") {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        if !meta.is_file() || meta.len() < 256 {
            continue;
        }
        let Ok(data) = std::fs::read(&p) else { continue };
        n += 1;
        for base in font_offsets(&data) {
            let no = name_table_offset(&data, base);
            if no == 0 {
                continue;
            }
            let Some((cn, en)) = read_names(&data, no) else { continue };
            if !cn.is_empty() {
                let alias = en.into_iter().collect::<Vec<_>>().join(" / ");
                for name in &cn {
                    add_font(out, name, &alias);
                }
            } else {
                for name in &en {
                    add_font(out, name, "");
                }
            }
        }
    }
    (n, None)
}

#[derive(Serialize)]
pub struct ScanInfo {
    dir: String,
    files: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    err: Option<String>,
}

#[derive(Serialize)]
pub struct FontsResult {
    ok: bool,
    count: usize,
    scanned: usize,
    dirs: Vec<ScanInfo>,
    stats: HashMap<String, usize>,
    fonts: Vec<FontEntry>,
}

#[derive(Serialize)]
pub struct FontEntry {
    name: String,
    aliases: Vec<String>,
    script: &'static str,
}

pub fn list_fonts() -> FontsResult {
    static CACHE: OnceLock<Mutex<Option<FontsResult>>> = OnceLock::new();
    let cell = CACHE.get_or_init(|| Mutex::new(None));
    if let Some(c) = cell.lock().unwrap().as_ref() {
        // 引用不能直接返回，克隆一次（调用频率极低，可接受）
        return clone_result(c);
    }

    let mut dirs: Vec<PathBuf> = Vec::new();
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into());
    dirs.push(Path::new(&windir).join("Fonts"));
    if let Ok(lad) = std::env::var("LOCALAPPDATA") {
        dirs.push(Path::new(&lad).join(r"Microsoft\Windows\Fonts"));
    }

    let mut map: HashMap<String, FontRec> = HashMap::new();
    let mut scan_info = Vec::new();
    let mut scanned = 0usize;
    for d in &dirs {
        let (n, err) = scan_dir(d, &mut map);
        scan_info.push(ScanInfo { dir: d.to_string_lossy().into_owned(), files: n, err });
        scanned += n;
    }

    // 排序：中文字体最前 → 日文 → 韩文 → 拉丁；同组按名称排序
    let order = |s: &str| match s {
        "zh" => 0,
        "ja" => 1,
        "ko" => 2,
        "latin" => 3,
        _ => 9,
    };
    let mut fonts: Vec<FontEntry> = map
        .into_iter()
        .map(|(name, rec)| FontEntry {
            name,
            aliases: rec.aliases.into_iter().collect(),
            script: rec.script,
        })
        .collect();
    fonts.sort_by(|a, b| {
        order(a.script)
            .cmp(&order(b.script))
            .then_with(|| a.name.cmp(&b.name))
    });

    let mut stats = HashMap::from([
        ("zh".to_string(), 0usize),
        ("ja".to_string(), 0),
        ("ko".to_string(), 0),
        ("latin".to_string(), 0),
    ]);
    for f in &fonts {
        *stats.entry(f.script.to_string()).or_insert(0) += 1;
    }

    let result = FontsResult {
        ok: !fonts.is_empty(),
        count: fonts.len(),
        scanned,
        dirs: scan_info,
        stats,
        fonts,
    };
    *cell.lock().unwrap() = Some(clone_result(&result));
    result
}

fn clone_result(c: &FontsResult) -> FontsResult {
    FontsResult {
        ok: c.ok,
        count: c.count,
        scanned: c.scanned,
        dirs: c.dirs.iter().map(|d| ScanInfo { dir: d.dir.clone(), files: d.files, err: d.err.clone() }).collect(),
        stats: c.stats.clone(),
        fonts: c
            .fonts
            .iter()
            .map(|f| FontEntry { name: f.name.clone(), aliases: f.aliases.clone(), script: f.script })
            .collect(),
    }
}
