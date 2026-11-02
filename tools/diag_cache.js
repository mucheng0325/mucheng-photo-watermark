/* 诊断：区分「exe 里嵌的是旧前端」还是「WebView2 缓存旧资源」 */
const { spawn } = require('child_process');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const p = spawn(path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'exif-cam.exe'), [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9475' },
    stdio: 'ignore'
  });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:9475/json/list'); targets = await r.json(); if (targets.length) break; } catch (_) {}
    await sleep(500);
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); pend.set(i, res); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await sleep(1200);

  console.log('初始 title     :', await ev('document.title'));
  console.log('初始 logo b    :', await ev("document.querySelector('.logo-text b').textContent.trim()"));
  console.log('app.js 版本标记:', await ev("(document.querySelector('script[src*=\"app.js\"]')||{}).src"));

  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await ev(`location.reload(true)`);
  await sleep(2500);
  console.log('--- 禁缓存 reload 后 ---');
  console.log('title          :', await ev('document.title'));
  console.log('logo b         :', await ev("document.querySelector('.logo-text b').textContent.trim()"));

  // 直接抓取协议下的 index.html 源码，看服务端给的是哪一版
  const html = await ev(`fetch('http://tauri.localhost/index.html?cb=' + Date.now(), {cache:'no-store'}).then(r=>r.text()).then(t=>t.slice(0,200))`);
  console.log('协议取回 HTML   :', (html || '').replace(/\s+/g, ' ').slice(0, 160));

  spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  process.exit(0);
})().catch(e => { console.error('异常', e.message); process.exit(1); });
