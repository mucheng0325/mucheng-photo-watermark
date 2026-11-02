#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 暮呈照片水印工作台 · 桌面外壳
//!
//! 绿色版约定：
//! - 程序不安装、不注册表、不写入用户目录；
//! - 所有数据（配置 / 日志 / WebView 缓存）落在 `<exe 所在目录>/data`；
//! - 路径一律由 `paths` 模块从 `current_exe()` 动态解析。

mod fonts_scan;
mod logger;
mod paths;
mod store;

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// 当前导出目录。绿色版语义：不记录到任何配置文件，只在本次运行内有效。
struct OutDir(Mutex<Option<PathBuf>>);

#[tauri::command]
fn choose_dir(state: State<OutDir>) -> String {
    let picked = rfd::FileDialog::new()
        .set_title("选择水印照片输出目录")
        .pick_folder();
    match picked {
        Some(p) => {
            logger::write("info", &format!("输出目录 → {}", p.display()));
            *state.0.lock().unwrap() = Some(p.clone());
            p.to_string_lossy().into_owned()
        }
        None => String::new(),
    }
}

#[tauri::command]
fn save_file(name: String, bytes: Vec<u8>, state: State<OutDir>) -> Value {
    let dir = state.0.lock().unwrap().clone();
    let Some(dir) = dir else {
        return json!({ "ok": false, "error": "未选择输出目录" });
    };
    let safe: String = name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let p = dir.join(&safe);
    match std::fs::write(&p, &bytes) {
        Ok(_) => json!({ "ok": true, "path": p.to_string_lossy() }),
        Err(e) => {
            logger::write("error", &format!("写入 {} 失败：{e}", p.display()));
            json!({ "ok": false, "error": e.to_string() })
        }
    }
}

#[tauri::command]
fn list_fonts() -> Value {
    serde_json::to_value(fonts_scan::list_fonts()).unwrap()
}

#[tauri::command]
fn set_bg_color(window: tauri::WebviewWindow, hex: String) -> Value {
    let h = hex.trim();
    if h.len() == 7 && h.starts_with('#') {
        let r = u8::from_str_radix(&h[1..3], 16);
        let g = u8::from_str_radix(&h[3..5], 16);
        let b = u8::from_str_radix(&h[5..7], 16);
        if let (Ok(r), Ok(g), Ok(b)) = (r, g, b) {
            let color = tauri::utils::config::Color(r, g, b, 255);
            let _ = window.set_background_color(Some(color));
        }
    }
    json!({ "ok": true })
}

#[tauri::command]
fn open_out_dir(state: State<OutDir>) -> Value {
    let dir = state.0.lock().unwrap().clone();
    let Some(dir) = dir else {
        return json!({ "ok": false, "error": "未选择输出目录" });
    };
    open_in_explorer(&dir)
}

/* ---------- 绿色版数据目录 ---------- */

/// 返回全部运行期路径，供界面展示（全部动态解析，无硬编码）。
#[tauri::command]
fn paths_info() -> Value {
    paths::info()
}

/// 读配置文档（含 kv 快照）。
#[tauri::command]
fn store_load() -> Value {
    let doc = store::load();
    json!({
        "ok": true,
        "schema": doc.get("schema").cloned().unwrap_or(json!(0)),
        "savedAt": doc.get("savedAt").cloned().unwrap_or(json!("")),
        "kv": doc.get("kv").cloned().unwrap_or(json!({})),
        "path": paths::config_file().to_string_lossy()
    })
}

/// 写配置文档（前端把整个 `ecw.*` 快照交上来）。
#[tauri::command]
fn store_save(mut doc: Value) -> Value {
    if !doc.is_object() {
        return json!({ "ok": false, "error": "配置必须是对象" });
    }
    doc["schema"] = json!(store::SCHEMA);
    doc["app"] = json!("暮呈照片水印工作台");
    doc["savedAt"] = json!(logger::now_iso());
    match store::save(&doc) {
        Ok(_) => json!({ "ok": true, "path": paths::config_file().to_string_lossy() }),
        Err(e) => {
            logger::write("error", &format!("配置保存失败：{e}"));
            json!({ "ok": false, "error": e })
        }
    }
}

/// 前端把运行期异常交过来落盘（release 无控制台，日志是唯一现场）。
#[tauri::command]
fn log_write(level: String, msg: String) -> Value {
    let msg: String = msg.chars().take(4000).collect();
    logger::write(&level, &msg);
    json!({ "ok": true })
}

#[tauri::command]
fn open_data_dir() -> Value {
    open_in_explorer(&paths::data_dir())
}

#[tauri::command]
fn open_log_file() -> Value {
    let p = logger::log_path();
    if !p.exists() {
        logger::write("info", "用户打开日志文件（此前无记录）");
    }
    match std::process::Command::new("notepad").arg(&p).spawn() {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

fn open_in_explorer(dir: &std::path::Path) -> Value {
    let _ = std::fs::create_dir_all(dir);
    match std::process::Command::new("explorer").arg(dir).spawn() {
        Ok(_) => json!({ "ok": true }),
        Err(e) => {
            logger::write("error", &format!("打开目录失败 {}：{e}", dir.display()));
            json!({ "ok": false, "error": e.to_string() })
        }
    }
}

/* ---------- 自绘标题栏：关掉系统边框后由前端顶栏接管窗口控制 ---------- */

#[tauri::command]
fn win_minimize(window: tauri::WebviewWindow) -> Value {
    let _ = window.minimize();
    json!({ "ok": true })
}

#[tauri::command]
fn win_toggle_max(window: tauri::WebviewWindow) -> Value {
    // WebviewWindow 上没有 toggle_maximize，按当前状态自行取反
    let now = window.is_maximized().unwrap_or(false);
    let _ = if now { window.unmaximize() } else { window.maximize() };
    json!({ "ok": true, "maximized": !now })
}

#[tauri::command]
fn win_close(window: tauri::WebviewWindow) -> Value {
    logger::write("info", "窗口关闭");
    let _ = window.close();
    json!({ "ok": true })
}

#[tauri::command]
fn win_start_drag(window: tauri::WebviewWindow) -> Value {
    let _ = window.start_dragging();
    json!({ "ok": true })
}

#[tauri::command]
fn win_start_resize(window: tauri::WebviewWindow, dir: String) -> Value {
    use tauri_runtime::ResizeDirection as D;
    let d = match dir.as_str() {
        "n" => D::North,
        "s" => D::South,
        "e" => D::East,
        "w" => D::West,
        "ne" => D::NorthEast,
        "nw" => D::NorthWest,
        "se" => D::SouthEast,
        "sw" => D::SouthWest,
        _ => return json!({ "ok": false, "error": "unknown direction" }),
    };
    // start_resize_dragging 在 window::Window 上，WebviewWindow 需先取内层 Window
    let _ = window.as_ref().window().start_resize_dragging(d);
    json!({ "ok": true })
}

#[tauri::command]
fn win_state(window: tauri::WebviewWindow) -> Value {
    json!({
        "maximized": window.is_maximized().unwrap_or(false),
        "minimized": window.is_minimized().unwrap_or(false)
    })
}

fn main() {
    tauri::Builder::default()
        .manage(OutDir(Mutex::new(
            std::env::var("ECW_OUT_DIR").ok().map(PathBuf::from),
        )))
        .setup(|app| {
            // 1) 数据目录必须先就位：配置、日志、WebView 缓存都依赖它
            if let Err(e) = paths::ensure_dirs() {
                rfd::MessageDialog::new()
                    .set_level(rfd::MessageLevel::Error)
                    .set_title("暮呈照片水印工作台 · 无法启动")
                    .set_description(format!(
                        "{e}\n\n本程序为绿色免安装版，所有数据都写在程序所在目录的 data 文件夹。\
                         \n请把程序放到有写入权限的位置再运行（例如 D 盘自建文件夹），\
                         \n不要放在 Program Files 或只读介质里。"
                    ))
                    .show();
                std::process::exit(1);
            }
            logger::init();
            logger::write(
                "info",
                &format!(
                    "==== 启动 · v{} · 根目录 {} ====",
                    env!("CARGO_PKG_VERSION"),
                    paths::app_root().display()
                ),
            );
            if let Some(msg) = paths::migrate_legacy_webview() {
                logger::write("info", &msg);
            }
            store::ensure_seed();

            // 2) 自建主窗口：把 WebView2 用户数据目录钉在 <数据目录>/webview
            let handle = app.handle().clone();
            tauri::WebviewWindowBuilder::new(
                &handle,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("暮呈照片水印工作台")
            .inner_size(1480.0, 940.0)
            .min_inner_size(1180.0, 720.0)
            .decorations(false)
            .shadow(true)
            .center()
            .background_color(tauri::window::Color(7, 9, 14, 255))
            .data_directory(paths::webview_dir())
            .build()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_dir,
            save_file,
            list_fonts,
            set_bg_color,
            open_out_dir,
            paths_info,
            store_load,
            store_save,
            log_write,
            open_data_dir,
            open_log_file,
            win_minimize,
            win_toggle_max,
            win_close,
            win_start_drag,
            win_start_resize,
            win_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
