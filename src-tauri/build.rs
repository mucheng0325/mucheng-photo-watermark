use std::panic::AssertUnwindSafe;

fn main() {
    let r = std::panic::catch_unwind(AssertUnwindSafe(tauri_build::build));
    if let Err(e) = r {
        let msg = e
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_else(|| "unknown panic".into());
        println!("cargo:warning=PANIC: {}", msg);
        println!("cargo:warning=BACKTRACE: {:?}", std::backtrace::Backtrace::force_capture());
        std::process::exit(1);
    }
}
