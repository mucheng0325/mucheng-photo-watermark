/* UI v4 验收：深浅双主题 + 设置抽屉 + 主题色派生 + 异常捕获 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
const PORT = 9414;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { listFonts } = require('../electron/fonts.js');

(async () => {
  const fonts = listFonts();
  const payload = JSON.stringify({
    ok: fonts.ok, count: fonts.count, scanned: fonts.scanned, stats: fonts.stats,
    fonts: fonts.fonts.map(f => ({ name: f.name, script: f.script, aliases: (f.aliases || []).slice(0, 2) }))
  });

  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1480,940', `--remote-debugging-port=${PORT}`,
    // 每次全新 profile：避免历史 localStorage 里的主题设置串场
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-ui-v4-' + Date.now()), 'about:blank'], { stdio: 'ignore' });

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
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + (m.params.args?.map(a => a.value || a.description || '').join(' ') || ''));
  };
  const send = (mm, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, 'base64'));
  };

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 940, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.desktopApi = { platform:'win32', chooseDir: async()=>'', saveFile: async()=>({ok:true}),
      listFonts: async()=>(${payload}), setBgColor: async()=>({ok:true}), openOutDir: async()=>({ok:true}) };`
  });
  await send('Page.navigate', { url: `file:///${ROOT}/index.html?demo=1` });
  await sleep(4200);

  const outDir = `${ROOT}/tools/ui-shots`;
  fs.mkdirSync(outDir, { recursive: true });
  const checks = [];
  const ck = (name, cond) => checks.push(`${cond ? 'PASS' : 'FAIL'}  ${name}`);

  // ---- 浅色主题（默认跟随系统→headless 为浅色）----
  ck('初始解析为浅色', await ev(`document.documentElement.dataset.theme`) === 'light');
  ck('ui-primary 已派生', await ev(`getComputedStyle(document.documentElement).getPropertyValue('--ui-primary').trim()`) !== '');
  ck('画布底 #EDEFF2(浅)', (await ev(`getComputedStyle(document.getElementById('canvasWrap')).backgroundColor`)).includes('237'));
  await sleep(500);
  await shot('v4-light-main.png');

  // ---- 切到深色 ----
  await ev(`applyTheme('dark'); 1`);
  await sleep(500);
  ck('data-theme=dark', await ev(`document.documentElement.dataset.theme`) === 'dark');
  ck('深色月亮图标显示', await ev(`!document.getElementById('thDark').hidden`));
  ck('画布底 #0A0B0D(深)', (await ev(`getComputedStyle(document.getElementById('canvasWrap')).backgroundColor`)).includes('10'));
  ck('深色主题色已提亮', await ev(`getComputedStyle(document.documentElement).getPropertyValue('--ui-primary').trim().toUpperCase()`) !== '#4F6BED');
  await shot('v4-dark-main.png');

  // ---- 主题色切换（琥珀）----
  await ev(`applyPrimary('#D99A2B'); 1`);
  await sleep(300);
  const amber = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--ui-primary').trim()`);
  ck('琥珀主题色生效（实际 ' + amber + '）', amber.toUpperCase() === '#DFAA4E');
  ck('选中 swatch 有对勾类', await ev(`document.querySelectorAll('#uiSwatches .sw.active').length`) === 1);
  await shot('v4-dark-amber.png');

  // ---- 设置抽屉 ----
  await ev(`document.getElementById('btnSettings').click(); 1`);
  await sleep(500);
  ck('抽屉已展开', await ev(`document.getElementById('settingsDrawer').classList.contains('show')`));
  await shot('v4-dark-settings.png');
  await ev(`document.getElementById('btnCloseSettings').click(); 1`);
  await sleep(400);
  ck('抽屉已收起', await ev(`!document.getElementById('settingsDrawer').classList.contains('show')`));

  // ---- 浅色 + 设置抽屉 + 版式页签三屏 ----
  await ev(`applyTheme('light'); 1`);
  await sleep(400);
  await ev(`document.getElementById('btnSettings').click(); 1`);
  await sleep(450);
  await shot('v4-light-settings.png');
  await ev(`document.getElementById('btnCloseSettings').click();1`);
  await ev(`document.querySelector('.tab[data-tab="layout"]').click(); 1`);
  await sleep(350);
  await shot('v4-light-layout.png');
  await ev(`applyTheme('dark');document.querySelector('.tab[data-tab="layout"]').click();1`);
  await sleep(400);
  await shot('v4-dark-layout.png');

  // ---- 水印色与界面色独立性 ----
  ck('水印 accent 变量未被主题色污染', (await ev(`cfg.accent`)) === '#35E0F0');

  // ---- 精确输入 ----
  const editOk = await ev(`(async()=>{const b=document.getElementById('vFont');b.click();
    const i=document.querySelector('.val-input'); if(!i)return 'no-input';
    i.value='1.8'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await new Promise(r=>setTimeout(r,80));
    return Math.abs(cfg.fontScale-1.8)<1e-6 && document.getElementById('vFont').textContent.includes('1.80')?'ok':'bad';})()`);
  ck('滑杆数值键入 1.8 生效', editOk === 'ok');

  // ---- 导出进度模态元素存在 ----
  ck('导出模态元素齐备', await ev(`!!(document.getElementById('exBar')&&document.getElementById('exEta')&&document.getElementById('btnCancelExport')&&document.getElementById('btnOpenOutDir'))`));

  // ---- 拖放态 ----
  await ev(`document.getElementById('colList').classList.add('over');1`);
  await sleep(250);
  ck('拖放落点提示可见', (await ev(`getComputedStyle(document.querySelector('.dz-overlay')).display`)) !== 'none');
  await ev(`document.getElementById('colList').classList.remove('over');1`);

  console.log(checks.join('\n'));
  console.log('异常:', errs.length ? '\n' + errs.join('\n---\n') : '(无)');
  proc.kill();
  process.exit(checks.some(c => c.startsWith('FAIL')) || errs.length ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
