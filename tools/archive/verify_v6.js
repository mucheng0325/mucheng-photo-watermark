/* v6 验收：产品改名（暮呈）+ 关于信息（著作权人/删软著/技术信息）+ 版权默认留空 + 旧配置迁移 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const NEW_NAME = '暮呈照片水印工作台';
const REPO = 'https://github.com/mucheng0325/-.git';
const OLD_COPY = '© 2026 珠海领行科技';

let pass = 0, fail = 0;
const ck = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`✗ FAIL  ${name}`); } };

(async () => {
  const p = spawn(path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'exif-cam.exe'), [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9471' },
    stdio: 'ignore'
  });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:9471/json/list'); targets = await r.json(); if (targets.length) break; } catch (_) {}
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

  async function nav(url) { await ev(`location.href = '${url}'`); await sleep(2600); }
  async function realClickAt(selector) {
    const r = JSON.parse(await ev(`(()=>{const b=document.querySelector('${selector}');const t=b.getBoundingClientRect();return JSON.stringify({x:t.left+t.width/2,y:t.top+t.height/2})})()`));
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    }
    await sleep(220);
  }

  /* 1. 全新配置：版权默认留空 */
  await ev(`localStorage.clear()`);
  await nav('http://tauri.localhost/');
  ck('全新配置：版权默认为空', await ev(`cfg.copyright`) === '');
  ck('全新配置：版权输入框为空', await ev(`document.querySelector('[data-cfg="copyright"]').value`) === '');

  /* 2. 产品名：标题 / 顶栏品牌位 */
  ck('窗口标题 = ' + NEW_NAME, await ev(`document.title`) === NEW_NAME);
  ck('顶栏单行显示产品名', await ev(`document.querySelector('.logo-text').textContent.trim()`) === '照片水印工作台');
  ck('顶栏无单独品牌字', await ev(`!document.querySelector('.logo-text b')`));

  /* 3. 旧配置迁移：旧公司名版权自动清空，其他字段保留 */
  await ev(`localStorage.clear();
    localStorage.setItem('ecw.cfg.v4', JSON.stringify({ copyright: ${JSON.stringify(OLD_COPY)}, accent: '#35E0F0', layout: 'banner' }))`);
  await nav('http://tauri.localhost/');
  ck('旧配置：公司名版权被清空', await ev(`cfg.copyright`) === '');
  ck('旧配置：其余字段保留（accent/banner）', await ev(`cfg.accent === '#35E0F0' && cfg.layout === 'banner'`));

  /* 4. 设置 → 关于：产品名 / 著作权人 / 无软著 / 技术信息 */
  await realClickAt('#btnSettings');
  await sleep(450);
  ck('设置抽屉已打开', await ev(`document.getElementById('settingsDrawer').classList.contains('show')`));
  const about = JSON.parse(await ev(`(()=>{
    const rows = [...document.querySelectorAll('.about-list > div')].map(d => ({
      k: d.querySelector('dt').textContent.trim(),
      v: d.querySelector('dd').textContent.trim()
    }));
    return JSON.stringify(rows);
  })()`));
  const get = k => (about.find(r => r.k === k) || {}).v;
  ck(`关于·产品名 = ${get('产品名')}`, get('产品名') === NEW_NAME);
  ck(`关于·著作权人 = ${get('著作权人')}`, get('著作权人') === REPO);
  ck('关于·软著登记号已删除', !about.some(r => r.k === '软著登记号'));
  ck(`关于·技术信息（${get('技术信息')}）`, /Tauri 2/.test(get('技术信息') || '') && /Canvas 合成引擎/.test(get('技术信息') || ''));
  ck('关于·著作权人无横向溢出', await ev(`(()=>{const el=document.querySelector('.about-url');return el.scrollWidth <= el.clientWidth + 1})()`));

  /* 截图：关于段 */
  await ev(`document.querySelector('.about-list').scrollIntoView({block:'center'})`);
  await sleep(400);
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, 'ui-shots', 'v6-about.png'), Buffer.from(shot.result.data, 'base64'));

  await realClickAt('#btnCloseSettings');
  await sleep(400);

  /* 5. 版权页签：默认空 + 预设「© 暮呈」可用 */
  await nav('http://tauri.localhost/?demo=1');
  ck('demo 照片已载入', await ev(`state.files.length`) === 1);
  await realClickAt('.tab[data-tab="copy"]');
  await sleep(300);
  ck('版权页签：输入框默认空', await ev(`document.querySelector('[data-cfg="copyright"]').value`) === '');
  const pills = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#copyPresets .pill')].map(b=>b.textContent.trim()))`));
  ck(`版权预设含「© 暮呈」（${pills.join('/')}）`, pills.includes('© 暮呈'));
  ck('版权预设不再出现旧公司名', !pills.some(t => /珠海领行/.test(t)));
  await ev(`document.querySelector('#copyPresets .pill[data-copytpl*="暮呈"]').click()`);
  await sleep(350);
  const filled = await ev(`document.querySelector('[data-cfg="copyright"]').value`);
  ck(`点预设写入（${filled}）`, filled === `© ${new Date().getFullYear()} 暮呈`);
  // 清回空，截图展示默认态
  await ev(`document.querySelector('#copyPresets .pill[data-copytpl=""]').click()`);
  await sleep(350);
  ck('「清空」预设可复原为空', await ev(`cfg.copyright`) === '');

  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, 'ui-shots', 'v6-copyright.png'), Buffer.from(shot.result.data, 'base64'));

  /* 6. 空版权时水印仍正常：画布有墨迹 */
  const ink = await ev(`(()=>{ const c=document.getElementById('preview'); const ctx=c.getContext('2d');
    const top = Math.round(c.height*0.86);
    const d=ctx.getImageData(0, top, c.width, c.height-top).data; let n=0;
    for (let i=3;i<d.length;i+=4) if (d[i]>40) n++; return n; })()`);
  ck(`水印区仍有墨迹（${ink}px）`, ink > 500);

  const errs = events.filter(e => e.method === 'Runtime.exceptionThrown').length;
  ck(`0 运行时异常（${errs}）`, errs === 0);

  spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
