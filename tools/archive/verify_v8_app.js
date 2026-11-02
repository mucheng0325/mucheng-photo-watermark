/* v8 真机验收：跑打包好的 exe（Tauri + WebView2），确认内嵌前端是新的
 * 检查：Logo 资源、默认 1.50×、悬浮卡片无角标、白框版式可用、无运行时异常
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`✗ FAIL  ${name}`); } };

(async () => {
  const exe = path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'exif-cam.exe');
  const p = spawn(exe, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9482' },
    stdio: 'ignore'
  });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:9482/json/list'); targets = await r.json(); if (targets.length) break; } catch (_) {}
    await sleep(500);
  }
  if (!targets || !targets.length) { console.error('未能连上 WebView2 调试端口'); process.exit(1); }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const events = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); pend.set(i, res); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Runtime.enable'); await send('Page.enable');
  await sleep(800);

  await ev(`localStorage.clear()`);
  await ev(`location.href = 'http://tauri.localhost/?demo=1'`);
  await sleep(3200);

  const state = JSON.parse(await ev(`(()=>{
    const l=document.querySelector('.logo-def.only-light'), d=document.querySelector('.logo-def.only-dark');
    const c=document.getElementById('preview');
    return JSON.stringify({
      theme:document.documentElement.dataset.theme,
      logoLight:l?l.naturalWidth:0, logoDark:d?d.naturalWidth:0,
      lightDisp:l?getComputedStyle(l).display:'-',
      fontScale:cfg.fontScale, layoutCount:document.querySelectorAll('.layout-btn').length,
      hasTicks:'cornerTicks' in cfg, cw:c.width, ch:c.height,
      vFont:document.getElementById('vFont').textContent,
      tauri:!!window.__TAURI__, platform:document.getElementById('chipPlat').textContent
    });})()`));
  console.log('  ·', JSON.stringify(state));

  ck('运行在 Tauri 桌面模式', state.tauri === true);
  ck('浅色 Logo 已加载', state.logoLight > 100);
  ck('深色 Logo 已加载', state.logoDark > 100);
  ck(`当前主题 ${state.theme} 下默认图可见`, state.lightDisp !== 'none');
  ck(`默认水印 ${state.fontScale}×`, state.fontScale === 1.5 && state.vFont === '1.50×');
  ck('版式按钮 5 个（含白色边框）', state.layoutCount === 5);
  ck('配置里已无 cornerTicks', state.hasTicks === false);

  // 切白框：画布应变大 + 四角纯白
  await ev(`(()=>{document.querySelector('.layout-btn[data-layout="frame"]').click();return 1})()`);
  await sleep(700);
  const fr = JSON.parse(await ev(`(()=>{const c=document.getElementById('preview');const x=c.getContext('2d');
    const d=x.getImageData(0,0,c.width,c.height).data;
    const px=(a,b)=>{const i=(b*c.width+a)*4;return [d[i],d[i+1],d[i+2]];};
    const w=p=>p[0]>248&&p[1]>248&&p[2]>248;
    return JSON.stringify({w:c.width,h:c.height,corners:[px(2,2),px(c.width-3,2),px(2,c.height-3),px(c.width-3,c.height-3)].every(w),
      label:document.getElementById('vFrame').textContent});})()`));
  console.log('  ·', JSON.stringify(fr));
  ck(`白框画布 ${fr.w}×${fr.h}`, fr.w > 0 && fr.h > 0);
  ck('白框四角纯白', fr.corners === true);
  ck(`白边标签 ${fr.label}`, /%$/.test(fr.label));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, 'ui-shots', 'v8-app-frame.png'), Buffer.from(shot.result.data, 'base64'));

  await ev(`(()=>{document.querySelector('.layout-btn[data-layout="card"]').click();
    cfg.position='bottom-left';syncUI();scheduleRender(0);return 1})()`);
  await sleep(700);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, 'ui-shots', 'v8-app-card.png'), Buffer.from(shot2.result.data, 'base64'));

  const errs = events.filter(e => e.method === 'Runtime.exceptionThrown').length;
  ck(`0 运行时异常（${errs}）`, errs === 0);

  spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
