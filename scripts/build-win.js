#!/usr/bin/env node
/* 构建绿色版发布目录
 *
 * 用法：node scripts/build-win.js
 * 产物：build-out/暮呈照片水印工作台/
 *        ├─ 暮呈照片水印工作台.exe      ← 产品名做文件名
 *        ├─ WebView2Loader.dll          ← Tauri 运行时必需，不能省
 *        ├─ 使用说明.txt
 *        └─ LICENSE
 *
 * 为什么不是「一个 exe」：
 *   Tauri 在 GNU 工具链下动态链接 WebView2Loader.dll。此前它恰好躺在
 *   target/release/ 里，看起来像单文件，一旦只拷 exe 就会 0xC0000135 静默退出。
 *   所以发布目录必须带上这个 160KB 的 DLL。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TAURI = path.join(ROOT, 'src-tauri');
const RELEASE = path.join(TAURI, 'target', 'release');
const OUT = path.join(ROOT, 'build-out');
const APP_NAME = '暮呈照片水印工作台';
const STAGE = path.join(OUT, APP_NAME);

const W64DEVKIT = process.env.W64DEVKIT || 'D:/SOFT/w64devkit';
const CARGO = process.env.CARGO || 'cargo';

function log(msg) { console.log(`[build] ${msg}`); }

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) rmrf(p);
    else { try { fs.unlinkSync(p); } catch (e) { throw new Error(`无法删除 ${p}：${e.message}（程序可能正在运行）`); } }
  }
  try { fs.rmdirSync(dir); } catch (_) {}
}

/** 清空发布目录但保留 data/ —— 里面是用户配置与 WebView 缓存，
 *  既有保留价值，也避免一次删掉几百个缓存文件触发批量删除保护。 */
function cleanStage(dir) {
  if (!fs.existsSync(dir)) return;
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    if (it.name === 'data') continue;
    const p = path.join(dir, it.name);
    if (it.isDirectory()) rmrf(p);
    else { try { fs.unlinkSync(p); } catch (e) { throw new Error(`无法删除 ${p}：${e.message}（程序可能正在运行）`); } }
  }
}

function readVersion() {
  const pkg = fs.readFileSync(path.join(TAURI, 'Cargo.toml'), 'utf8');
  const m = pkg.match(/^version\s*=\s*"([^"]+)"/m);
  return m ? m[1] : '0.0.0';
}

(function main() {
  log(`产品名：${APP_NAME}　版本：${readVersion()}`);

  // 1) 编译。Windows 下必须让 windres / dlltool / as 可用
  const env = { ...process.env };
  if (fs.existsSync(W64DEVKIT)) {
    env.PATH = `${W64DEVKIT}${path.delimiter}${path.join(W64DEVKIT, 'bin')}${path.delimiter}${env.PATH}`;
  } else {
    log(`警告：未找到 ${W64DEVKIT}，若编译报 windres 缺失请设置 W64DEVKIT`);
  }
  log('cargo build --release ...');
  execFileSync(CARGO, ['build', '--release'], { cwd: TAURI, env, stdio: 'inherit' });

  // 2) 组装发布目录
  const exe = path.join(RELEASE, 'exif-cam.exe');
  const dll = path.join(RELEASE, 'WebView2Loader.dll');
  if (!fs.existsSync(exe)) throw new Error(`未找到 ${exe}`);
  if (!fs.existsSync(dll)) throw new Error(`未找到 ${dll}`);

  fs.mkdirSync(OUT, { recursive: true });
  cleanStage(STAGE);
  fs.mkdirSync(STAGE, { recursive: true });

  fs.copyFileSync(exe, path.join(STAGE, `${APP_NAME}.exe`));
  fs.copyFileSync(dll, path.join(STAGE, 'WebView2Loader.dll'));

  // 3) 随包文档
  const readme = [
    `${APP_NAME} v${readVersion()}`,
    '',
    '绿色免安装：双击 exe 即用，无需安装、不写注册表。',
    '',
    '【数据在哪里】',
    '  首次运行会在本文件夹内自动生成 data 子目录，全部数据都在这里：',
    '    data\\config.json   所有设置（可备份、可手动编辑、可换机带走）',
    '    data\\logs\\app.log  运行日志',
    '    data\\webview\\      WebView2 缓存与 localStorage',
    '',
    '  程序不会写入 C 盘，也不会写入 %APPDATA% 等系统用户目录。',
    '  换机器时整个文件夹一起拷走即可，配置与预设都跟着走。',
    '',
    '【注意】',
    '  · 请把本文件夹放在有写入权限的位置（如 D 盘自建目录），',
    '    不要直接放在 Program Files 或只读介质里运行。',
    '  · WebView2Loader.dll 是运行时必需组件，请勿删除。',
    '  · 运行需要系统已安装 Microsoft Edge WebView2 Runtime（Win10/11 一般自带）。',
    '',
    '【许可】',
    '  可个人免费使用；转载需注明出处；禁止一切商业行为。详见 LICENSE。',
    ''
  ].join('\r\n');
  fs.writeFileSync(path.join(STAGE, '使用说明.txt'), readme, 'utf8');

  const lic = path.join(ROOT, 'LICENSE');
  if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(STAGE, 'LICENSE'));

  // 4) 汇总
  const files = fs.readdirSync(STAGE);
  const total = fs.statSync(path.join(STAGE, `${APP_NAME}.exe`)).size
    + (fs.existsSync(path.join(STAGE, 'WebView2Loader.dll')) ? fs.statSync(path.join(STAGE, 'WebView2Loader.dll')).size : 0);
  log(`完成 → ${STAGE}`);
  log(`内容：${files.join('、')}`);
  log(`主程序体积：${(total / 1048576).toFixed(1)} MB（exe + WebView2Loader.dll）`);
})();
