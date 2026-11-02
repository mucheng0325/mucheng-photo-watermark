//! 文件日志
//!
//! 日志固定写到 `<数据目录>/logs/app.log`，超过 2MB 自动轮转为 `app.1.log`。
//! 时间戳用 UTC（进程内不依赖系统时区 API，避免额外依赖）。
//! release 构建没有控制台，panic 只能靠这里留下来，所以启动时就装 panic hook。

use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 2 * 1024 * 1024;

pub fn log_path() -> std::path::PathBuf {
    crate::paths::log_dir().join("app.log")
}

/// 安装 panic hook：崩溃信息落盘后再走默认行为。
pub fn init() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "未知 panic".to_string()
        };
        let loc = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_default();
        write("panic", &format!("{msg} @ {loc}"));
        default_hook(info);
    }));
}

pub fn write(level: &str, msg: &str) {
    let dir = crate::paths::log_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = log_path();
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let old = dir.join("app.1.log");
            let _ = std::fs::remove_file(&old);
            let _ = std::fs::rename(&path, &old);
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "{} [{}] {}", now_iso(), level.to_uppercase(), msg);
    }
}

/// 当前 UTC 时间，ISO 8601（如 2026-11-02T04:20:00Z）。
pub fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant 的 days-from-civil 逆运算（纯整数，无时区依赖）。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
