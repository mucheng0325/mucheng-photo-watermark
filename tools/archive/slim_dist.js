/* 打包裁剪：Electron 运行时瘦身
 * 删除项：
 *  - locales/ 除 zh-CN、en-US 外的全部语言包（41MB → 1MB）
 *  - LICENSES.chromium.html（9.2MB，许可证文本，不参与运行）
 *  - vk_swiftshader.dll + icd.json（5.5MB，无 GPU 机器的软渲染后备，实测删除不影响启动）
 * 注意：ffmpeg.dll 不能删！它在 Electron 主进程的 import 表里，删除后启动即
 * 0xC0000135（STATUS_DLL_NOT_FOUND），已实测验证。
 * 双模式：
 *  - node tools/slim_dist.js <win-unpacked目录>   手动执行
 *  - electron-builder afterPack 自动调用
 */
const fs = require('fs');
const path = require('path');

const KEEP_LOCALES = new Set(['zh-CN.pak', 'en-US.pak', 'zh-CN.pak.info', 'en-US.pak.info']);
const REMOVE_FILES = ['LICENSES.chromium.html', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json'];

function slim(dir) {
  if (!dir || !fs.existsSync(dir)) return { removed: 0, bytes: 0 };
  let removed = 0, bytes = 0;

  const rm = p => {
    try {
      const st = fs.statSync(p);
      bytes += st.size;
      removed++;
      fs.rmSync(p, { recursive: true, force: true });
    } catch (_) {}
  };

  const locales = path.join(dir, 'locales');
  if (fs.existsSync(locales)) {
    for (const f of fs.readdirSync(locales)) {
      if (!KEEP_LOCALES.has(f)) rm(path.join(locales, f));
    }
  }
  for (const f of REMOVE_FILES) rm(path.join(dir, f));

  return { removed, bytes };
}

module.exports = slim;

if (require.main === module) {
  const dir = process.argv[2];
  const r = slim(dir);
  console.log(`瘦身完成：删除 ${r.removed} 项，释放 ${(r.bytes / 1048576).toFixed(1)}MB`);
}

// electron-builder afterPack（挂在 module.exports 上，避免被 slim 覆盖）
module.exports.default = async function afterPack(context) {
  const dir = context.appOutDir;
  const r = slim(dir);
  console.log(`[slim] ${path.basename(dir)}: 删除 ${r.removed} 项，释放 ${(r.bytes / 1048576).toFixed(1)}MB`);
};
