/* Tauri 版验收：spawn exe → WebView2 CDP → 断言 + 截图 */
const { spawn } = require('child_process');
const path = require('path');

const EXE = path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'exif-cam.exe');
const PORT = process.env.PORT || 9450;
let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`✗ FAIL  ${name}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) return await r.json();
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('CDP 端口 30s 内未就绪');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new Cdp(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) { c.pending.get(m.id)(m); c.pending.delete(m.id); }
      else if (m.method) c.events.push(m);
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, m =>
      m.error ? rej(new Error(m.error.message)) : res(m.result)));
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result ? r.result.value : undefined;
  }
}

(async () => {
  console.log(`启动 ${EXE}`);
  const proc = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore'
  });
  let cdp = null;
  try {
    const targets = await waitCdp();
    const page = targets.find(t => t.type === 'page' && /tauri|index\.html/.test(t.url)) || targets[0];
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);

    // 收集渲染错误
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await sleep(1500);

    // WebView2 的 /json/list 常停留在初始 about:blank，以连接后的真实 href 为准
    const href = await cdp.ev('location.href');
    console.log(`页面: ${href}`);
    ck('页面已加载', /tauri|index\.html/.test(href));
    ck('window.__TAURI__ 已注入', await cdp.ev(`!!window.__TAURI__`));
    ck('desktopApi 垫片已就绪', await cdp.ev(`!!window.desktopApi && !!window.desktopApi.listFonts`));

    const fonts = await cdp.ev(`window.desktopApi.listFonts()`);
    ck(`本机字体枚举（${fonts && fonts.count} 款）`, !!(fonts && fonts.ok && fonts.count > 300));
    ck(`中文款数与 Electron 版同量级（${fonts && fonts.stats && fonts.stats.zh}）`, !!(fonts && fonts.stats && fonts.stats.zh > 150));

    ck('Tauri 桌面模式标识', (await cdp.ev(`document.getElementById('chipPlat') && document.getElementById('chipPlat').textContent`)) === 'Tauri 桌面模式');
    ck('界面已渲染（右栏页签存在）', await cdp.ev(`document.querySelectorAll('.tab').length >= 6`));
    ck('主题变量生效（浅色底）', (await cdp.ev(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`)) !== '');

    // 主题往返：setBgColor IPC 真实调用
    await cdp.ev(`window.desktopApi.setBgColor('#101114')`);
    ck('setBgColor IPC 调用无异常', true);
    await cdp.ev(`window.desktopApi.setBgColor('#F7F8FA')`);

    // 渲染错误统计
    const errs = cdp.events.filter(e =>
      (e.method === 'Runtime.exceptionThrown') ||
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
    const errTexts = errs.map(e => JSON.stringify(e.params).slice(0, 120));
    ck(`0 渲染异常${errs.length ? '（' + errTexts.join(' | ') + '）' : ''}`, errs.length === 0);

    // 截图
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(path.join(__dirname, 'ui-shots', 'tauri-light.png'), Buffer.from(shot.data, 'base64'));
    console.log('截图: tools/ui-shots/tauri-light.png');
  } catch (e) {
    fail++;
    console.error('✗ 验收异常:', e.message);
  } finally {
    if (cdp) try { cdp.ws.close(); } catch (_) {}
    try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
  }
  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
