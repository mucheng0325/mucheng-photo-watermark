/* UI 截图（无头 Chrome + 真实本机字体数据注入），验证字体浮层与各面板布局 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
const PORT = 9397;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const { listFonts } = require('../electron/fonts.js');

(async () => {
  const fonts = listFonts();
  const payload = JSON.stringify({
    ok: fonts.ok, count: fonts.count, scanned: fonts.scanned,
    stats: fonts.stats,
    fonts: fonts.fonts.map(f => ({ name: f.name, script: f.script, aliases: (f.aliases || []).slice(0, 2) }))
  });

  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1500,950', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-ui-v3'), 'about:blank'], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {}
    await sleep(400);
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (mm, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  // 注入桌面 API 桩：返回真实本机字体列表
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.desktopApi = { platform:'win32', chooseDir: async()=>'', saveFile: async()=>({ok:true}), listFonts: async()=>(${payload}) };`
  });
  await send('Page.navigate', { url: `file:///${ROOT}/index.html?demo=1` });
  await sleep(4200);

  const outDir = `${ROOT}/tools/ui-shots`;
  fs.mkdirSync(outDir, { recursive: true });

  // 1. 文字面板 + 字体浮层
  await ev(`document.querySelector('.tab[data-tab="text"]').click(); 1`);
  await sleep(350);
  await ev(`document.getElementById('fpTrigger').click(); 1`);
  await sleep(600);
  let r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'v3-font-pop.png'), Buffer.from(r.result.data, 'base64'));

  // 2. 搜索过滤
  await ev(`(()=>{const s=document.getElementById('fontSearch');s.value='黑';s.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await sleep(400);
  r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'v3-font-search.png'), Buffer.from(r.result.data, 'base64'));

  // 3. 关掉浮层，看文字面板全貌
  await ev(`document.getElementById('fontSearch').value='';document.getElementById('fontSearch').dispatchEvent(new Event('input',{bubbles:true}));closeFontPop();1`);
  await sleep(300);
  r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'v3-text-tab.png'), Buffer.from(r.result.data, 'base64'));

  // 4. 参数面板（自绘下拉）
  await ev(`document.querySelector('.tab[data-tab="params"]').click(); 1`);
  await sleep(300);
  await ev(`document.querySelectorAll('.fp-trigger.sm')[0].click(); 1`);
  await sleep(400);
  r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'v3-pick-pop.png'), Buffer.from(r.result.data, 'base64'));

  // 5. 版式面板（水印大小滑块）
  await ev(`closePickPop();document.querySelector('.tab[data-tab="layout"]').click(); 1`);
  await sleep(400);
  r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'v3-layout-tab.png'), Buffer.from(r.result.data, 'base64'));

  console.log('字体数:', fonts.count, '异常:', errs.length ? errs.join(' | ') : '(无)');
  proc.kill();
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
