//! 配置持久化
//!
//! UI 的状态原本只存在 WebView 的 localStorage 里（LevelDB 二进制，不可读）。
//! 这里做一件很轻的镜像：前端每次改动 `ecw.*` 键，就把整份快照写进
//! `<数据目录>/config.json`，于是配置文件变成人类可读、可备份、可换机带走。
//!
//! 写盘用「临时文件 + 原子 rename」，断电最多丢一次改动，不会留下半个 JSON。

use serde_json::{json, Value};
use std::path::Path;

pub const SCHEMA: u32 = 1;

fn empty_doc() -> Value {
    json!({
        "schema": SCHEMA,
        "app": "暮呈照片水印工作台",
        "savedAt": "",
        "note": "本文件由程序自动维护，可直接备份或复制到另一台机器的 data 目录下。",
        "kv": {}
    })
}

/// 读取配置文档；文件不存在或损坏时返回空文档。
pub fn load() -> Value {
    let path = crate::paths::config_file();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return empty_doc();
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(v) if v.is_object() => v,
        Ok(_) => empty_doc(),
        Err(e) => {
            crate::logger::write("warn", &format!("config.json 解析失败（{e}），已忽略"));
            // 坏文件留个副本，方便用户手工抢救
            let bak = path.with_extension("json.broken");
            let _ = std::fs::copy(&path, &bak);
            empty_doc()
        }
    }
}

/// 原子写入配置文档。
pub fn save(doc: &Value) -> Result<(), String> {
    let path = crate::paths::config_file();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建数据目录失败：{e}"))?;
    }
    let text = serde_json::to_string_pretty(doc).map_err(|e| format!("序列化失败：{e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| format!("写入临时文件失败：{e}"))?;
    replace_file(&tmp, &path).map_err(|e| format!("替换配置文件失败：{e}"))?;
    Ok(())
}

/// Windows 上 `rename` 不能覆盖已存在文件，先删再改名；
/// 删失败时退回直接覆盖写，保证至少能保存成功。
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if to.exists() {
        let _ = std::fs::remove_file(to);
    }
    match std::fs::rename(from, to) {
        Ok(_) => Ok(()),
        Err(_) => {
            std::fs::copy(from, to)?;
            let _ = std::fs::remove_file(from);
            Ok(())
        }
    }
}

/// 首次运行时生成一份说明用的空配置，让用户能立刻看到文件在哪。
pub fn ensure_seed() {
    let path = crate::paths::config_file();
    if path.exists() {
        return;
    }
    let mut doc = empty_doc();
    doc["savedAt"] = json!(crate::logger::now_iso());
    let _ = save(&doc);
}
