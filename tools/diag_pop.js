/* 诊断：哪些弹出层在选择后不自动关闭（真实鼠标事件 + 展开态/关闭态检查） */
const { spawn } = require('child_process');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const p = spawn(path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'exif-cam.exe'), [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9477' },
    stdio: 'ignore'
  });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:9477/json/list'); targets = await r.json(); if (targets.length) break; } catch (_) {}
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
  await sleep(1200);

  const clickSel = async sel => {
    await ev(`(()=>{const b=document.querySelector('${sel}');if(b)b.scrollIntoView({block:'center'})})()`);
    await sleep(180);
    const r = JSON.parse(await ev(`(()=>{const b=document.querySelector('${sel}');if(!b)return 'null';const t=b.getBoundingClientRect();return JSON.stringify({x:t.left+t.width/2,y:t.top+t.height/2,w:t.width,h:t.height})})()`));
    if (r === 'null') { console.log('  找不到', sel); return; }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    }
    await sleep(260);
  };

  await ev(`location.href = 'http://tauri.localhost/?demo=1'`);
  await sleep(2600);
  await clickSel('.tab[data-tab="brand"]');

  console.log('--- A. 品牌卡下拉 ---');
  await clickSel('#brandCard');
  console.log('打开后 hidden =', await ev(`document.getElementById('brandPop').hidden`), ' 项数 =', await ev(`document.querySelectorAll('#brandPop .bp-item').length`));
  await clickSel('#brandPop .bp-item[data-key="nikon"]');
  console.log('选尼康后 hidden =', await ev(`document.getElementById('brandPop').hidden`), ' 品牌 =', await ev(`document.getElementById('brandName').textContent`));

  console.log('--- B. 「官方标识配色」自绘下拉 ---');
  const selId = await ev(`document.querySelector('select[data-cfg="logoVariant"]').dataset.trigger`);
  await clickSel(`.fp-trigger[data-for-sel="${selId}"]`);
  console.log('打开后 pickPop.hidden =', await ev(`document.getElementById('pickPop').hidden`), ' 项数 =', await ev(`document.querySelectorAll('#pickList .fp-item').length`));
  await clickSel('#pickList .fp-item:nth-child(2)');
  console.log('选项后 pickPop.hidden =', await ev(`document.getElementById('pickPop').hidden`), ' 当前值 =', await ev(`document.querySelector('select[data-cfg="logoVariant"]').value`));

  console.log('--- C. 字体下拉 ---');
  await clickSel('#fontSelectTrigger');
  console.log('打开后 fpPop.hidden =', await ev(`(document.getElementById('fontPop')||{}).hidden`));
  console.log('  (如无此 id 忽略)');

  console.log('--- D. 设置抽屉里的应用 Logo 上传按钮 ---');
  await clickSel('#btnSettings');
  console.log('抽屉 show =', await ev(`document.getElementById('settingsDrawer').classList.contains('show')`));

  spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  process.exit(0);
})().catch(e => { console.error('异常', e.message); process.exit(1); });
