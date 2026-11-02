/* 临时诊断：真实鼠标事件走一遍主题分段按钮 */
const { spawn } = require('child_process');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const p = spawn(path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'exif-cam.exe'), [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9464' },
    stdio: 'ignore'
  });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:9464/json/list'); targets = await r.json(); if (targets.length) break; } catch (_) {}
    await sleep(500);
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const events = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); pend.set(i, res); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Runtime.enable');
  await sleep(1000);

  // 打开抽屉
  await ev(`document.getElementById('btnSettings').click()`);
  await sleep(400);

  async function realClick(selector) {
    const r = JSON.parse(await ev(`(()=>{const b=document.querySelector('${selector}');const t=b.getBoundingClientRect();return JSON.stringify({x:t.left+t.width/2,y:t.top+t.height/2})})()`));
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    }
    await sleep(150);
  }

  console.log('初始主题:', await ev(`document.documentElement.dataset.theme`));
  await realClick('#themeSeg button[data-theme-mode=dark]');
  console.log('真点击深色 →', await ev(`document.documentElement.dataset.theme`), '高亮:', await ev(`document.querySelector('#themeSeg button.on').textContent`));
  await realClick('#themeSeg button[data-theme-mode=light]');
  console.log('真点击浅色 →', await ev(`document.documentElement.dataset.theme`));
  await realClick('#themeSeg button[data-theme-mode=system]');
  console.log('真点击跟随系统 →', await ev(`document.documentElement.dataset.theme`), '（跟随系统时随 matchMedia）');
  console.log('异常:', JSON.stringify(events.filter(e => e.method === 'Runtime.exceptionThrown').length));

  spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  process.exit(0);
})();
