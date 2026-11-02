/* UI 截图：分别截取 版式 / 文字 / 品牌 三个面板，检查新增控件布局 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
const PORT = 9385;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1600,1000',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-ui2'), 'about:blank'], { stdio: 'ignore' });

(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {}
    await sleep(400);
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (mm, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
  const evalJS = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `file:///${ROOT}/index.html?demo=1` });
  await sleep(4500);

  const outDir = `${ROOT}/tools/ui-shots`;
  fs.mkdirSync(outDir, { recursive: true });
  for (const tab of ['layout', 'text', 'brand']) {
    await evalJS(`document.querySelector('.tab[data-tab="${tab}"]').click(); 1`);
    await sleep(400);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, `tab-${tab}.png`), Buffer.from(r.result.data, 'base64'));
  }
  // 顺便确认字体真的生效
  const font = await evalJS(`(() => {
    const u = getComputedStyle(document.body).fontFamily;
    const loaded = [...document.fonts].map(f => f.family + ':' + f.weight + ':' + f.status);
    const c = document.createElement('canvas').getContext('2d');
    c.font = '600 40px PuHuiTi';
    return JSON.stringify({ ui: u, loaded, measured: c.measureText('f/1.8 ISO400').width });
  })()`);
  console.log('FONT:', font);
  console.log('LOGS:', errs.length ? errs.join('\n') : '(无异常)');
  proc.kill(); process.exit(0);
})().catch(e => { console.error('fail', e.message); proc.kill(); process.exit(1); });
