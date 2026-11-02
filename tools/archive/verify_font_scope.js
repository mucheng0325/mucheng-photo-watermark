/* 字体范围（中文 / 全部）验证 + 截图 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
const PORT = 9401;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { listFonts } = require('../electron/fonts.js');

(async () => {
  const fonts = listFonts();
  const payload = JSON.stringify({
    ok: fonts.ok, count: fonts.count, scanned: fonts.scanned, stats: fonts.stats,
    fonts: fonts.fonts.map(f => ({ name: f.name, script: f.script, aliases: (f.aliases || []).slice(0, 2) }))
  });

  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1500,950', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-fs'), 'about:blank'], { stdio: 'ignore' });

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
  const shot = async name => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, name), Buffer.from(s.result.data, 'base64'));
  };

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.desktopApi = { platform:'win32', chooseDir: async()=>'', saveFile: async()=>({ok:true}), listFonts: async()=>(${payload}) };`
  });
  await send('Page.navigate', { url: `file:///${ROOT}/index.html?demo=1` });
  await sleep(4200);

  // 打开文字面板 → 字体浮层
  await ev(`(async()=>{ document.querySelector('.tab[data-tab="text"]').click(); await new Promise(r=>setTimeout(r,300)); document.getElementById('fpTrigger').click(); await new Promise(r=>setTimeout(r,500)); return 1; })()`);

  const zhState = await ev(`(()=>{
    const items=[...document.querySelectorAll('#fpList .fp-item')];
    const groups=[...document.querySelectorAll('#fpList .fp-group')].map(n=>n.textContent);
    return JSON.stringify({ scope: FONT_SCOPE, scopeZh: document.getElementById('fpScopeZh').textContent,
      scopeAll: document.getElementById('fpScopeAll').textContent,
      on: [...document.querySelectorAll('#fpScope .fp-scope-btn')].map(b=>b.textContent+(b.classList.contains('on')?'*':'')),
      groups, n: items.length, first10: items.slice(0,10).map(n=>n.querySelector('.fp-n').textContent),
      hasLatinInList: items.some(n=>/^[\\x20-\\x7e]+$/.test(n.querySelector('.fp-n').textContent)),
      foot: document.getElementById('fpFoot').textContent });
  })()`);
  console.log('中文范围:', zhState);
  await shot('tools/fs-zh.png');

  // 切到全部
  const allState = await ev(`(async()=>{
    document.querySelector('#fpScope .fp-scope-btn[data-scope="all"]').click();
    await new Promise(r=>setTimeout(r,400));
    const items=[...document.querySelectorAll('#fpList .fp-item')];
    return JSON.stringify({ scope: FONT_SCOPE, groups:[...document.querySelectorAll('#fpList .fp-group')].map(n=>n.textContent),
      n: items.length, hasLatin: items.some(n=>/^[\\x20-\\x7e]+$/.test(n.querySelector('.fp-n').textContent)),
      foot: document.getElementById('fpFoot').textContent,
      stored: localStorage.getItem('ecw.fontScope') });
  })()`);
  console.log('全部范围:', allState);
  await shot('tools/fs-all.png');

  // 搜索应无视范围
  const searchState = await ev(`(async()=>{
    document.querySelector('#fpScope .fp-scope-btn[data-scope="zh"]').click();
    await new Promise(r=>setTimeout(r,300));
    const s=document.getElementById('fontSearch'); s.value='arial';
    s.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    const items=[...document.querySelectorAll('#fpList .fp-item')];
    return JSON.stringify({ n: items.length, names: items.slice(0,6).map(n=>n.querySelector('.fp-n').textContent), foot: document.getElementById('fpFoot').textContent });
  })()`);
  console.log('搜索跨库:', searchState);

  console.log('运行期异常:', errs.length ? errs.join(' | ') : '(无)');
  proc.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
