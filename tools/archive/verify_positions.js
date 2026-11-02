/* 形变自检：九宫格 × 四种版式
 * 1) 在纯黑画布上测量文字+Logo 的墨迹包围盒，验证各位置尺寸完全一致
 * 2) 在真实照片上导出 9 宫格 / 4 版式对照图，供人工核对
 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
const PORT = 9383;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const LAYOUTS = ['card', 'banner', 'side', 'minimal'];

const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1600,1000',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-pos'), 'about:blank'], { stdio: 'ignore' });

const HELPERS = `
window.__mk = (make, model) => {
  const info = { make, model, lens: 'RF50mm F1.8 STM', fnum: 1.8, exposure: 1/200, iso: 400,
    focal: 50, focal35: 50, date: '2026:11:01 16:30:12', orientation: 1, ok: true };
  return { info, brand: Brands.detect(info.make, info.model) };
};
window.__inkBox = (ctx, W, H) => {
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i] + d[i+1] + d[i+2] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};
window.__measure = (pos, layout) => {
  const W = 1200, H = 800;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const c = Object.assign({}, cfg, { position: pos, layout, bgStyle: 'none', cornerTicks: false });
  const { info, brand } = window.__mk('Canon', 'Canon EOS R6 Mark II');
  Render.draw(ctx, W, H, c, buildInfo({ info }), { brand, logo: null });
  return window.__inkBox(ctx, W, H);
};
window.__renderWith = async (pos, layout, make, model, over) => {
  const img = await loadImage(window.DEMO_IMAGE);
  const { info, brand } = window.__mk(make, model);
  const W = img.naturalWidth, H = img.naturalHeight;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  Render.drawImageOriented(ctx, img, info.orientation, W, H);
  const c = Object.assign({}, cfg, { position: pos, layout }, over || {});
  Render.draw(ctx, W, H, c, buildInfo({ info }), { brand, logo: null });
  return cv.toDataURL('image/jpeg', 0.92);
};
`;

(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch (_) {}
    await sleep(400);
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a => a.value).join(' '));
  };
  const send = (mm, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
  };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `file:///${ROOT}/index.html?demo=1` });
  await sleep(4000);
  await evalJS(HELPERS);

  const outDir = `${ROOT}/tools/pos-shots`;
  fs.mkdirSync(outDir, { recursive: true });

  // ---- 1. 尺寸一致性 ----
  console.log('== 墨迹包围盒一致性（1200×800，Canon）==');
  const report = {};
  for (const layout of LAYOUTS) {
    const rows = [];
    for (const pos of POSITIONS) {
      const b = await evalJS(`JSON.stringify(window.__measure(${JSON.stringify(pos)}, ${JSON.stringify(layout)}))`);
      rows.push({ pos, box: JSON.parse(b) });
    }
    const sizes = new Set(rows.map(r => r.box ? `${r.box.w}x${r.box.h}` : 'null'));
    report[layout] = { rows, sizes: [...sizes] };
    console.log(`[${layout}] 尺寸集合: ${[...sizes].join(' , ')}  ${sizes.size === 1 ? '✔ 一致' : '✘ 不一致'}`);
    if (sizes.size > 1) rows.forEach(r => console.log('   ', r.pos, JSON.stringify(r.box)));
  }
  fs.writeFileSync(path.join(outDir, 'measure.json'), JSON.stringify(report, null, 2));

  // ---- 2. 真实照片导出 ----
  const cases = [
    ...LAYOUTS.map(l => [`layout-${l}`, l, 'bottom-center', 'Canon', 'Canon EOS R6 Mark II', {}]),
    ...POSITIONS.map(p => [`pos-${p}`, 'card', p, 'Canon', 'Canon EOS R6 Mark II', {}]),
    // 彩色标识：品牌原色 / 智能
    ['color-canon', 'card', 'bottom-left', 'Canon', 'Canon EOS R6 Mark II', { logoVariant: 'brand' }],
    ['color-nikon', 'card', 'bottom-left', 'NIKON CORPORATION', 'NIKON Z 8', { logoVariant: 'brand' }],
    ['color-kodak', 'minimal', 'bottom-left', 'KODAK', 'KODAK PIXPRO', { logoVariant: 'brand' }],
    ['color-huawei', 'banner', 'bottom-left', 'HUAWEI', 'HUAWEI P70', { logoVariant: 'brand' }],
    ['color-xiaomi', 'side', 'middle-left', 'Xiaomi', 'Xiaomi 15 Ultra', { logoVariant: 'brand' }],
    ['auto-light-top', 'minimal', 'top-center', 'NIKON CORPORATION', 'NIKON Z 8', { logoVariant: 'auto' }],
    ['auto-dark-bot', 'minimal', 'bottom-center', 'NIKON CORPORATION', 'NIKON Z 8', { logoVariant: 'auto' }],
    // 自定义竖线 + 文字样式
    ['custom-sep-gold', 'card', 'bottom-left', 'Canon', 'Canon EOS R6 Mark II',
      { sepColorMode: 'custom', sepColor: '#C8A45C', sepStyle: 'gradient', sepWidth: 2.2, sepHeight: 0.95, sepGap: 1.2, sepOpacity: 1 }],
    ['custom-sep-dash', 'side', 'bottom-right', 'SONY', 'ILCE-7M4',
      { sepColorMode: 'custom', sepColor: '#FF4D6D', sepStyle: 'dash', sepWidth: 1.6, sepGap: 1.4 }],
    ['custom-text-red', 'card', 'top-right', 'Canon', 'Canon EOS R6 Mark II',
      { textColor: '#FF6B6B', subColor: '#FFD166', mainSize: 1.25, subSize: 1.1, mainWeight: 700, textTrack: 0.06 }],
    ['custom-textblock', 'minimal', 'bottom-center', 'Canon', 'Canon EOS R6 Mark II',
      { textBlock: '珠海 · 情侣路日落\n50mm · f/1.8 · 1/200s · ISO400\n© 2026 珠海领行科技' }]
  ];
  for (const [name, layout, pos, make, model, over] of cases) {
    const data = await evalJS(`window.__renderWith(${JSON.stringify(pos)}, ${JSON.stringify(layout)}, ${JSON.stringify(make)}, ${JSON.stringify(model)}, ${JSON.stringify(over)})`);
    fs.writeFileSync(path.join(outDir, `${name}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  }
  console.log(`\n已输出 ${cases.length} 张对照图 → tools/pos-shots/`);
  console.log('LOGS:', errs.length ? errs.slice(0, 6).join('\n') : '(无异常)');
  proc.kill(); process.exit(0);
})().catch(e => { console.error('fail', e.message); proc.kill(); process.exit(1); });
