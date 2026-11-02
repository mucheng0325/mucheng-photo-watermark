/* 临时脚本：验证滑杆数值输入的「单位一致性」修复
 * 覆盖：百分比类数值键入、带 % 号输入、超范围提示、点开不改直接回车不跳变
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const EXE = path.join(__dirname, '..', 'build-out', '暮呈照片水印工作台', '暮呈照片水印工作台.exe');
const DIR = path.dirname(EXE);
const PORT = 9493;

const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

(async () => {
  const p = spawn(EXE, [], {
    cwd: DIR,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore'
  });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { targets = await getJSON(`http://127.0.0.1:${PORT}/json/list`); if (targets && targets.length) break; } catch (_) {}
  }
  if (!targets) { console.log('无法连接调试端口'); p.kill(); process.exit(1); }

  const t = targets.find(x => x.type === 'page') || targets[0];
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (mm, pp = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: pp })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;

  await send('Runtime.enable'); await send('Page.enable');
  await new Promise(r => setTimeout(r, 2500));
  await ev(`document.getElementById('settingsDrawer').classList.add('show')`);

  // 在指定按钮上点开输入框、填值、回车，返回结果
  const runCase = (btnId, text) => ev(`(() => {
    const btn = document.getElementById('${btnId}');
    const before = btn.textContent;
    btn.click();
    const inp = document.querySelector('.val-input');
    if (!inp) return { ok: false, err: '未出现输入框' };
    const initText = inp.value;
    inp.value = ${JSON.stringify(text)};
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const sl = document.querySelector('input[type=range][data-cfg="' + btn.dataset.cfgEdit + '"]');
    const st = document.getElementById('statusText');
    return { ok: true, initText, before, after: btn.textContent, slider: sl ? sl.value : '-', status: st ? st.textContent.trim() : '' };
  })()`);

  const cases = [
    ['vFrame',    '1.5',    '1.5%',  '白色边框：输入 1.5 应得 1.5%'],
    ['vFrame',    '2.5%',   '2.5%',  '白色边框：输入 2.5% 应得 2.5%'],
    ['vFrame',    '0.0015', '0.8%',  '白色边框：0.0015 低于下限，应提示并取 0.8%'],
    ['vFrame',    '6',      '6.0%',  '白色边框：输入 6 应得 6.0%'],
    ['vOpacity',  '55',     '55%',   '不透明度：点开不改直接回车应保持 55%'],
    ['vPad',      '3.5',    '3.5%',  '边距：输入 3.5 应得 3.5%']
  ];

  console.log('\n数值输入验证\n' + '='.repeat(56));
  let pass = 0;
  for (const [btn, input, expect, desc] of cases) {
    const r = await runCase(btn, input);
    const ok = r.ok && r.after === expect;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${desc}`);
    console.log(`      输入「${input}」 初始框「${r.initText}」 → 显示「${r.after}」${ok ? '' : `（期望 ${expect}）`}  滑杆=${r.slider}`);
    if (r.status) console.log(`      状态栏：${r.status}`);
  }
  console.log('='.repeat(56));
  console.log(`合计 ${pass} 通过 / ${cases.length - pass} 失败\n`);

  ws.close(); p.kill();
  await new Promise(r => setTimeout(r, 800));
  process.exit(0);
})();
