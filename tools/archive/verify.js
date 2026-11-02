/* 开发自检脚本：无头 Chrome + CDP
 * 用法：node tools/verify.js
 * 产出：tools/layout-*.png 截图 + 控制台导出管线自检结果
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
const PORT = 9335;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1600,1000', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-ecw'), 'about:blank'], { stdio: 'ignore' });

(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {}
    await sleep(400);
  }
  if (!list) { console.error('调试端口连接失败'); proc.kill(); process.exit(1); }
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `file:///${ROOT}/index.html?demo=1` });
  await sleep(3000);

  for (const layout of ['card', 'banner', 'side', 'minimal']) {
    await send('Runtime.evaluate', { expression: `cfg.layout='${layout}'; syncUI(); scheduleRender();` });
    await sleep(700);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${ROOT}/tools/layout-${layout}.png`, Buffer.from(shot.result.data, 'base64'));
  }

  const expr = `(async () => {
    try {
      const f = state.files[0];
      // 用内嵌演示图构造原始 buffer，模拟真实导入路径
      const b64 = window.DEMO_IMAGE.split(',')[1];
      const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      f.buffer = raw.buffer;
      const { W, H } = orientedSize(f);
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      Render.drawImageOriented(ctx, f.img, f.info.orientation, W, H);
      Render.draw(ctx, W, H, cfg, buildInfo(f), { brand: f.brand, logo: logoImg(f.brand) });
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
      const out = await injectExif(blob, f.buffer);
      const buf = new Uint8Array(await out.arrayBuffer());
      const magic = String.fromCharCode(...buf.slice(6, 10));
      const exifTag = (() => {
        // 检查回填段内是否含 Make 标签 ASCII "Canon"
        const s = Array.from(buf.slice(0, 1200)).map(c => String.fromCharCode(c)).join('');
        return s.includes('Canon');
      })();
      return JSON.stringify({ ok: true, W, H, canvasBytes: blob.size, outBytes: out.size, magic, hasMake: exifTag });
    } catch (e) {
      return JSON.stringify({ ok: false, error: e && (e.stack || e.message) });
    }
  })()`;
  const test = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  console.log('EXPORT:', test.result?.result?.value ?? JSON.stringify(test.result));
  console.log('LOGS:', logs.length ? logs.join('\n') : '(无异常)');
  proc.kill();
  process.exit(0);
})();
