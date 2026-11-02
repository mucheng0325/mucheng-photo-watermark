/* 输出四款新版式的真实渲染结果（直接取预览 canvas 的位图）
 * 用法: node tools/shot-layouts.js [布局名,逗号分隔]
 * 产物: tools/ui-shots/layout-<name>.png
 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..', 'src').replace(/\\/g, '/');
const OUT = path.resolve(__dirname, 'ui-shots');
const PORT = 9436;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const names = (process.argv[2] || 'card,film,hud,edge,gallery,frame').split(',').map(s => s.trim()).filter(Boolean);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1480,940', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-lay-' + Date.now()), 'about:blank'], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {}
    await sleep(400);
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (mm, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 940, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.desktopApi = { platform:'win32', chooseDir: async()=>'', saveFile: async()=>({ok:true}),
      listFonts: async()=>({ok:true,count:0,scanned:0,stats:{},fonts:[]}), setBgColor: async()=>({ok:true}), openOutDir: async()=>({ok:true}) };`
  });
  await send('Page.navigate', { url: `file:///${ROOT}/index.html?demo=1` });
  await sleep(4500);

  const loaded = await ev(`!!(state && state.files && state.files.length)`);
  console.log('演示图已载入:', loaded);

  for (const n of names) {
    // 默认按 1600px 宽离屏渲染：预览画布只有 700 多宽，看不清小字与细线
    const data = await ev(`(()=>{
      cfg.layout = ${JSON.stringify(n)};
      syncUI();
      const f = state.files[state.cur];
      const { W, H } = orientedSize(f);
      const g = Render.frameGeom(cfg, W, H);
      const k = 1600 / g.outW;
      const sc = sceneOf(f, k);
      const cv = document.createElement('canvas');
      cv.width = sc.outW; cv.height = sc.outH;
      paintScene(cv.getContext('2d'), f, sc);
      return cv.toDataURL('image/png');
    })()`);
    if (!data || data.indexOf('data:image') !== 0) { console.log('✗', n, '无输出'); continue; }
    const buf = Buffer.from(data.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, `layout-${n}.png`), buf);
    console.log(`✓ layout-${n}.png  ${(buf.length / 1024).toFixed(0)}KB`);
  }

  proc.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
