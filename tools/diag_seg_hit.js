/* 临时诊断：主题分段按钮命中测试 */
const { spawn } = require('child_process');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const p = spawn(path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'exif-cam.exe'), [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9463' },
    stdio: 'ignore'
  });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:9463/json/list'); targets = await r.json(); if (targets.length) break; } catch (_) {}
    await sleep(500);
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); pend.set(i, res); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await sleep(1000);

  const expr = `
    (async () => {
      document.getElementById('btnSettings').click();
      await new Promise(r => setTimeout(r, 400));
      const b = document.querySelector('#themeSeg button[data-theme-mode=light]');
      const rect = b.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const chain = [];
      let n = hit;
      while (n && chain.length < 6) {
        chain.push(n.tagName + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.split(' ').join('.') : ''));
        n = n.parentElement;
      }
      return JSON.stringify({
        pt: { x: Math.round(cx), y: Math.round(cy) },
        hitIsBtn: hit === b,
        hitTag: hit && hit.tagName,
        chain,
        drawerShow: document.getElementById('settingsDrawer').classList.contains('show')
      });
    })()`;
  console.log(await ev(expr));
  spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  process.exit(0);
})();
