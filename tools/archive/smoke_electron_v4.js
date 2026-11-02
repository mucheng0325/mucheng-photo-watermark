/* Electron 真机冒烟：启动应用 → CDP 检查渲染异常 / IPC 通道可用 / 主题同步窗口背景 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9431;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const proc = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
    stdio: 'ignore'
  });
  // 等 CDP 就绪
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {}
    await sleep(400);
  }
  if (!list) { console.error('CDP 未就绪'); proc.kill(); process.exit(1); }
  const page = list.find(t => t.type === 'page' && /index\.html/.test(t.url)) || list.find(t => t.type === 'page');
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
  await send('Runtime.enable');
  await sleep(3500);   // 等 boot 完成（字体库扫描等）

  const checks = [];
  const ck = (n, c) => checks.push(`${c ? 'PASS' : 'FAIL'}  ${n}`);

  ck('桌面 API 可用', await ev(`!!(window.desktopApi && window.desktopApi.listFonts && window.desktopApi.setBgColor && window.desktopApi.openOutDir)`));
  ck('本机字体已载入', await ev(`LOCAL_FONTS.length`) > 0);
  ck('主题初始化无异常', await ev(`['system','light','dark'].includes(themeMode)`));
  // 主题切换 → IPC set-bg-color 不抛错
  ck('setBgColor IPC 正常', await ev(`(async()=>{try{await desktopApi.setBgColor('#101114');return 'ok'}catch(e){return 'err:'+e}})()`) === 'ok');
  ck('openOutDir IPC 正常(未选目录返回错误而非抛异常)', await ev(`(async()=>{try{const r=await desktopApi.openOutDir();return r&&r.ok===false?'ok':'unexpected'}catch(e){return 'err:'+e}})()`) === 'ok');
  // 切深色再切浅，无异常
  await ev(`applyTheme('dark');1`); await sleep(400);
  await ev(`applyTheme('light');1`); await sleep(400);
  ck('主题往返切换正常', await ev(`document.documentElement.dataset.theme`) === 'light');
  ck('渲染异常 0', errs.length === 0);

  console.log(checks.join('\n'));
  if (errs.length) console.log('异常明细:\n' + errs.join('\n---\n'));
  proc.kill();
  process.exit(checks.some(c => c.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
