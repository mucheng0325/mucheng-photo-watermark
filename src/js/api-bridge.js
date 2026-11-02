/* ============ 桌面 API 桥接 ============
 * Electron：preload.js 直接注入 window.desktopApi，这里检测到即退出。
 * Tauri：window.__TAURI__（withGlobalTauri）存在时，把 desktopApi 映射到 invoke 命令。
 * 纯浏览器：两者都没有 → 不注入，app.js 走浏览器降级逻辑。
 * ==================================== */
(function () {
  if (window.desktopApi) return;                      // Electron preload 已注入
  const t = window.__TAURI__;
  if (!t || !t.core || !t.core.invoke) return;        // 非 Tauri 环境
  const inv = (cmd, args) => t.core.invoke(cmd, args);
  window.desktopApi = {
    chooseDir: () => inv('choose_dir'),
    saveFile: (name, bytes) => inv('save_file', { name, bytes: Array.from(bytes) }),
    listFonts: () => inv('list_fonts'),
    setBgColor: hex => inv('set_bg_color', { hex }),
    openOutDir: () => inv('open_out_dir'),
    // 自绘标题栏（无边框窗口）
    winMin: () => inv('win_minimize'),
    winToggleMax: () => inv('win_toggle_max'),
    winClose: () => inv('win_close'),
    winDrag: () => inv('win_start_drag'),
    winResize: dir => inv('win_start_resize', { dir }),
    winState: () => inv('win_state').then(r => !!(r && r.maximized)).catch(() => false),
    // 绿色版：数据目录、配置镜像、日志
    dataPaths: () => inv('paths_info'),
    storeLoad: () => inv('store_load'),
    storeSave: doc => inv('store_save', { doc }),
    logWrite: (level, msg) => inv('log_write', { level, msg }),
    openDataDir: () => inv('open_data_dir'),
    openLogFile: () => inv('open_log_file'),
    platform: 'win32'
  };
})();
