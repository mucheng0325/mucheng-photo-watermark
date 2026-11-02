/* v5 验收：配置迁移 + 主题钮循环 + 品牌切换 + 原厂配色默认值 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`✗ FAIL  ${name}`); } };

(async () => {
  const p = spawn(path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'exif-cam.exe'), [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9467' },
    stdio: 'ignore'
  });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:9467/json/list'); targets = await r.json(); if (targets.length) break; } catch (_) {}
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
  await send('Page.enable');
  await sleep(1200);

  async function nav(url) { await ev(`location.href = '${url}'`); await sleep(2500); }
  async function realClickAt(selector) {
    const r = JSON.parse(await ev(`(()=>{const b=document.querySelector('${selector}');const t=b.getBoundingClientRect();return JSON.stringify({x:t.left+t.width/2,y:t.top+t.height/2})})()`));
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    }
    await sleep(200);
  }

  /* 1. v3→v4 迁移：旧 white 默认迁成 brand，其余字段保留 */
  await ev(`localStorage.clear();
    localStorage.setItem('ecw.cfg.v3', JSON.stringify({ logoVariant: 'white', layout: 'banner', opacity: 0.7 }))`);
  await nav('http://tauri.localhost/');
  ck('v3 迁移：white→brand', await ev(`cfg.logoVariant`) === 'brand');
  ck('v3 迁移：其他字段保留（banner/0.7）', await ev(`cfg.layout === 'banner' && cfg.opacity === 0.7`));
  ck('v4 已落盘', !!await ev(`localStorage.getItem('ecw.cfg.v4')`));

  /* 2. demo 照片 + 主题钮循环（themeMode: system→light→dark→system） */
  await nav('http://tauri.localhost/?demo=1');
  ck('demo 照片已载入', await ev(`state.files.length`) === 1);
  ck('初始 themeMode = system', await ev(`themeMode`) === 'system');
  await realClickAt('#btnTheme');
  const m1 = await ev(`themeMode`);
  await realClickAt('#btnTheme');
  const m2 = await ev(`themeMode`);
  await realClickAt('#btnTheme');
  const m3 = await ev(`themeMode`);
  ck(`主题钮循环 system→${m1}→${m2}→${m3}`, m1 === 'light' && m2 === 'dark' && m3 === 'system');
  ck('循环后窗口背景回到浅色', await ev(`document.documentElement.dataset.theme`) === 'light');
  await realClickAt('#btnTheme'); // 留在浅色展示

  /* 3. 品牌切换：Canon 样张 → 尼康水印 */
  await realClickAt('.tab[data-tab="brand"]');   // 先切到品牌页签，面板可见才有命中区域
  await sleep(300);
  const before = await ev(`({name: document.getElementById('brandName').textContent, bg: getComputedStyle(document.getElementById('brandBadge')).backgroundColor})`);
  await realClickAt('#brandCard');
  await sleep(250);
  ck('品牌下拉打开', await ev(`!document.getElementById('brandPop').hidden`));
  const itemCount = await ev(`document.querySelectorAll('#brandPop .bp-item').length`);
  ck(`下拉共 ${itemCount} 项（自动 + 27 品牌）`, itemCount === 28);
  ck('当前项高亮「自动识别」', (await ev(`document.querySelector('#brandPop .bp-item.on .bp-name').firstChild.textContent.trim()`)) === '自动识别');
  await ev(`document.querySelector('#brandPop .bp-item[data-key=nikon]').click()`);
  await sleep(400);
  const after = await ev(`({name: document.getElementById('brandName').textContent, bg: document.getElementById('brandBadge').style.background, fg: document.getElementById('brandBadge').style.color, model: document.getElementById('brandModel').textContent})`);
  ck(`品牌卡 ${before.name}→${after.name}`, after.name === 'Nikon');
  ck('徽章尼康黄底', /rgb\(255, 209, 0\)/i.test(after.bg));
  ck('黄底自动黑字', after.fg === 'rgb(16, 17, 20)');
  ck('标注「手动指定」', /手动指定/.test(after.model));
  ck('chipBrand 同步 Nikon', await ev(`document.getElementById('chipBrand').textContent`) === 'Nikon');
  ck('cfg.brandKey = nikon 持久化', await ev(`JSON.parse(localStorage.getItem('ecw.cfg.v4')).brandKey`) === 'nikon');

  /* 4. 水印画布真的换 logo 了：品牌区像素对比（切换前后） */
  const inkNikon = await ev(`(()=>{ const c=document.getElementById('preview'); const ctx=c.getContext('2d');
    const d=ctx.getImageData(0, c.height - Math.round(c.height*0.12), c.width, Math.round(c.height*0.12)).data;
    let yellow=0; for (let i=0;i<d.length;i+=4) if (d[i]>200 && d[i+1]>150 && d[i+2]<120) yellow++;
    return yellow; })()`);
  ck(`预览画布出现尼康黄（${inkNikon}px）`, inkNikon > 30);

  /* 5. 切回自动识别 → 回到 Canon */
  await realClickAt('#brandCard'); await sleep(250);
  await ev(`document.querySelector('#brandPop .bp-item[data-key=""]').click()`);
  await sleep(300);
  ck('切回自动识别 → Canon', await ev(`document.getElementById('brandName').textContent`) === 'Canon');

  /* 6. 异常 */
  const errs = events.filter(e => e.method === 'Runtime.exceptionThrown').length;
  ck(`0 运行时异常（${errs}）`, errs === 0);

  /* 截图：品牌下拉展开态 */
  await realClickAt('#brandCard');
  await sleep(350);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, 'ui-shots', 'v5-brand-picker.png'), Buffer.from(shot.result.data, 'base64'));

  spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
