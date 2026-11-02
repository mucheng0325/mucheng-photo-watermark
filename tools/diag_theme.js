const { spawn } = require('child_process');
const path = require('path'), os = require('os');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9431;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1480,940',
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-th-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 40; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {} await sleep(400); }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (mm, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///D:/WorkBuddy/2026-11-01-14-17-43/exif-cam-watermark/index.html' });
  await sleep(2500);
  await ev(`localStorage.clear(); location.reload()`);
  await sleep(2600);
  const probe = `(()=>{const g=id=>{const n=document.getElementById(id);if(!n)return 'null';const c=getComputedStyle(n);return {h:n.hidden,d:c.display,w:+n.getBoundingClientRect().width.toFixed(1)};};
   return JSON.stringify({theme:document.documentElement.dataset.theme, seg:[...document.querySelectorAll('#themeSeg button')].map(b=>b.dataset.themeMode+':'+b.className.replace('on','ON')), sys:g('thSys'),light:g('thLight'),dark:g('thDark'), title:document.getElementById('btnTheme').title});})()`;
  console.log('初始  ', await ev(probe));
  for (let k = 1; k <= 4; k++) {
    const pos = JSON.parse(await ev(`(()=>{const b=document.getElementById('btnTheme');const r=b.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()`));
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await sleep(350);
    console.log('点击' + k + '  ', await ev(probe));
  }
  spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
})();
