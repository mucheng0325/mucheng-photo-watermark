/* v9 验收：版权预设去「暮呈」+ 主题两档且图标跟随 + 自绘窗口控制条
 * 覆盖：DOM 结构、点击行为、SVG hidden 反射（真机踩过的坑）、Tauri 模式接线
 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9421;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`✗ FAIL  ${name}${extra ? '  → ' + extra : ''}`); }
};

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1480,940',
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-v9-' + Date.now()), 'about:blank'], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {}
    await sleep(400);
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (mm, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const shot = async (name, clip) => {
    const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'ui-shots', name), Buffer.from(r.result.data, 'base64'));
  };
  const clickSel = async sel => {
    const raw = await ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return 'null';
      b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`);
    if (raw === 'null') return false;
    const p = JSON.parse(raw);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(320);
    return true;
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + path.resolve(__dirname, '..', 'src', 'index.html').replace(/\\/g, '/') });
  await sleep(2200);
  await ev(`localStorage.clear(); location.reload()`);
  await sleep(2600);

  console.log('\n【1】版权预设不再出现「暮呈」');
  const presets = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#copyPresets .pill')].map(b=>({t:b.textContent.trim(),tpl:b.dataset.copytpl})))`));
  ck('预设数量仍为 4', presets.length === 4, JSON.stringify(presets));
  ck('没有任何按钮文案含「暮呈」', presets.every(p => !p.t.includes('暮呈')), presets.map(p => p.t).join(' / '));
  ck('没有模板串含「暮呈」', presets.every(p => !String(p.tpl).includes('暮呈')), presets.map(p => p.tpl).join(' / '));
  ck('首个预设为「© 年份」→ © {year}', presets[0].t === '© 年份' && presets[0].tpl === '© {year}', presets[0].t + ' | ' + presets[0].tpl);

  console.log('\n【2】主题模式三档齐全');
  const segs = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#themeSeg button')].map(b=>({m:b.dataset.themeMode,t:b.textContent.trim()})))`));
  ck('分段按钮数为 3', segs.length === 3, segs.map(s => s.t).join(' / '));
  ck('三档依次为「跟随系统」「浅色」「深色」',
    segs[0].m === 'system' && segs[1].m === 'light' && segs[2].m === 'dark', segs.map(s => s.m).join(','));

  console.log('\n【3】顶栏图标跟随切换（SVG hidden 必须反射到 attribute）');
  const st = () => ev(`(()=>{const g=id=>{const n=document.getElementById(id);const c=getComputedStyle(n);
    return {attrHidden:n.hasAttribute('hidden'), disp:c.display, w:+n.getBoundingClientRect().width.toFixed(1)};};
    return JSON.stringify({mode:document.documentElement.dataset.theme, saved:localStorage.getItem('ecw.theme'),
      sys:g('thSys'), light:g('thLight'), dark:g('thDark'), title:document.getElementById('btnTheme').title,
      segOn:[...document.querySelectorAll('#themeSeg button')].filter(b=>b.classList.contains('on')).map(b=>b.dataset.themeMode)});})()`).then(JSON.parse);

  const a0 = await st();
  ck('初始为跟随系统：显示器图标可见', a0.sys.disp === 'block' && a0.sys.w > 10, JSON.stringify(a0.sys));
  ck('初始：太阳、月亮都隐藏', a0.light.disp === 'none' && a0.light.w === 0 && a0.dark.disp === 'none' && a0.dark.w === 0,
    JSON.stringify({ light: a0.light, dark: a0.dark }));

  await clickSel('#btnTheme');
  const a1 = await st();
  ck('点一下 → 浅色（data-theme=light）', a1.mode === 'light' && a1.saved === 'light', a1.mode + '/' + a1.saved);
  ck('浅色：太阳图标可见', a1.light.disp === 'block' && a1.light.w > 10, JSON.stringify(a1.light));
  ck('浅色：显示器图标隐藏', a1.sys.disp === 'none' && a1.sys.w === 0, JSON.stringify(a1.sys));
  ck('图标隐藏靠 attribute，不是 JS 属性', a1.sys.attrHidden === true && a1.light.attrHidden === false,
    `sys.attr=${a1.sys.attrHidden} light.attr=${a1.light.attrHidden}`);
  ck('设置里「浅色」高亮', a1.segOn.length === 1 && a1.segOn[0] === 'light', a1.segOn.join(','));
  ck('按钮 title 同步为「浅色」', /浅色/.test(a1.title), a1.title);

  await clickSel('#btnTheme');
  const a2 = await st();
  ck('再点一下 → 深色', a2.mode === 'dark' && a2.saved === 'dark', a2.mode + '/' + a2.saved);
  ck('深色：月亮图标可见', a2.dark.disp === 'block' && a2.dark.w > 10, JSON.stringify(a2.dark));
  ck('深色：太阳与显示器都隐藏', a2.light.disp === 'none' && a2.sys.disp === 'none');
  ck('设置里「深色」高亮', a2.segOn.length === 1 && a2.segOn[0] === 'dark', a2.segOn.join(','));
  ck('按钮 title 同步为「深色」', /深色/.test(a2.title), a2.title);

  await clickSel('#btnTheme');
  const a3 = await st();
  ck('第三下回到跟随系统', a3.saved === 'system' && /跟随系统/.test(a3.title), a3.saved + ' | ' + a3.title);
  ck('回到跟随系统：显示器图标恢复，另外两个隐藏',
    a3.sys.disp === 'block' && a3.light.disp === 'none' && a3.dark.disp === 'none');
  await clickSel('#btnTheme');
  const a4 = await st();
  ck('四档循环回到浅色', a4.saved === 'light' && a4.light.disp === 'block', a4.saved);

  console.log('\n【4】设置面板：品牌 Logo 自定义入口已删除');
  const nog = JSON.parse(await ev(`JSON.stringify({
    input: !!document.getElementById('appLogoInput'),
    img: !!document.getElementById('appLogoImg'),
    thumbs: document.querySelectorAll('.logo-thumb').length,
    uploads: document.querySelectorAll('[data-logo-upload]').length,
    clears: document.querySelectorAll('[data-logo-clear]').length,
    marks: document.querySelectorAll('.logo-mark .logo-def').length
  })`));
  ck('没有自定义 Logo 的上传控件', !nog.input && nog.thumbs === 0 && nog.uploads === 0 && nog.clears === 0, JSON.stringify(nog));
  ck('顶栏仍保留内置浅/深两张标识', nog.marks === 2, String(nog.marks));

  const sw = JSON.parse(await ev(`JSON.stringify({
    uiActive: document.querySelectorAll('#uiSwatches .sw.active').length,
    wmActive: document.querySelectorAll('#swatches .sw.active').length })`));
  ck('界面色板启动后就有一项高亮（不被水印色板清掉）', sw.uiActive === 1, JSON.stringify(sw));
  ck('水印主题色板仍独立高亮', sw.wmActive === 1, String(sw.wmActive));

  console.log('\n【5】非 Tauri 环境不出现自绘窗口按钮');
  const webMode = await ev(`(()=>{const c=document.getElementById('winCtrl'), r=document.getElementById('rzLayer');
    return JSON.stringify({shell:document.documentElement.dataset.shell, ctrlHidden:c.hidden, ctrlDisp:getComputedStyle(c).display,
      rzHidden:r.hidden, rzDisp:getComputedStyle(r).display});})()`).then(JSON.parse);
  ck('data-shell=web', webMode.shell === 'web', webMode.shell);
  ck('窗口控制条隐藏', webMode.ctrlHidden === true && webMode.ctrlDisp === 'none', JSON.stringify(webMode));
  ck('缩放手柄层隐藏', webMode.rzHidden === true && webMode.rzDisp === 'none', JSON.stringify(webMode));

  console.log('\n【6】模拟 Tauri：按钮接线与拖拽命中');
  const wired = await ev(`(async()=>{
    const calls=[];
    window.__TAURI__={core:{invoke:()=>Promise.resolve({ok:true,maximized:false})}};
    window.desktopApi={ winMin:()=>{calls.push('min');return Promise.resolve();},
      winToggleMax:()=>{calls.push('max');return Promise.resolve(true);},
      winClose:()=>{calls.push('close');return Promise.resolve();},
      winDrag:()=>{calls.push('drag');return Promise.resolve();},
      winResize:d=>{calls.push('resize:'+d);return Promise.resolve();},
      winState:()=>Promise.resolve(false) };
    wireWindowControls();
    document.getElementById('winMin').click();
    document.getElementById('winMax').click();
    document.getElementById('winClose').click();
    // 关闭走「先落盘再关窗」，是异步的（最多 300ms），这里等它发出
    await new Promise(r=>setTimeout(r,450));
    const r={
      shell:document.documentElement.dataset.shell,
      ctrlHidden:document.getElementById('winCtrl').hidden,
      rzHidden:document.getElementById('rzLayer').hidden,
      btnSize:(()=>{const b=document.getElementById('winMin').getBoundingClientRect();return b.width+'x'+b.height;})(),
      iconsShown:[...document.querySelectorAll('#winMax svg')].filter(s=>getComputedStyle(s).display!=='none').length,
      calls:calls.slice()
    };
    return JSON.stringify(r);
  })()`).then(JSON.parse);
  ck('data-shell 切到 tauri', wired.shell === 'tauri', wired.shell);
  ck('窗口控制条显示', wired.ctrlHidden === false);
  ck('缩放手柄层显示', wired.rzHidden === false);
  ck('三颗按钮实际渲染（30x28）', wired.btnSize === '30x28', wired.btnSize);
  ck('最大化按钮当前显示「最大化」单图标', wired.iconsShown === 1, String(wired.iconsShown));
  ck('min/max/close 三个调用都发出', wired.calls.slice(0, 3).join(',') === 'min,max,close', wired.calls.join(','));

  const dragHit = await ev(`(()=>{
    const bar=document.querySelector('.topbar');
    const fire=(el,detail)=>{ const r=el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,detail:detail||1,clientX:r.left+2,clientY:r.top+2})); };
    const calls=[];
    window.desktopApi.winDrag=()=>{calls.push('drag');return Promise.resolve();};
    fire(document.querySelector('.logo-text'));
    fire(document.getElementById('btnFiles'));
    fire(document.querySelector('.logo-text'),2);
    return JSON.stringify(calls);
  })()`).then(JSON.parse);
  ck('标题文字区按下 → 触发拖窗', dragHit[0] === 'drag', JSON.stringify(dragHit));
  ck('按钮上按下 → 不拖窗', !dragHit.includes('drag') || dragHit.length === 1, JSON.stringify(dragHit));
  ck('双击的第二下（detail=2）不重复拖窗', dragHit.length === 1, JSON.stringify(dragHit));

  await ev(`document.documentElement.dataset.theme='dark'; document.body.classList.add('is-max'); document.getElementById('winCtrl').hidden=false; document.getElementById('rzLayer').hidden=true;`);
  await sleep(200);
  const restoreIcon = await ev(`[...document.querySelectorAll('#winMax svg')].map(s=>getComputedStyle(s).display).join('|')`);
  ck('最大化后按钮切为「还原」图标', restoreIcon === 'none|block', restoreIcon);

  await ev(`document.documentElement.dataset.theme='light'; document.body.classList.remove('is-max');`);
  await sleep(360);
  await shot('v9-topbar-light.png', { x: 900, y: 0, width: 580, height: 56, scale: 2 });
  await ev(`document.documentElement.dataset.theme='dark'`);
  await sleep(500);
  await shot('v9-topbar-dark.png', { x: 900, y: 0, width: 580, height: 56, scale: 2 });
  await shot('v9-full-dark.png');

  console.log('\n【7】运行时异常');
  const uniq = [...new Set(errs)];
  ck(`0 异常（${uniq.length}）`, uniq.length === 0, uniq.slice(0, 2).join(' | '));

  console.log(`\n合计 ${pass} 通过 / ${fail} 失败`);
  spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  process.exit(fail ? 1 : 0);
})();
