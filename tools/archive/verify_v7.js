/* v7 验收：改名（暮呈照片水印工作台 / 顶栏去掉暮呈）+ 品牌下拉选择后真正消失 + Logo 白边消失 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const NAME = '暮呈照片水印工作台';

let pass = 0, fail = 0;
const ck = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`✗ FAIL  ${name}`); } };

(async () => {
  const p = spawn(path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'exif-cam.exe'), [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9481' },
    stdio: 'ignore'
  });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:9481/json/list'); targets = await r.json(); if (targets.length) break; } catch (_) {}
    await sleep(500);
  }
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
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(1200);

  const realClick = async sel => {
    await ev(`(()=>{const b=document.querySelector('${sel}');if(b)b.scrollIntoView({block:'center'})})()`);
    await sleep(150);
    const r = JSON.parse(await ev(`(()=>{const b=document.querySelector('${sel}');if(!b)return 'null';const t=b.getBoundingClientRect();return JSON.stringify({x:t.left+t.width/2,y:t.top+t.height/2})})()`));
    if (r === 'null') return false;
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    }
    await sleep(260);
    return true;
  };

  await ev(`localStorage.clear()`);
  await ev(`location.href = 'http://tauri.localhost/?demo=1'`);
  await sleep(2700);

  /* 1. 命名 */
  ck(`窗口标题 = ${NAME}`, await ev(`document.title`) === NAME);
  ck('顶栏只剩一行「照片水印工作台」', await ev(`document.querySelector('.logo-text').textContent.trim()`) === '照片水印工作台');
  ck('顶栏不再有单独的「暮呈」', await ev(`!document.querySelector('.logo-text b')`));

  await realClick('#btnSettings');
  await sleep(450);
  const about = JSON.parse(await ev(`(()=>JSON.stringify([...document.querySelectorAll('.about-list > div')].map(d=>({k:d.querySelector('dt').textContent.trim(),v:d.querySelector('dd').textContent.trim()}))))()`));
  const get = k => (about.find(r => r.k === k) || {}).v;
  ck(`关于·产品名 = ${get('产品名')}`, get('产品名') === NAME);
  ck('关于·著作权人仍是仓库地址', get('著作权人') === 'https://github.com/mucheng0325/-.git');
  await realClick('#btnCloseSettings');
  await sleep(400);

  /* 2. 品牌下拉：选择后必须真的从屏幕上消失 */
  await realClick('.tab[data-tab="brand"]');
  const disp = async () => await ev(`getComputedStyle(document.getElementById('brandPop')).display`);
  const box = async () => await ev(`document.getElementById('brandPop').offsetHeight`);
  ck(`初始 display = ${await disp()}`, await disp() === 'none');
  await realClick('#brandCard');
  const openDisp = await disp();
  ck(`展开后 display = ${openDisp}、高度 ${await box()}px`, openDisp !== 'none' && (await box()) > 0);
  await realClick('#brandPop .bp-item[data-key="sony"]');
  const closeDisp = await disp();
  const closeH = await box();
  ck(`选完品牌 → display = ${closeDisp}、高度 ${closeH}px`, closeDisp === 'none' && closeH === 0);
  ck('品牌已切换为 SONY', await ev(`document.getElementById('brandName').textContent`) === 'SONY');

  /* 3. Logo 白边检测：绿底上画 Canon 原色标，统计「白边」像素 */
  const halo = await ev(`(()=>{
    const c = document.createElement('canvas'); c.width = 700; c.height = 240;
    const x = c.getContext('2d');
    x.fillStyle = '#6a8f4a'; x.fillRect(0, 0, 700, 240);          // 中等亮度绿底
    const brand = Brands.detect('Canon', 'Canon EOS R6');
    Brands.draw(x, 30, 60, 120, brand, Object.assign({}, cfg, { logoMode:'official', logoVariant:'brand' }), null, 0, 0.45);
    const d = x.getImageData(0, 0, 700, 240).data;
    let red = 0, haloPx = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      if (r > 150 && g < 90 && b < 90) red++;                       // 佳能红字
      // 白/灰毛边：蓝通道明显高于绿底(74)且整体偏亮 —— 深色描边不会有这种值
      if (b > 95 && g > 110 && r > 130) haloPx++;
      if (r > 225 && g > 225 && b > 225) light++;
    }
    return JSON.stringify({ red, haloPx, light });
  })()`);
  const H = JSON.parse(halo);
  console.log(`  · 采样：红字 ${H.red}px / 疑似白边 ${H.haloPx}px / 纯白 ${H.light}px`);
  ck('Canon 红字已绘制', H.red > 1500);
  ck('标识周围无白/灰毛边', H.haloPx < 150);
  ck('无纯白镶边像素', H.light < 60);

  /* 4. 截图：水印区放大 3× + 关于段 */
  await ev(`location.href = 'http://tauri.localhost/?demo=1'`);
  await sleep(2700);
  const crop = JSON.parse(await ev(`(()=>{const c=document.getElementById('preview');const r=c.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top+r.height*0.78),w:Math.round(r.width),h:Math.round(r.height*0.22)})})()`));
  let shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: crop.x, y: crop.y, width: crop.w, height: crop.h, scale: 3 } });
  fs.writeFileSync(path.join(__dirname, 'ui-shots', 'v7-logo-zoom.png'), Buffer.from(shot.result.data, 'base64'));

  await realClick('#btnSettings');
  await sleep(450);
  await ev(`document.querySelector('.about-list').scrollIntoView({block:'center'})`);
  await sleep(350);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, 'ui-shots', 'v7-about.png'), Buffer.from(shot.result.data, 'base64'));

  /* 5. 顶栏截图 */
  await realClick('#btnCloseSettings');
  await sleep(400);
  shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 460, height: 56, scale: 3 } });
  fs.writeFileSync(path.join(__dirname, 'ui-shots', 'v7-topbar.png'), Buffer.from(shot.result.data, 'base64'));

  const errs = events.filter(e => e.method === 'Runtime.exceptionThrown').length;
  ck(`0 运行时异常（${errs}）`, errs === 0);

  spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
