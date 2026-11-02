/* 打包版（release/win-unpacked）瘦身验收：
 * 启动真实 EXIF CAM.exe → CDP 验证子集字体渲染、内置字体加载、水印中文、0 异常 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const EXE = path.join(ROOT, 'release', 'win-unpacked', 'EXIF CAM.exe');
const PORT = 9442;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const proc = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
    cwd: path.dirname(EXE), stdio: 'ignore'
  });
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {}
    await sleep(400);
  }
  if (!list) { console.error('FAIL 打包版未启动'); proc.kill(); process.exit(1); }
  const page = list.find(t => t.type === 'page' && /index\.html/.test(t.url)) || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  await sleep(4500);

  const checks = [];
  const ck = (n, c) => checks.push(`${c ? 'PASS' : 'FAIL'}  ${n}`);

  ck('桌面 API 可用', await ev(`!!(window.desktopApi && window.desktopApi.listFonts)`));
  ck('本机字体库已载入', await ev(`LOCAL_FONTS.length`) > 0);
  ck('内置子集字体已注册', await ev(`document.fonts.check('600 32px PuHuiTi')`));
  ck('内置子集字体 400 已注册', await ev(`document.fonts.check('400 32px PuHuiTi')`));
  ck('子集字体真实渲染（汉字+ASCII）', await ev(`(async()=>{
    await document.fonts.load('600 32px PuHuiTi'); await document.fonts.load('400 32px PuHuiTi');
    const c=document.createElement('canvas').getContext('2d');
    c.font='600 32px PuHuiTi';
    const zh=c.measureText('珠海领行科技·摄于').width, num=c.measureText('f/1.8 ISO400').width;
    return (zh>32 && num>32) ? 'ok' : 'zh='+zh+' num='+num; })()`) === 'ok');
  ck('演示照片已载入', await ev(`state.files.length`) >= 0);
  ck('预览区空态显示', await ev(`document.getElementById('hint').style.display !== 'none'`));
  // 主题往返 + 无异常
  await ev(`applyTheme('dark');1`); await sleep(350);
  await ev(`applyTheme('light');1`); await sleep(350);
  ck('主题往返正常', await ev(`document.documentElement.dataset.theme`) === 'light');
  ck('渲染异常 0', errs.length === 0);

  // 截一张浅色预览图供人工复核中文水印
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.join(ROOT, 'tools', 'ui-shots'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tools', 'ui-shots', 'v4-slim-pkg.png'), Buffer.from(r.result.data, 'base64'));

  console.log(checks.join('\n'));
  if (errs.length) console.log('异常明细:\n' + errs.join('\n---\n'));
  proc.kill();
  process.exit(checks.some(c => c.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
