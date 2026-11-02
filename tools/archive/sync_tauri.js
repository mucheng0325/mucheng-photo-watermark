/* 把前端源码同步到 tauri-dist/（Tauri 的 frontendDist，会被整体嵌进 exe）
 * 用法：node tools/sync_tauri.js
 * 注意：Tauri 的 build 缓存不看 tauri-dist 的改动，改完前端务必 cargo clean -p exif-cam 再 build。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'tauri-dist');

const FILES = ['index.html', 'css/style.css', 'js/api-bridge.js', 'js/demo-image.js', 'js/exif.js',
  'js/logos.js', 'js/brands.js', 'js/render.js', 'js/app.js', 'tools/demo.jpg'];
const DIRS = ['fonts', 'assets'];

function copy(rel) {
  const src = path.join(ROOT, rel), dst = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return rel;
}

function copyDir(rel) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const it of fs.readdirSync(src, { withFileTypes: true })) {
    const r = path.join(rel, it.name);
    if (it.isDirectory()) { if (it.name === 'full-backup') continue; n += copyDir(r); }
    else { copy(r); n++; }
  }
  return n;
}

FILES.forEach(copy);
let extra = 0;
DIRS.forEach(d => { extra += copyDir(d); });
console.log(`已同步 ${FILES.length} 个文件 + ${extra} 个资源（fonts/assets）到 tauri-dist`);
