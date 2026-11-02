/* 真机验证：启动绿色版 exe，逐个切换新版式并截图（窗口 + 预览区）
 * 用法: node tools/shot-real.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EXE = path.join(__dirname, '..', 'build-out', '暮呈照片水印工作台', '暮呈照片水印工作台.exe');
const DIR = path.dirname(EXE);
const PORT = 9493;
const OUT = path.join(__dirname, 'ui-shots');

const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const p = spawn(EXE, [], {
    cwd: DIR,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore'
  });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { targets = await getJSON(`http://127.0.0.1:${PORT}/json/list`); if (targets && targets.length) break; } catch (_) {}
  }
  if (!targets) { console.log('无法连接调试端口'); p.kill(); process.exit(1); }

  const t = targets.find(x => x.type === 'page') || targets[0];
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (mm, pp = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: pp })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;

  await send('Runtime.enable'); await send('Page.enable');
  await ev(`location.href = 'http://tauri.localhost/?demo=1'`);
  await sleep(5000);

  console.log('照片数:', await ev(`state.files.length`), '版本:', await ev(`document.querySelector('.about-list dd').textContent`));

  // 版式面板整体（看 9 个按钮排布）
  await ev(`cfg.layout='film'; syncUI(); renderPreview(); 1`);
  await sleep(700);
  const panel = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'v12-layout-panel.png'), Buffer.from(panel.result.data, 'base64'));
  console.log('✓ v12-layout-panel.png');

  for (const lay of ['film', 'hud', 'edge', 'gallery']) {
    await ev(`cfg.layout='${lay}'; syncUI(); renderPreview(); 1`);
    await sleep(700);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `v12-real-${lay}.png`), Buffer.from(r.result.data, 'base64'));
    console.log(`✓ v12-real-${lay}.png`);
  }

  // gallery 专属字段是否出现
  const galCtrl = await ev(`(()=>{
    cfg.layout='gallery'; syncUI();
    const f=[...document.querySelectorAll('[data-lay="gallery"]')];
    return JSON.stringify({count:f.length, allShown:f.every(n=>!n.hidden), frameHidden:document.querySelector('[data-lay="frame"]').hidden});
  })()`);
  console.log('gallery 控件:', galCtrl);

  p.kill();
  spawn('taskkill', ['/im', '暮呈照片水印工作台.exe', '/f'], { stdio: 'ignore' });
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
