/* 开发自检：用多种品牌渲染水印卡片，导出 PNG 供检查 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
const PORT = 9380;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars','--window-size=1600,1000',
  `--remote-debugging-port=${PORT}`,'--user-data-dir=' + path.join(os.tmpdir(),'cdp-rb'),'about:blank'], { stdio: 'ignore' });

const CASES = [
  ['canon',      'Canon',                'Canon EOS R6 Mark II', 'RF50mm F1.8 STM'],
  ['sony',       'SONY',                 'ILCE-7M4',             'FE 35mm F1.4 GM'],
  ['apple',      'Apple',                'iPhone 16 Pro',        'Main Camera 24mm f/1.78'],
  ['hasselblad', 'Hasselblad',           'X2D 100C',             'XCD 55mm F2.5'],
  ['xiaomi',     'Xiaomi',               'Xiaomi 15 Ultra',      'Leica Summilux'],
  ['nikon',      'NIKON CORPORATION',    'NIKON Z 8',            'NIKKOR Z 85mm f/1.2 S'],
  ['omsystem',   'OM Digital Solutions', 'OM-1',                 'M.Zuiko 45mm f/1.2'],
  ['gopro',      'GoPro',                'HERO13 Black',         'Lens 12mm'],
];

(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch(_) {}
    await sleep(400);
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (mm, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `file:///${ROOT}/index.html?demo=1` });
  await sleep(3500);

  const outDir = `${ROOT}/tools/brand-shots`;
  fs.mkdirSync(outDir, { recursive: true });

  for (const [key, make, model, lens] of CASES) {
    const expr = `(async () => {
      const img = await loadImage(window.DEMO_IMAGE);
      const info = { make:${JSON.stringify(make)}, model:${JSON.stringify(model)}, lens:${JSON.stringify(lens)},
        fnum:1.8, exposure:1/250, iso:400, focal:50, focal35:50, date:'2026:11:01 16:30:12', orientation:1, ok:true };
      const brand = Brands.detect(info.make, info.model);
      const { W, H } = orientedSize({ img, info });
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      Render.drawImageOriented(ctx, img, info.orientation, W, H);
      Render.draw(ctx, W, H, cfg, buildInfo({ info }), { brand, logo: null });
      return JSON.stringify({ key: brand.key, hasLogo: Brands.hasOfficial(brand.key), data: cv.toDataURL('image/jpeg', 0.9) });
    })()`;
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const val = r.result?.result?.value;
    if (!val) { console.log(key, 'FAIL', JSON.stringify(r.result?.exceptionDetails?.exception?.description || r.result)); continue; }
    const o = JSON.parse(val);
    fs.writeFileSync(path.join(outDir, `${key}.jpg`), Buffer.from(o.data.split(',')[1], 'base64'));
    console.log(`${key.padEnd(12)} 识别=${o.key.padEnd(12)} 官方标识=${o.hasLogo}`);
  }
  console.log('LOGS:', errs.length ? errs.join('\n') : '(无异常)');
  proc.kill(); process.exit(0);
})().catch(e => { console.error('fail', e.message); process.exit(1); });
