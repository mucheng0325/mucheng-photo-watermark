/* 把各版式按 1:1 输出尺寸渲染成 PNG，供逐像素检查（白框边距、墨色、字号）
 * 用法：node tools/dump_scene.js [card|frame|banner|side|minimal ...]
 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
const PORT = 9419;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { listFonts } = require('../electron/fonts.js');

(async () => {
  const layouts = process.argv.slice(2).length ? process.argv.slice(2) : ['card', 'frame'];
  const fonts = listFonts();
  const payload = JSON.stringify({
    ok: fonts.ok, count: fonts.count, scanned: fonts.scanned, stats: fonts.stats,
    fonts: fonts.fonts.map(f => ({ name: f.name, script: f.script, aliases: (f.aliases || []).slice(0, 2) }))
  });
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1480,940', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-dump-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {}
    await sleep(400);
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (mm, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.desktopApi = { platform:'win32', chooseDir: async()=>'', saveFile: async()=>({ok:true}),
      listFonts: async()=>(${payload}), setBgColor: async()=>({ok:true}), openOutDir: async()=>({ok:true}) };`
  });
  await send('Page.navigate', { url: `file:///${ROOT}/index.html?demo=1` });
  await sleep(4300);

  for (const lay of layouts) {
    const r = await ev(`(async()=>{cfg.layout='${lay}';syncUI();scheduleRender(0);
      await new Promise(r=>setTimeout(r,120));
      const f=state.files[0]; const sc=sceneOf(f,1);
      const cv=document.createElement('canvas'); cv.width=sc.outW; cv.height=sc.outH;
      paintScene(cv.getContext('2d'), f, sc);
      return cv.toDataURL('image/png');})()`);
    const buf = Buffer.from(String(r).split(',')[1], 'base64');
    const out = path.join(__dirname, 'ui-shots', `scene-${lay}.png`);
    fs.writeFileSync(out, buf);
    console.log(lay, buf.length, 'bytes →', out);
  }
  spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
})().catch(e => { console.error(e.message, e.stack); process.exit(1); });
