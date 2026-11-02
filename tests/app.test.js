/* 真机验收（Tauri + WebView2）
 *
 * 两项职责：
 *   1. 绿色版行为：把 exe 单独复制进一个干净目录运行，验证
 *      配置 / 日志 / WebView 缓存全部落在 <exe 同级>/data，
 *      且系统用户目录里不会新建任何文件夹。
 *   2. 既有交互回归：无边框窗口、自绘窗口控制、三档主题、版权预设。
 *
 * 跑法：node tests/app.test.js
 */
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`✗ FAIL  ${name}${extra ? '  → ' + extra : ''}`); }
};

const PORT = 9488;
const RELEASE = path.join(__dirname, '..', 'src-tauri', 'target', 'release');
const LOCALAPPDATA = process.env.LOCALAPPDATA || '';

(async () => {
  /* ---------- 沙箱：模拟「把软件拷到一个干净文件夹」 ---------- */
  const sandbox = path.join(__dirname, '..', 'build-out', '_verify-' + Date.now());
  fs.mkdirSync(sandbox, { recursive: true });
  const exe = path.join(sandbox, '暮呈照片水印工作台.exe');
  fs.copyFileSync(path.join(RELEASE, 'exif-cam.exe'), exe);
  fs.copyFileSync(path.join(RELEASE, 'WebView2Loader.dll'), path.join(sandbox, 'WebView2Loader.dll'));
  const dataDir = path.join(sandbox, 'data');
  console.log(`沙箱目录：${sandbox}`);

  const p = spawn(exe, [], {
    cwd: sandbox,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore'
  });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); targets = await r.json(); if (targets.length) break; } catch (_) {}
    await sleep(500);
  }
  if (!targets || !targets.length) {
    console.error('未能连上 WebView2 调试端口（先确认 build-out 里 exe + WebView2Loader.dll 可运行）');
    process.exit(1);
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (mm, p2 = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p2 })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'ui-shots', name), Buffer.from(r.result.data, 'base64'));
  };
  await send('Runtime.enable'); await send('Page.enable');
  // 首次启动可能要从旧版目录迁移 WebView 数据，多给一点时间
  await sleep(6000);

  /* ---------- 【0】绿色版：数据落点 ---------- */
  console.log('\n【0】绿色版 · 数据全部落在软件自身目录');
  ck('data 目录建在 exe 同级', fs.existsSync(dataDir), dataDir);
  ck('没有在 exe 同级之外另建配置目录', !fs.existsSync(path.join(sandbox, 'config.json')));

  const cfgPath = path.join(dataDir, 'config.json');
  ck('config.json 已生成', fs.existsSync(cfgPath), cfgPath);
  let doc = {};
  try { doc = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) {}
  const kv = doc.kv || {};
  ck('config.json 结构完整（schema / app / kv）',
    doc.schema === 1 && doc.app === '暮呈照片水印工作台' && typeof kv === 'object', JSON.stringify(Object.keys(doc)));
  ck('kv 已镜像当前设置（含 ecw.cfg.v4）', Object.keys(kv).length > 0 && !!kv['ecw.cfg.v4'],
    Object.keys(kv).slice(0, 6).join(',') || '(空)');
  ck('kv 里的配置是合法 JSON 且含版式字段',
    (() => { try { const c = JSON.parse(kv['ecw.cfg.v4'] || '{}'); return !!c.layout && typeof c.fontScale === 'number'; } catch (_) { return false; } })());

  const logPath = path.join(dataDir, 'logs', 'app.log');
  ck('日志文件已生成', fs.existsSync(logPath), logPath);
  const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  ck('日志记录了启动与根目录', /==== 启动/.test(logText) && logText.includes(sandbox), logText.split('\n')[0] || '(空)');

  // WebView2 会在给定的 user data folder 下再建一层 EBWebView
  const wvRoot = path.join(dataDir, 'webview', 'EBWebView');
  ck('WebView2 用户数据在 data/webview/EBWebView', fs.existsSync(path.join(wvRoot, 'Local State')),
    wvRoot);
  ck('localStorage 落在 data/webview 内（leveldb）',
    fs.existsSync(path.join(wvRoot, 'Default', 'Local Storage', 'leveldb')) ||
    fs.existsSync(path.join(wvRoot, 'Default', 'Local Storage')), wvRoot);

  ck('系统用户目录里没有新建产品目录', !fs.existsSync(path.join(LOCALAPPDATA, 'com.mucheng.photo-watermark')),
    path.join(LOCALAPPDATA, 'com.mucheng.photo-watermark'));

  const info = JSON.parse(await ev(`window.__TAURI__.core.invoke('paths_info').then(r=>JSON.stringify(r))`));
  ck('paths_info 的 data 指向 exe 同级', info.data === dataDir, info.data);
  ck('paths_info 的 config 指向 data/config.json', info.config === cfgPath, info.config);
  ck('paths_info 的 root 就是沙箱目录', info.root === sandbox, info.root);

  // 设置面板实际显示
  await ev(`document.getElementById('btnSettings').click()`);
  await sleep(700);
  const shown = JSON.parse(await ev(`JSON.stringify({
    data: document.getElementById('dataPath').textContent.trim(),
    cfg: document.getElementById('cfgPath').textContent.trim(),
    btnData: !!document.getElementById('btnOpenData'),
    btnLog: !!document.getElementById('btnOpenLog') })`));
  ck('设置面板显示真实数据目录', shown.data === dataDir, shown.data);
  ck('设置面板显示配置文件路径', shown.cfg === cfgPath, shown.cfg);
  ck('「打开数据目录 / 查看日志」按钮就位', shown.btnData && shown.btnLog);
  await shot('v11-settings-data.png');
  await ev(`document.getElementById('btnSettings').click()`);
  await sleep(400);

  /* ---------- 之后沿用既有回归（清空本地状态，保证从默认值开始） ---------- */
  await ev(`localStorage.clear()`);
  await ev(`location.href = 'http://tauri.localhost/?demo=1'`);
  await sleep(3600);

  console.log('\n【1】无边框模式已生效');
  const shell = await ev(`document.documentElement.dataset.shell`);
  ck('data-shell=tauri', shell === 'tauri', shell);
  const ctrl = JSON.parse(await ev(`(()=>{const c=document.getElementById('winCtrl');
    const b=id=>{const n=document.getElementById(id).getBoundingClientRect();return Math.round(n.width)+'x'+Math.round(n.height)+'@'+Math.round(n.x)+','+Math.round(n.y);};
    const r=c.getBoundingClientRect();
    return JSON.stringify({hidden:c.hidden, disp:getComputedStyle(c).display, box:Math.round(r.width)+'x'+Math.round(r.height),
      rightGap:Math.round(innerWidth-r.right), min:b('winMin'), max:b('winMax'), close:b('winClose'), inner:[innerWidth,innerHeight]});})()`));
  ck('窗口控制条可见', !ctrl.hidden && ctrl.disp === 'flex', JSON.stringify(ctrl));
  ck('三颗按钮都是 30×28', [ctrl.min, ctrl.max, ctrl.close].every(s => s.startsWith('30x28')), [ctrl.min, ctrl.max, ctrl.close].join(' '));
  ck('控制条距窗口右沿 ≤ 10px', ctrl.rightGap <= 10, String(ctrl.rightGap));
  ck('缩放手柄层已启用', await ev(`!document.getElementById('rzLayer').hidden`));

  console.log('\n【2】最小化 / 最大化 / 还原');
  const before = JSON.parse(await ev(`window.__TAURI__.core.invoke('win_state').then(r=>JSON.stringify(r))`));
  ck('初始未最大化', before.maximized === false, JSON.stringify(before));
  await ev(`document.getElementById('winMax').click()`);
  await sleep(900);
  const afterMax = JSON.parse(await ev(`window.__TAURI__.core.invoke('win_state').then(r=>JSON.stringify(r))`));
  ck('点最大化 → 窗口已最大化', afterMax.maximized === true, JSON.stringify(afterMax));
  ck('body 打上 is-max（图标切还原）', (await ev(`document.body.classList.contains('is-max')`)) === true);
  const winSizeMax = JSON.parse(await ev(`JSON.stringify({w:innerWidth,h:innerHeight,sw:screen.width,sh:screen.height})`));
  ck('最大化后铺满工作区（宽 ≈ 屏幕宽）', Math.abs(winSizeMax.w - winSizeMax.sw) < 40, JSON.stringify(winSizeMax));
  await ev(`document.documentElement.dataset.theme='dark'`);
  await sleep(300);
  await shot('v11-app-max-dark.png');

  await ev(`document.getElementById('winMax').click()`);
  await sleep(900);
  const afterRestore = JSON.parse(await ev(`window.__TAURI__.core.invoke('win_state').then(r=>JSON.stringify(r))`));
  ck('再点 → 还原为普通窗口', afterRestore.maximized === false, JSON.stringify(afterRestore));
  ck('body 去掉 is-max', (await ev(`document.body.classList.contains('is-max')`)) === false);

  console.log('\n【3】主题三档 + 图标切换');
  const seg = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#themeSeg button')].map(b=>b.dataset.themeMode))`));
  ck('设置里是 system / light / dark', seg.length === 3 && seg.join(',') === 'system,light,dark', seg.join(','));
  const state = () => ev(`(()=>{const g=id=>getComputedStyle(document.getElementById(id)).display;
    return JSON.stringify({theme:document.documentElement.dataset.theme, sys:g('thSys'), light:g('thLight'), dark:g('thDark'),
      saved:localStorage.getItem('ecw.theme'), title:document.getElementById('btnTheme').title});})()`).then(JSON.parse);

  await ev(`applyTheme('system')`);
  await sleep(350);
  const s0 = await state();
  ck('跟随系统：显示器图标可见，太阳月亮隐藏',
    s0.sys === 'block' && s0.light === 'none' && s0.dark === 'none', JSON.stringify(s0));

  await ev(`document.getElementById('btnTheme').click()`);
  await sleep(400);
  const s1 = await state();
  ck('点一下 → 浅色（太阳图标显示）', s1.theme === 'light' && s1.light === 'block' && s1.sys === 'none', JSON.stringify(s1));
  ck('浅色偏好已持久化', s1.saved === 'light', String(s1.saved));

  await ev(`document.getElementById('btnTheme').click()`);
  await sleep(400);
  const s2 = await state();
  ck('再点 → 深色（月亮图标显示）', s2.theme === 'dark' && s2.dark === 'block' && s2.light === 'none', JSON.stringify(s2));
  ck('深色偏好已持久化', s2.saved === 'dark', String(s2.saved));
  await shot('v11-app-card-dark.png');

  await ev(`document.getElementById('btnTheme').click()`);
  await sleep(400);
  const s3 = await state();
  ck('第三下回到跟随系统：显示器图标恢复', s3.saved === 'system' && s3.sys === 'block' && s3.light === 'none' && s3.dark === 'none',
    JSON.stringify(s3));

  // 主题改动后 config.json 应同步更新（镜像链路端到端可用）
  await sleep(900);
  let doc2 = {};
  try { doc2 = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) {}
  ck('改主题后 config.json 自动更新', (doc2.kv || {})['ecw.theme'] === 'system', JSON.stringify((doc2.kv || {})['ecw.theme']));

  console.log('\n【3b】设置面板已无品牌 Logo 自定义入口');
  const noLogo = JSON.parse(await ev(`JSON.stringify({input:!!document.getElementById('appLogoInput'),
    thumbs:document.querySelectorAll('.logo-thumb').length, btn:document.querySelectorAll('[data-logo-upload],[data-logo-clear]').length,
    marks:document.querySelectorAll('.logo-mark .logo-def').length})`));
  ck('上传 / 恢复默认控件全部清除', !noLogo.input && noLogo.thumbs === 0 && noLogo.btn === 0, JSON.stringify(noLogo));
  ck('顶栏内置双主题标识仍在', noLogo.marks === 2, String(noLogo.marks));

  console.log('\n【4】版权预设与菜单');
  const pre = await ev(`JSON.stringify([...document.querySelectorAll('#copyPresets .pill')].map(b=>b.textContent.trim()))`);
  ck('版权预设不含「暮呈」', !pre.includes('暮呈') && !/暮呈/.test(pre), pre);

  console.log('\n【5】八向缩放命令');
  const rz = JSON.parse(await ev(`window.__TAURI__.core.invoke('win_start_resize',{dir:'se'}).then(r=>JSON.stringify(r)).catch(e=>JSON.stringify({err:String(e)}))`));
  ck('win_start_resize(se) 正常返回', rz && rz.ok === true, JSON.stringify(rz));
  const rzBad = JSON.parse(await ev(`window.__TAURI__.core.invoke('win_start_resize',{dir:'xx'}).then(r=>JSON.stringify(r))`));
  ck('非法方向被拒', rzBad.ok === false, JSON.stringify(rzBad));
  const rzCount = await ev(`document.querySelectorAll('#rzLayer i').length`);
  ck('八个方向手柄都在', rzCount === 8, String(rzCount));

  console.log('\n【6】重启后配置仍在（持久化闭环）');
  await ev(`applyTheme('dark')`);
  await sleep(900);
  const themeBefore = await ev(`localStorage.getItem('ecw.theme')`);
  // 走正常关闭（内部会先落盘），不用 taskkill 强杀
  await ev(`document.getElementById('winClose').click()`).catch(() => {});
  await sleep(3500);

  const p2 = spawn(exe, [], {
    cwd: sandbox,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9489' },
    stdio: 'ignore'
  });
  let t2;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch('http://127.0.0.1:9489/json/list'); t2 = await r.json(); if (t2.length) break; } catch (_) {}
    await sleep(500);
  }
  ck('重启后界面能正常打开', !!(t2 && t2.length));
  if (t2 && t2.length) {
    const ws2 = new WebSocket(t2[0].webSocketDebuggerUrl);
    await new Promise(r => { ws2.onopen = r; });
    let id2 = 0; const pend2 = new Map();
    ws2.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend2.has(m.id)) { pend2.get(m.id)(m); pend2.delete(m.id); } };
    const send2 = (mm, pp = {}) => new Promise(r => { const i = ++id2; pend2.set(i, r); ws2.send(JSON.stringify({ id: i, method: mm, params: pp })); });
    const ev2 = async x => (await send2('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
    await send2('Runtime.enable');
    await sleep(4500);
    const themeAfter = await ev2(`localStorage.getItem('ecw.theme')`);
    ck('主题偏好在重启后保留', themeAfter === 'dark' && themeBefore === 'dark', `${themeBefore} → ${themeAfter}`);
    const kept = await ev2(`JSON.stringify(Object.keys(Store.snapshot()))`);
    ck('设置项在重启后保留', JSON.parse(kept).length > 0, kept);
    ck('config.json 仍指向同一沙箱', (await ev2(`window.__TAURI__.core.invoke('paths_info').then(r=>r.data)`)) === dataDir);
  }
  spawn('taskkill', ['/pid', String(p2.pid), '/T', '/F'], { stdio: 'ignore' });

  console.log('\n【7】运行时异常');
  const uniq = [...new Set(errs)];
  ck(`0 异常（${uniq.length}）`, uniq.length === 0, uniq.slice(0, 2).join(' | '));

  console.log(`\n合计 ${pass} 通过 / ${fail} 失败`);
  spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(1200);
  if (process.env.KEEP_SANDBOX === '1') {
    console.log(`沙箱保留在：${sandbox}`);
  } else {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (e) { console.log(`沙箱清理失败：${e.message}`); }
  }
  process.exit(fail ? 1 : 0);
})();
