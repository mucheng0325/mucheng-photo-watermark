/* 通用 HTML → PNG 截图：无头 Chrome + CDP，按内容实际高度整页截
 * 用法：node tools/proto/shot.js <html> <out.png> [viewportW] [@2x 传 2]
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
if (!CHROME) { console.error('找不到 Chrome / Edge'); process.exit(1); }

const [html, out, vwArg, scArg, selArg] = process.argv.slice(2);
if (!html || !out) { console.error('用法: node shot.js <html> <out.png> [viewportW] [scale] [裁剪选择器]'); process.exit(1); }

const VW = +(vwArg || 1900), SCALE = +(scArg || 1), PORT = 9455 + Math.floor(Math.random() * 60);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none',
    `--window-size=${VW},1400`, `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-shot-' + Date.now()), 'about:blank'];
  if (SCALE > 1) args.unshift(`--force-device-scale-factor=${SCALE}`);
  const proc = spawn(CHROME, args, { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {}
    await sleep(300);
  }
  if (!list) { console.error('浏览器未就绪'); proc.kill(); process.exit(1); }

  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (mm, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });

  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + path.resolve(html).replace(/\\/g, '/') });

  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    if ((r.result?.result?.value || '').includes('READY')) { ready = true; break; }
    await sleep(200);
  }
  if (!ready) console.error('警告：未等到 READY，仍尝试截图');
  await sleep(400);

  // 不走 getLayoutMetrics：强制 DSF 后它返回的尺寸单位会变成设备像素，直接用页面自报的 CSS 尺寸
  const szr = await send('Runtime.evaluate', {
    expression: `JSON.stringify({w:Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),h:Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)})`,
    returnByValue: true
  });
  const cs = JSON.parse(szr.result?.result?.value || '{"w":1200,"h":800}');
  let clip = { x: 0, y: 0, width: Math.ceil(cs.w), height: Math.ceil(cs.h), scale: 1 };
  if (selArg) {
    const r = await send('Runtime.evaluate', {
      expression: `(()=>{const n=document.querySelector(${JSON.stringify(selArg)});if(!n)return 'null';const b=n.getBoundingClientRect();return JSON.stringify({t:b.top+scrollY,h:b.height});})()`,
      returnByValue: true
    });
    const b = JSON.parse(r.result?.result?.value || 'null');
    if (b) clip = { x: 0, y: Math.max(0, b.t - 22), width: Math.ceil(cs.w), height: Math.ceil(b.h + 34), scale: 1 };
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(`已保存 ${out}  (${clip.width}×${clip.height} css @${SCALE}x)`);
  proc.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
