/* 临时脚本：启动绿色版 exe，打开设置抽屉并滚动到「关于」，截图验证著作权人链接 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EXE = path.join(__dirname, '..', 'build-out', '暮呈照片水印工作台', '暮呈照片水印工作台.exe');
const DIR = path.dirname(EXE);
const PORT = 9491;
const OUT = path.join(__dirname, 'ui-shots', 'v11-about-link.png');

const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

(async () => {
  const p = spawn(EXE, [], {
    cwd: DIR,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore'
  });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { targets = await getJSON(`http://127.0.0.1:${PORT}/json/list`); if (targets && targets.length) break; } catch (_) {}
  }
  if (!targets) { console.log('无法连接调试端口'); p.kill(); process.exit(1); }

  const t = targets.find(x => x.type === 'page') || targets[0];
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (mm, pp = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: pp })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;

  await send('Runtime.enable'); await send('Page.enable');
  await new Promise(r => setTimeout(r, 2500));

  const text = await ev(`(() => {
    document.getElementById('settingsDrawer').classList.add('show');
    document.getElementById('settingsBackdrop').classList.add('show');
    const h = [...document.querySelectorAll('.set-section h4')].find(x => x.textContent.trim() === '关于');
    if (h) h.closest('.set-section').scrollIntoView({ block: 'center' });
    const dt = [...document.querySelectorAll('.about-list dt')].find(x => x.textContent.trim() === '著作权人');
    return dt ? dt.nextElementSibling.textContent.trim() : '(未找到)';
  })()`);
  console.log('界面显示的著作权人：', text);

  await new Promise(r => setTimeout(r, 600));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('截图已保存：', OUT);

  ws.close();
  p.kill();
  await new Promise(r => setTimeout(r, 800));
  process.exit(0);
})();
