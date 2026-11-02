/* v8 验收：换 Logo + 水印默认 1.50× + 悬浮卡片去边框去角标 + 新增「白色边框」版式 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..', 'src').replace(/\\/g, '/');   // 前端源码目录
const PORT = 9418;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { listFonts } = require('../legacy/electron/src/fonts.js');  // 仅用于给 mock 提供字体清单

let pass = 0, fail = 0;
const ck = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`✗ FAIL  ${name}`); } };

(async () => {
  const fonts = listFonts();
  const payload = JSON.stringify({
    ok: fonts.ok, count: fonts.count, scanned: fonts.scanned, stats: fonts.stats,
    fonts: fonts.fonts.map(f => ({ name: f.name, script: f.script, aliases: (f.aliases || []).slice(0, 2) }))
  });

  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1480,940', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-v8-' + Date.now()), 'about:blank'], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {}
    await sleep(400);
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + (m.params.args?.map(a => a.value || a.description || '').join(' ') || ''));
  };
  const send = (mm, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const shot = async (name, clip) => {
    const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'ui-shots', name), Buffer.from(r.result.data, 'base64'));
  };
  const click = async sel => {
    const r = JSON.parse(await ev(`(()=>{const b=document.querySelector('${sel}');if(!b)return 'null';b.scrollIntoView({block:'center'});
      const t=b.getBoundingClientRect();return JSON.stringify({x:t.left+t.width/2,y:t.top+t.height/2})})()`));
    if (r === 'null') return false;
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    }
    await sleep(320);
    return true;
  };

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 940, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.desktopApi = { platform:'win32', chooseDir: async()=>'', saveFile: async()=>({ok:true}),
      listFonts: async()=>(${payload}), setBgColor: async()=>({ok:true}), openOutDir: async()=>({ok:true}) };`
  });
  await send('Page.navigate', { url: `file:///${ROOT}/index.html?demo=1` });
  await sleep(4300);

  /* ---------- 1. 顶部 Logo ---------- */
  const logo = JSON.parse(await ev(`(()=>{
    const l=document.querySelector('.logo-def.only-light'), d=document.querySelector('.logo-def.only-dark');
    const st=n=>{const c=getComputedStyle(n);return {disp:c.display,w:n.offsetWidth,nat:n.naturalWidth};};
    return JSON.stringify({light:st(l), dark:st(d), customInput:!!document.getElementById('appLogoInput'),
      img:!!document.getElementById('appLogoImg')});
  })()`));
  ck(`浅色版已加载（naturalWidth ${logo.light.nat}）`, logo.light.nat > 100);
  ck(`深色版已加载（naturalWidth ${logo.dark.nat}）`, logo.dark.nat > 100);
  ck(`浅色主题显示浅色版（display=${logo.light.disp} / ${logo.light.w}px）`, logo.light.disp !== 'none' && logo.light.w >= 20);
  ck(`浅色主题隐藏深色版`, logo.dark.disp === 'none');
  ck('顶栏只用内置标识（自定义上传入口已移除）', logo.customInput === false && logo.img === false);
  await shot('v8-topbar-light.png', { x: 0, y: 0, width: 420, height: 56, scale: 3 });

  /* ---------- 2. 默认水印 1.50× ---------- */
  ck(`cfg.fontScale = ${await ev(`cfg.fontScale`)}`, await ev(`cfg.fontScale`) === 1.5);
  ck(`滑杆 value = ${await ev(`document.querySelector('input[data-cfg="fontScale"]').value`)}`, await ev(`document.querySelector('input[data-cfg="fontScale"]').value`) === '1.5');
  ck(`数值标签 = ${await ev(`document.getElementById('vFont').textContent`)}`, await ev(`document.getElementById('vFont').textContent`) === '1.50×');

  /* ---------- 3. 悬浮卡片：无边框 / 无角标 ---------- */
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'render.js'), 'utf8');
  ck('render.js 已无 cornerTicks 绘制', !/cornerTicks/.test(src));
  const bgBody = src.slice(src.indexOf('function bgFill'), src.indexOf('function bgFill') + 1400);
  ck('bgFill 不再描边（无 stroke）', !/\.stroke\(/.test(bgBody) && !/strokeStyle/.test(bgBody));

  // 纯黑底上画卡片：卡片外沿若还有 14% 白描边，边缘像素会明显发亮
  const edge = JSON.parse(await ev(`(()=>{
    const c=document.createElement('canvas'); c.width=1200; c.height=700;
    const x=c.getContext('2d'); x.fillStyle='#000'; x.fillRect(0,0,1200,700);
    const info={paramText:'50mm · f/1.8 · 1/200s · ISO400', modelShort:'EOS R6', copyright:''};
    Render.draw(x,1200,700,Object.assign({},cfg,{layout:'card',bgStyle:'solid',opacity:0.55}),info,
      {brand:Brands.detect('Canon','EOS R6'),logo:null});
    const d=x.getImageData(0,0,1200,700).data;
    const L=(xx,yy)=>{const i=(yy*1200+xx)*4;return (0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2])/255;};
    // 每一行找卡片左外沿的第一个非黑像素，描边会让它整圈发亮
    let maxEdge=0, samples=0;
    for(let yy=40;yy<660;yy+=5){
      for(let xx=0;xx<1199;xx++){
        if(L(xx,yy)>0.006){
          maxEdge=Math.max(maxEdge,L(xx,yy),L(xx+1,yy),L(xx+2,yy));
          samples++; break;
        }
      }
    }
    return JSON.stringify({samples, maxEdge:+maxEdge.toFixed(3)});
  })()`));
  console.log(`  · 卡片左外沿采样 ${edge.samples} 行，最亮 ${edge.maxEdge}（14% 白描边会到 ~0.14）`);
  ck('卡片外沿没有白色描边', edge.samples > 10 && edge.maxEdge < 0.06);

  /* ---------- 4. 白色边框版式 ---------- */
  ck('版式按钮共 9 个', await ev(`document.querySelectorAll('.layout-btn').length`) === 9);
  ck('新增四款版式入口齐全', await ev(`['film','hud','edge','gallery'].every(k=>document.querySelector('.layout-btn[data-layout="'+k+'"]'))`));
  await click('.layout-btn[data-layout="frame"]');
  ck('版式已切到 frame', await ev(`cfg.layout`) === 'frame');
  ck('白色边框宽度控件出现', await ev(`!document.querySelector('[data-lay="frame"]').hidden`));
  ck('背景/不透明度/圆角/边距已隐去', await ev(`[...document.querySelectorAll('[data-lay]')].filter(n=>!n.dataset.lay.includes('frame')).every(n=>n.hidden)`));

  const geo = JSON.parse(await ev(`(()=>{const c=document.getElementById('preview');
    const g=Render.frameGeom(cfg, orientedSize(state.files[0]).W, orientedSize(state.files[0]).H);
    return JSON.stringify({cw:c.width,ch:c.height,g});})()`));
  console.log(`  · 预览画布 ${geo.cw}×${geo.ch}，输出 ${geo.g.outW}×${geo.g.outH}，白边 ${geo.g.side}px，底 ${geo.g.bottom}px`);
  const photoAspect = JSON.parse(await ev(`(()=>{const s=orientedSize(state.files[0]);return JSON.stringify(s)})()`));
  ck('画布已被白框撑大（宽 > 照片宽）', geo.g.outW > photoAspect.W && geo.g.outH > photoAspect.H);
  ck('白边宽度 = 照片宽 3%', Math.abs(geo.g.side - photoAspect.W * 0.03) <= 2);

  const probe = `(()=>{const c=document.getElementById('preview');const x=c.getContext('2d');
    const W=c.width,H=c.height;const d=x.getImageData(0,0,W,H).data;
    const px=(xx,yy)=>{const i=(yy*W+xx)*4;return [d[i],d[i+1],d[i+2]];};
    const white=p=>p[0]>248&&p[1]>248&&p[2]>248;
    // 左边缘白边宽度（中间行）
    let run=0; const mid=Math.round(H*0.45);
    while(run<W && white(px(run,mid))) run++;
    // 底部白区里的深色文字像素（白底题注应是深色）
    let dark=0; for(let yy=Math.round(H*0.93);yy<H;yy++){for(let xx=0;xx<W;xx++){
      const p=px(xx,yy); const l=(0.2126*p[0]+0.7152*p[1]+0.0722*p[2])/255; if(l<0.35) dark++;}}
    // 四角是否纯白
    const corners=[px(2,2),px(W-3,2),px(2,H-3),px(W-3,H-3)].every(white);
    return JSON.stringify({run,dark,corners,W,H});})()`;
  const P = JSON.parse(await ev(probe));
  console.log(`  · 预览 ${P.W}×${P.H}，左侧白边 ${P.run}px，底部深色文字 ${P.dark}px`);
  ck('四角纯白（白框确实铺满四周）', P.corners === true);
  ck(`白边宽度符合预期（${P.run}px ≈ ${Math.round(geo.g.side * geo.cw / geo.g.outW)}px）`,
    Math.abs(P.run - geo.g.side * geo.cw / geo.g.outW) <= 3);
  ck(`底部长条上有深色水印文字（${P.dark}px）`, P.dark > 800);
  await shot('v8-frame-default.png');

  /* ---------- 5. 白边宽度可调 ---------- */
  const before = P.run;
  await ev(`(()=>{const s=document.querySelector('input[data-cfg="framePct"]');s.value='0.06';
    s.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  await sleep(420);
  const P2 = JSON.parse(await ev(probe));
  console.log(`  · 白边 6% → ${P2.run}px（原 ${before}px），标签 ${await ev(`document.getElementById('vFrame').textContent`)}`);
  ck('白边加宽后左侧白边变宽', P2.run > before * 1.5);
  ck('标签同步 6.0%', await ev(`document.getElementById('vFrame').textContent`) === '6.0%');
  await shot('v8-frame-wide.png');

  // 位置：右对齐
  await ev(`cfg.position='bottom-right';syncUI();scheduleRender(0);1`);
  await sleep(420);
  await shot('v8-frame-right.png');

  /* ---------- 6. 深色主题下的顶栏 Logo ---------- */
  await ev(`cfg.layout='card';cfg.framePct=0.03;cfg.position='bottom-left';syncUI();scheduleRender(0);applyTheme('dark');1`);
  await sleep(600);
  const dark = JSON.parse(await ev(`(()=>{const l=document.querySelector('.logo-def.only-light'),d=document.querySelector('.logo-def.only-dark');
    return JSON.stringify({l:getComputedStyle(l).display,d:getComputedStyle(d).display});})()`));
  ck(`深色主题切换为深色版（light=${dark.l} / dark=${dark.d}）`, dark.l === 'none' && dark.d !== 'none');
  await shot('v8-topbar-dark.png', { x: 0, y: 0, width: 420, height: 56, scale: 3 });
  await shot('v8-main-dark.png');

  await ev(`applyTheme('light');1`);
  await sleep(500);
  await shot('v8-main-light.png');

  /* ---------- 7. 导出尺寸一致性（白框导出不裁剪照片） ---------- */
  const exp = JSON.parse(await ev(`(()=>{const f=state.files[0];const s=orientedSize(f);
    cfg.layout='frame';const g=Render.frameGeom(cfg,s.W,s.H);
    const cv=document.createElement('canvas');cv.width=g.outW;cv.height=g.outH;
    const sc=sceneOf(f,1);paintScene(cv.getContext('2d'),f,sc);
    const x=cv.getContext('2d'); const d=x.getImageData(0,0,cv.width,cv.height).data;
    let white=0,nonwhite=0;
    for(let i=0;i<d.length;i+=4*97){ if(d[i]>248&&d[i+1]>248&&d[i+2]>248) white++; else nonwhite++; }
    return JSON.stringify({w:cv.width,h:cv.height,white,nonwhite,expect:g.outW+'x'+g.outH});})()`));
  console.log(`  · 导出画布 ${exp.w}×${exp.h}（期望 ${exp.expect}），白 ${exp.white} / 非白 ${exp.nonwhite}`);
  ck('导出画布 = 照片 + 白框', exp.w > photoAspect.W && exp.h > photoAspect.H);
  ck('导出含照片内容（非白占多数）', exp.nonwhite > exp.white);

  /* ---------- 7.5 竖构图（3000×4000）：白框题注不能被挤出版面 ---------- */
  const port = JSON.parse(await ev(`(()=>{
    const W=3000,H=4000; const c0=Object.assign({},cfg,{layout:'frame',framePct:0.03});
    const g=Render.frameGeom(c0,W,H);
    const cv=document.createElement('canvas'); cv.width=g.outW; cv.height=g.outH;
    const x=cv.getContext('2d');
    x.fillStyle='#FFFFFF'; x.fillRect(0,0,cv.width,cv.height);
    x.fillStyle='#7A7F88'; x.fillRect(g.side,g.side,W,H);
    Render.draw(x,g.outW,g.outH,c0,
      {paramText:'50mm · f/1.8 · 1/200s · ISO400',modelShort:'EOS R6 Mark II',copyright:'© 暮呈'},
      {brand:Brands.detect('Canon','EOS R6'),logo:null},{photo:{x:g.side,y:g.side,w:W,h:H}});
    const d=x.getImageData(0,0,cv.width,cv.height).data;
    const strip=g.bottom; let miny=1e9,maxy=-1,minx=1e9;
    for(let yy=cv.height-strip;yy<cv.height;yy++)for(let xx=0;xx<cv.width;xx++){
      const i=(yy*cv.width+xx)*4;
      if(!(d[i]>250&&d[i+1]>250&&d[i+2]>250)){ if(yy<miny)miny=yy; if(yy>maxy)maxy=yy; if(xx<minx)minx=xx; }
    }
    return JSON.stringify({outW:g.outW,outH:g.outH,side:g.side,strip,
      topRoom:miny-(cv.height-strip), bottomRoom:cv.height-1-maxy, inkLeft:minx});})()`));
  console.log(`  · 竖构图 ${port.outW}×${port.outH}，底条 ${port.strip}px，墨迹上留 ${port.topRoom} / 下留 ${port.bottomRoom}，左对齐 ${port.inkLeft}(应=${port.side})`);
  ck('竖构图题注上下都留白（未溢出）', port.topRoom >= 4 && port.bottomRoom >= 4);
  ck('竖构图题注左对齐照片边缘', Math.abs(port.inkLeft - port.side) <= 2);

  /* ---------- 8. 四款风格化版式 ---------- */
  const styles = JSON.parse(await ev(`(()=>{
    const f = state.files[state.cur];
    const { W, H } = orientedSize(f);
    const out = {};
    for (const lay of ['film','hud','edge','gallery']) {
      const c = Object.assign({}, cfg, { layout: lay });
      const g = Render.frameGeom(c, W, H);
      out[lay] = { outW: g.outW, outH: g.outH, framed: !!g.framed };
    }
    // 各版式实绘一次：画布必须有非空白像素，且不抛异常
    const drawn = {};
    for (const lay of ['film','hud','edge','gallery']) {
      const c = Object.assign({}, cfg, { layout: lay });
      const g = Render.frameGeom(c, W, H);
      const k = 800 / g.outW;
      const cv = document.createElement('canvas');
      cv.width = Math.round(g.outW * k); cv.height = Math.round(g.outH * k);
      const x = cv.getContext('2d');
      x.fillStyle = '#8A8F98'; x.fillRect(0, 0, cv.width, cv.height);
      Render.drawImageOriented(x, f.img, f.info.orientation, W * k, H * k);
      Render.draw(x, cv.width, cv.height, c, buildInfo(f), { brand: brandFor(f), logo: logoImg(brandFor(f)) },
        { photo: { x: 0, y: 0, w: Math.round(W * k), h: Math.round(H * k) } });
      const d = x.getImageData(0, 0, cv.width, cv.height).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 40) {
        // 纯灰底之外的颜色算「画了东西」，深色带也算
        if (Math.abs(d[i] - 0x8A) > 12 || Math.abs(d[i + 1] - 0x8F) > 12) ink++;
      }
      drawn[lay] = ink;
    }
    return JSON.stringify({ geo: out, ink: drawn, photoW: W, photoH: H });
  })()`));
  const sg = styles.geo;
  ck('四款新版式均不改画布（除 gallery）',
    sg.film.outW === styles.photoW && sg.hud.outW === styles.photoW && sg.edge.outW === styles.photoW);
  ck('gallery 扩画布且标记为 framed', sg.gallery.framed === true && sg.gallery.outW > styles.photoW);
  ck('gallery 底部展签区高 > 侧边卡纸', sg.gallery.outH - styles.photoH > sg.gallery.outW - styles.photoW);
  for (const lay of ['film', 'hud', 'edge', 'gallery']) {
    ck(`${lay} 实际绘制出内容（${styles.ink[lay]} 个采样点）`, styles.ink[lay] > 20);
  }

  /* ---------- 9. 旧配置迁移：1.00× → 1.50×，cornerTicks 丢弃 ---------- */
  const mig = JSON.parse(await ev(`(()=>{
    localStorage.setItem('ecw.cfg.v4', JSON.stringify({layout:'card',fontScale:1,cornerTicks:true,copyright:'© 2026 珠海领行科技'}));
    const c = loadCfg();
    return JSON.stringify({fs:c.fontScale, hasTicks:'cornerTicks' in c, ver:c.cfgVer, copy:c.copyright});})()`));
  console.log(`  · 迁移结果 fontScale=${mig.fs} / 角标键=${mig.hasTicks} / cfgVer=${mig.ver} / 版权="${mig.copy}"`);
  ck('旧配置 1.00× 自动升到 1.50×', mig.fs === 1.5);
  ck('旧配置里的 cornerTicks 已清掉', mig.hasTicks === false);
  ck('旧版权文案被清空', mig.copy === '');

  const exceptionCount = errs.length;
  ck(`0 运行时异常（${exceptionCount}）`, exceptionCount === 0);
  if (exceptionCount) console.log(errs.slice(0, 5).join('\n'));

  spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.message, e.stack); process.exit(1); });
