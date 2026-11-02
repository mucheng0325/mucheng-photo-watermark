//! 绿色版路径解析
//!
//! 设计原则：所有运行期路径一律由「可执行文件自身所在目录」派生，
//! 不出现任何硬编码盘符/绝对路径，也不写入 `%APPDATA%`、`%LOCALAPPDATA%`、`%TEMP%`。
//!
//! ```text
//! <软件目录>/
//! └─ data/
//!    ├─ config.json      全部配置（人类可读，可备份/拷贝/手改）
//!    ├─ logs/app.log     运行日志
//!    └─ webview/         WebView2 用户数据（localStorage、缓存）
//! ```
//!
//! 调试/特殊部署可用环境变量覆盖（属于显式覆盖，不是硬编码）：
//! - `ECW_ROOT_DIR` 覆盖软件根目录
//! - `ECW_DATA_DIR` 覆盖数据目录

use std::path::PathBuf;

/// 可执行文件所在目录。解析失败时退回当前工作目录。
pub fn app_root() -> PathBuf {
    if let Some(p) = env_path("ECW_ROOT_DIR") {
        return p;
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(PathBuf::from))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

/// 数据根目录：默认 `<软件目录>/data`。
pub fn data_dir() -> PathBuf {
    env_path("ECW_DATA_DIR").unwrap_or_else(|| app_root().join("data"))
}

pub fn webview_dir() -> PathBuf {
    data_dir().join("webview")
}

pub fn log_dir() -> PathBuf {
    data_dir().join("logs")
}

pub fn config_file() -> PathBuf {
    data_dir().join("config.json")
}

fn env_path(key: &str) -> Option<PathBuf> {
    match std::env::var(key) {
        Ok(v) if !v.trim().is_empty() => Some(PathBuf::from(v.trim())),
        _ => None,
    }
}

/// 建立目录树。返回错误信息供调用方提示用户（通常是程序被放进了只读目录）。
pub fn ensure_dirs() -> Result<(), String> {
    for dir in [data_dir(), log_dir(), webview_dir()] {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("无法创建目录 {}：{}", dir.display(), e))?;
    }
    // 实际写一个探针文件，确认目录真的可写（而不是只有 ACL 允许建目录）
    let probe = data_dir().join(".write-test");
    std::fs::write(&probe, b"ok")
        .map_err(|e| format!("数据目录不可写 {}：{}", data_dir().display(), e))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// 旧版（配置写在 `%LOCALAPPDATA%` 时期）的 WebView 数据目录。
fn legacy_webview_dir() -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let p = PathBuf::from(base).join("com.linghang.exifcam").join("EBWebView");
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

/// 首次运行把旧版 WebView 数据整目录搬进 `data/webview`。
///
/// 注意层级：我们传给 WebView2 的 user data folder 是 `data/webview`，
/// WebView2 会在其下**再建一层 `EBWebView`** 存放真实数据（Default / Local State ...）。
/// 所以迁移目标必须是 `data/webview/EBWebView`，否则数据搬过去也不会被读到。
///
/// 只读取旧目录（不写不删），因此仍然满足「不向系统用户目录写入」的要求。
/// 迁移成功后写一个标记文件，避免重复搬。
pub fn migrate_legacy_webview() -> Option<String> {
    let base = webview_dir();
    let target = base.join("EBWebView");
    let marker = base.join(".migrated-from-legacy");
    if marker.exists() || target.join("Default").exists() {
        return None;
    }
    let Some(src) = legacy_webview_dir() else {
        return None;
    };
    match copy_dir(&src, &target) {
        Ok(n) => {
            let _ = std::fs::write(&marker, format!("source={}\nfiles={}\n", src.display(), n));
            Some(format!("已从 {} 迁移 {} 个文件", src.display(), n))
        }
        Err(e) => Some(format!("旧数据迁移失败：{e}")),
    }
}

fn copy_dir(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<usize> {
    std::fs::create_dir_all(dst)?;
    let mut count = 0usize;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        // WebView2 运行时会留锁文件，搬过去也没用，直接跳过
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "LOCK" || name == "LOCKFILE" || name.ends_with(".lock") {
            continue;
        }
        let ty = entry.file_type()?;
        if ty.is_dir() {
            count += copy_dir(&from, &to)?;
        } else if ty.is_file() {
            match std::fs::copy(&from, &to) {
                Ok(_) => count += 1,
                // 个别缓存文件可能读不了，跳过即可，不影响配置恢复
                Err(_) => continue,
            }
        }
    }
    Ok(count)
}

/// 供 UI 展示的路径清单（全部动态解析，不含硬编码）
pub fn info() -> serde_json::Value {
    serde_json::json!({
        "root": app_root().to_string_lossy(),
        "data": data_dir().to_string_lossy(),
        "logs": log_dir().to_string_lossy(),
        "config": config_file().to_string_lossy(),
        "webview": webview_dir().to_string_lossy(),
    })
}
