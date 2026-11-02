/* v3 校验：本机字体库 / 下拉可读性 / 默认水印尺寸 / 本机字体渲染 / 预览缩放 */
const fs = require('fs');
const path = require('path');
const PORT = Number(process.env.PORT || 9396);
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (mm, p = {}) => new Promise((res, rej) => {
    const i = ++id;
    const t = setTimeout(() => { pending.delete(i); rej(new Error('timeout ' + mm)); }, 20000);
    pending.set(i, m => { clearTimeout(t); res(m); });
    ws.send(JSON.stringify({ id: i, method: mm, params: p }));
  });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error');
    return r.result?.result?.value;
  };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await sleep(1200);

  /* 1. 本机字体库 + 下拉可读性 */
  const fontInfo = await ev(`(async () => {
    for (let i = 0; i < 50 && !LOCAL_FONTS.length; i++) await new Promise(r => setTimeout(r, 200));
    const opts = [...document.querySelectorAll('#localFontGroup option')];
    const st = getComputedStyle(document.getElementById('fontSelect'));
    const optSt = opts[0] ? getComputedStyle(opts[0]) : null;
    const rgb = c => (c.match(/\\d+/g) || []).map(Number);
    const lum = ([r,g,b]) => { const f = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
    let ratio = null;
    if (optSt) { const a = lum(rgb(optSt.backgroundColor)), b = lum(rgb(optSt.color)); ratio = +(((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2)); }
    return JSON.stringify({
      count: LOCAL_FONTS.length, optionCount: opts.length,
      sample: opts.slice(0, 4).map(o => o.textContent),
      hasPuHui: LOCAL_FONTS.some(f => /普惠/.test(f.name)),
      hasYaHei: LOCAL_FONTS.some(f => /微软雅黑/.test(f.name)),
      groupLabel: document.getElementById('localFontGroup').label,
      colorScheme: st.colorScheme, optBg: optSt && optSt.backgroundColor, optColor: optSt && optSt.color,
      contrast: ratio, hint: document.getElementById('fontHint').textContent
    });
  })()`);
  console.log('[字体库/下拉]', fontInfo);

  /* 2. 默认水印尺寸：1.00× 与 2.00× 应严格 2 倍（证明基准已减半且可放大回来） */
  const size = await ev(`(async () => {
    const img = await loadImage(window.DEMO_IMAGE);
    const W = img.naturalWidth, H = img.naturalHeight;
    const info = { make:'Canon', model:'Canon EOS R6 Mark II', fnum:1.8, exposure:1/200, iso:400, focal:50, date:'2026:11:01 16:30:12', orientation:1, ok:true };
    const brand = Brands.detect(info.make, info.model);
    const cv = document.createElement('canvas'); cv.width=W; cv.height=H;
    const ctx = cv.getContext('2d');
    const mk = (scale) => {
      ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
      const c = Object.assign({}, cfg, { position:'bottom-left', layout:'card', fontScale: scale });
      Render.draw(ctx, W, H, c, { paramText:'50mm · f/1.8 · 1/200s · ISO400', modelShort:'EOS R6 II', copyright: cfg.copyright, info }, { brand, logo:null });
      const d = ctx.getImageData(0,0,W,H).data;
      let x0=1e9,y0=1e9,x1=-1,y1=-1;
      for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const i=(y*W+x)*4; if (d[i]+d[i+1]+d[i+2] > 40) { if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }
      return { w: x1-x0+1, h: y1-y0+1 };
    };
    const a = mk(1), b = mk(2);
    return JSON.stringify({ img: W+'x'+H, at1x: a, at2x: b, ratio: +(b.w/a.w).toFixed(2), widthPctOfImage: +(a.w/W*100).toFixed(1) });
  })()`);
  console.log('[水印尺寸]', size);

  /* 3. 本机字体渲染：只统计水印区域内的像素差异 */
  const fontDiff = await ev(`(async () => {
    const img = await loadImage(window.DEMO_IMAGE);
    const W = 900, H = Math.round(900 * img.naturalHeight / img.naturalWidth);
    const info = { make:'Canon', model:'Canon EOS R6 Mark II', fnum:1.8, exposure:1/200, iso:400, focal:50, date:'2026:11:01 16:30:12', orientation:1, ok:true };
    const brand = Brands.detect(info.make, info.model);
    const cv = document.createElement('canvas'); cv.width=W; cv.height=H;
    const ctx = cv.getContext('2d');
    const paint = (fam) => {
      ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
      const c = Object.assign({}, cfg, { position:'bottom-left', layout:'card', fontFamily: fam, fontScale: 2 });
      Render.draw(ctx, W, H, c, { paramText:'50mm · f/1.8 · 1/200s · ISO400', modelShort:'EOS R6 II', copyright:'© 2026 珠海领行科技', info }, { brand, logo:null });
      return ctx.getImageData(0,0,W,H).data.slice();
    };
    const base = paint('alibaba');
    const cases = ['local:微软雅黑', 'local:宋体', 'local:楷体', 'local:方正舒体'];
    const out = {};
    for (const f of cases) {
      const d = paint(f);
      let n = 0, tot = 0;
      for (let i = 0; i < base.length; i += 4) {
        if (base[i] + base[i+1] + base[i+2] > 30 || d[i] + d[i+1] + d[i+2] > 30) {   // 只比水印笔画所及范围
          tot++;
          if (Math.abs(base[i]-d[i]) > 20 || Math.abs(base[i+1]-d[i+1]) > 20) n++;
        }
      }
      out[f] = +(n / Math.max(1, tot) * 100).toFixed(1) + '%';
    }
    return JSON.stringify(out);
  })()`);
  console.log('[本机字体 vs 普惠体 · 水印区差异]', fontDiff);

  /* 4. 渲染几张成品，供人眼确认字形 */
  const shots = await ev(`(async () => {
    const img = await loadImage(window.DEMO_IMAGE);
    const W = 1400, H = Math.round(1400 * img.naturalHeight / img.naturalWidth);
    const info = { make:'Canon', model:'Canon EOS R6 Mark II', fnum:1.8, exposure:1/200, iso:400, focal:50, date:'2026:11:01 16:30:12', orientation:1, ok:true };
    const brand = Brands.detect(info.make, info.model);
    const cv = document.createElement('canvas'); cv.width=W; cv.height=H;
    const ctx = cv.getContext('2d');
    const paint = (fam) => {
      Render.drawImageOriented(ctx, img, 1, W, H);
      const c = Object.assign({}, cfg, { position:'bottom-left', layout:'card', fontFamily: fam, fontScale: 1 });
      Render.draw(ctx, W, H, c, { paramText:'50mm · f/1.8 · 1/200s · ISO400', modelShort:'EOS R6 II', copyright:'© 2026 珠海领行科技', info }, { brand, logo:null });
      return cv.toDataURL('image/jpeg', 0.9);
    };
    return JSON.stringify({ alibaba: paint('alibaba'), yahei: paint('local:微软雅黑'), kaiti: paint('local:楷体') });
  })()`);
  const dir = path.join(ROOT, 'tools', 'font-shots');
  fs.mkdirSync(dir, { recursive: true });
  for (const [k, v] of Object.entries(JSON.parse(shots))) {
    fs.writeFileSync(path.join(dir, `font-${k}.jpg`), Buffer.from(v.split(',')[1], 'base64'));
  }
  console.log('[成品图] tools/font-shots/ 已输出 3 张');

  /* 5. 预览缩放 */
  const zoom = await ev(`(async () => {
    const img = await loadImage(window.DEMO_IMAGE);
    const info = { make:'Canon', model:'Canon EOS R6 Mark II', fnum:1.8, exposure:1/200, iso:400, focal:50, date:'2026:11:01 16:30:12', orientation:1, ok:true };
    const brand = Brands.detect(info.make, info.model);
    state.files = [{ name:'DEMO.jpg', size:0, buffer:null, info, img, url: img.src, brand }];
    state.cur = 0; renderList(); select(0);
    await new Promise(r => setTimeout(r, 700));
    const c = document.getElementById('preview');
    const before = { zoom: view.zoom, cssW: c.style.width, bmpW: c.width };
    document.getElementById('zoomIn').click(); document.getElementById('zoomIn').click();
    await new Promise(r => setTimeout(r, 600));
    const after = { zoom: +view.zoom.toFixed(3), bmpW: c.width, pct: document.getElementById('zoomPct').textContent };
    document.getElementById('zoomOne').click();
    await new Promise(r => setTimeout(r, 600));
    const one2one = { zoom: +view.zoom.toFixed(3), bmpW: c.width, imgW: img.naturalWidth, cssW: c.style.width };
    document.getElementById('zoomFit').click();
    await new Promise(r => setTimeout(r, 500));
    const fit = { zoom: view.zoom, tf: document.getElementById('cvHolder').style.transform };
    return JSON.stringify({ before, after, one2one, fit });
  })()`);
  console.log('[缩放]', zoom);

  /* 6. 截图（失败不阻塞） */
  try {
    await sleep(600);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'tools', 'v3-window.png'), Buffer.from(shot.result.data, 'base64'));
    await ev(`document.querySelector('.tab[data-tab="text"]').click(); 1`);
    await sleep(700);
    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'tools', 'v3-text-tab.png'), Buffer.from(shot2.result.data, 'base64'));
    console.log('[截图] 已保存 v3-window.png / v3-text-tab.png');
  } catch (e) {
    console.log('[截图] 跳过：' + e.message);
  }

  console.log('[运行期异常]', errs.length ? errs.join(' | ') : '(无)');
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
