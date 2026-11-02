/* ============ 暮呈照片水印工作台 · 应用逻辑 ============ */

const el = id => document.getElementById(id);
const setText = (id, t) => { const n = el(id); if (n) n.textContent = t; };
const DEFAULT_CFG = {
  cfgVer: 6,
  layout: 'card',
  position: 'bottom-left',
  accent: '#35E0F0',
  bgStyle: 'glass',
  opacity: 0.55,
  radius: 16,
  padPct: 0.035,
  fontScale: 1.5,
  offsetX: 0,
  offsetY: 0,
  // 白色边框版式
  framePct: 0.03,
  frameColor: '#FFFFFF',
  // 美术馆装裱版式
  galleryPad: 0.062,
  galleryColor: '#F5F1E9',
  // 字体与文字
  fontFamily: 'alibaba',
  numMono: false,
  paramLines: false,
  textColor: '#FFFFFF',
  subColor: '#DCE6F3',
  subOpacity: 0.78,
  mainSize: 1,
  subSize: 1,
  mainWeight: 600,
  subWeight: 400,
  textTrack: 0,
  textBlock: '',
  textShadow: true,
  // 分隔竖线
  sepShow: true,
  sepColorMode: 'accent',
  sepColor: '#35E0F0',
  sepOpacity: 0.85,
  sepWidth: 1,
  sepHeight: 0.82,
  sepGap: 1,
  sepStyle: 'gradient',
  // 参数
  params: { aperture: true, shutter: true, iso: true, focal: true, lens: false, date: false },
  paramOrder: ['aperture', 'shutter', 'iso', 'focal', 'lens', 'date'],
  sep: ' · ',
  dateStyle: 'dot',
  paramLabels: false,
  focalEq: false,
  showModel: true,
  paramOverride: '',
  // 品牌
  logoMode: 'official',
  logoVariant: 'brand',
  brandKey: '',
  logoEdge: 0.6,
  logoShadow: 0.6,
  logoSize: 1,
  showLogo: true,
  logoUpper: true,
  // 版权
  copyright: '',
  showCopyright: true,
  subOverride: '',
  // 输出
  outQuality: 0.92,
  outMaxEdge: 0,
  outPrefix: 'wm_',
  keepExif: true
};

const PRESETS = {
  tech:  { layout: 'card', position: 'bottom-left', accent: '#35E0F0', bgStyle: 'glass', opacity: 0.55, fontScale: 1.5, logoMode: 'official', logoVariant: 'brand', radius: 16, padPct: 0.035, sepShow: true, sepColorMode: 'accent', sepStyle: 'gradient', sepWidth: 1, sepHeight: 0.82, sepOpacity: 0.85 },
  leica: { layout: 'minimal', position: 'bottom-center', accent: '#C8A45C', bgStyle: 'none', opacity: 0.7, fontScale: 1.6, logoMode: 'official', logoVariant: 'brand', padPct: 0.04, sepShow: true, sepColorMode: 'custom', sepColor: '#C8A45C', sepStyle: 'solid', sepWidth: 1.2, sepHeight: 0.9, sepOpacity: 0.95 },
  cyber: { layout: 'side', position: 'middle-right', accent: '#7C5CFF', bgStyle: 'glass', opacity: 0.6, fontScale: 1.5, logoMode: 'official', logoVariant: 'accent', radius: 20, padPct: 0.03, sepShow: true, sepColorMode: 'accent', sepStyle: 'dash', sepWidth: 1.4, sepHeight: 0.85, sepOpacity: 0.9 },
  clean: { layout: 'banner', position: 'bottom-left', accent: '#F5F5F7', bgStyle: 'none', opacity: 0.45, fontScale: 1.35, logoMode: 'official', logoVariant: 'auto', padPct: 0.045, sepShow: true, sepColorMode: 'text', sepStyle: 'solid', sepWidth: 1, sepHeight: 0.8, sepOpacity: 0.6 }
};

const state = { files: [], cur: 0, brandLogos: {}, busy: false };

/* ---------- 配置读写 ---------- */
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.');
  let t = o;
  for (let i = 0; i < ks.length - 1; i++) { t[ks[i]] = t[ks[i]] || {}; t = t[ks[i]]; }
  t[ks[ks.length - 1]] = v;
}
function loadCfg() {
  try {
    // v3 → v4 一次性迁移：官方标识默认从「白色」改为「品牌原色」
    let s = localStorage.getItem('ecw.cfg.v4');
    if (!s) {
      const old = localStorage.getItem('ecw.cfg.v3');
      if (old) {
        try {
          const o = JSON.parse(old);
          if (o && o.logoVariant === 'white') o.logoVariant = 'brand';
          s = JSON.stringify(o);
          localStorage.setItem('ecw.cfg.v4', s);
        } catch (_) {}
      }
    }
    if (!s) return structuredClone(DEFAULT_CFG);
    const saved = JSON.parse(s);
    // v4 → v5：版权默认值改为留空，命中旧内置文案的自动清掉
    if (saved && typeof saved.copyright === 'string' && saved.copyright.trim() === '© 2026 珠海领行科技') saved.copyright = '';
    // v5 → v6：水印默认尺寸从 1.00× 提到 1.50×，旧配置里等于旧默认值的跟着提
    if (saved && saved.cfgVer !== 6) {
      if (saved.fontScale == null || saved.fontScale === 1) saved.fontScale = 1.5;
      delete saved.cornerTicks;              // 科技角标已移除
      saved.cfgVer = 6;
    }
    return Object.assign(structuredClone(DEFAULT_CFG), saved, {
      params: Object.assign({}, DEFAULT_CFG.params, saved.params || {})
    });
  } catch (_) { return structuredClone(DEFAULT_CFG); }
}
let cfg = loadCfg();
let saveTimer = 0;

/* ============ 绿色版持久化层 ============
 * 运行期仍用 localStorage（同步、零改写成本），但做两件事让它「绿色」：
 *   1. 拦截所有 ecw.* 写入，防抖后把整份快照镜像到 <数据目录>/config.json；
 *   2. 启动时若本地 WebView 数据为空（首次运行 / 只把 data 目录拷到新机器），
 *      反过来从 config.json 恢复，凭镜像即可搬家。
 * WebView 的用户数据目录本身也已被钉在 <数据目录>/webview，所以缓存也不会跑到 C 盘。
 * ======================================== */
const Store = {
  PREFIX: 'ecw.',
  timer: 0,
  hooked: false,
  lastErr: '',
  supported() {
    const a = window.desktopApi;
    return !!(a && a.storeLoad && a.storeSave);
  },
  install() {
    if (this.hooked || !this.supported()) return false;
    this.hooked = true;
    const proto = Storage.prototype;
    const rawSet = proto.setItem, rawRemove = proto.removeItem;
    const touch = k => { if (typeof k === 'string' && k.indexOf(Store.PREFIX) === 0) Store.schedule(); };
    proto.setItem = function (k, v) { rawSet.call(this, k, v); touch(k); };
    proto.removeItem = function (k) { rawRemove.call(this, k); touch(k); };
    return true;
  },
  snapshot() {
    const kv = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(this.PREFIX) === 0) kv[k] = localStorage.getItem(k);
      }
    } catch (_) {}
    return kv;
  },
  schedule() {
    if (!this.hooked) return;
    clearTimeout(this.timer);
    // 必须用箭头包一层：直接把 Store.flush 交给 setTimeout 会丢 this
    this.timer = setTimeout(() => Store.flush(), 400);
  },
  async flush() {
    clearTimeout(this.timer);
    if (!this.supported()) return false;
    try {
      const r = await window.desktopApi.storeSave({
        schema: 1,
        app: '暮呈照片水印工作台',
        savedAt: new Date().toISOString(),
        kv: this.snapshot()
      });
      if (r && r.ok === false && r.error !== this.lastErr) {
        this.lastErr = r.error;
        console.warn('配置落盘失败', r.error);
      }
      return !!(r && r.ok);
    } catch (e) {
      console.warn('配置落盘异常', e);
      return false;
    }
  },
  /** 返回恢复的键数量；0 表示镜像里没有可用配置 */
  async hydrate() {
    if (!this.supported()) return 0;
    let r = null;
    try { r = await window.desktopApi.storeLoad(); } catch (_) { return 0; }
    const kv = r && r.kv;
    if (!kv || typeof kv !== 'object') return 0;
    // config.json 是我们主动写的完整快照，比 WebView 缓存更可靠
    // （强杀 / 断电时 localStorage 可能还没刷盘）。空文档才不动本地。
    const usable = Object.keys(kv).filter(k => k.indexOf(this.PREFIX) === 0 && typeof kv[k] === 'string');
    if (!usable.length) return 0;
    let n = 0;
    const hooked = this.hooked;
    this.hooked = false;                     // 恢复过程不回写，避免自己覆盖自己
    for (const k of Object.keys(kv)) {
      if (k.indexOf(this.PREFIX) !== 0 || typeof kv[k] !== 'string') continue;
      try { localStorage.setItem(k, kv[k]); n++; } catch (_) {}
    }
    this.hooked = hooked;
    return n;
  }
};

/** 恢复镜像后重新求值所有「顶层立即求值」的偏好 */
function reloadPrefs() {
  cfg = loadCfg();
  themeMode = (() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return (v === 'light' || v === 'dark') ? v : 'system';
    } catch (_) { return 'system'; }
  })();
  uiColor = (() => { try { return localStorage.getItem(UI_COLOR_KEY) || '#4F6BED'; } catch (_) { return '#4F6BED'; } })();
  FONT_SCOPE = (() => { try { return localStorage.getItem('ecw.fontScope') || 'zh'; } catch (_) { return 'zh'; } })();
}

/** 关键事件落盘（release 无控制台，日志是唯一现场） */
function logEvent(level, msg) {
  const a = window.desktopApi;
  if (!a || !a.logWrite) return;
  try { a.logWrite(level, String(msg).slice(0, 2000)); } catch (_) {}
}
function saveCfg() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('ecw.cfg.v4', JSON.stringify(cfg)); } catch (_) {}
  }, 300);
}

/* ---------- 字体预载 ---------- */
/** 让画布在测量前真正拿到内置字体，否则预览与导出字宽会不一致 */
async function ensureFonts() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all(['400', '500', '600', '700'].map(w =>
      document.fonts.load(`${w} 32px PuHuiTi`).catch(() => {})));
    await document.fonts.ready;
  } catch (_) {}
}

/* ---------- 本机字体库 ---------- */
const BUILTIN_FONTS = [
  { v: 'alibaba', n: '阿里巴巴普惠体 3.0', s: '内置' },
  { v: 'system', n: '系统黑体（Segoe UI / 微软雅黑）', s: '内置' },
  { v: 'serif', n: '宋体 / 思源宋体', s: '内置' },
  { v: 'mono', n: '等宽（科技感数字）', s: '内置' }
];
const BUILTIN_FONT_NAME = {
  alibaba: '阿里巴巴普惠体 3.0', system: '系统黑体', serif: '宋体 / 思源宋体', mono: '等宽'
};
let LOCAL_FONTS = [];          // [{ name, aliases:[], script }]
let FONT_STATS = { zh: 0, ja: 0, ko: 0, latin: 0 };
// 默认只看中文字体：本机字体里大半是西文/日韩，混在一起根本没法挑
let FONT_SCOPE = (() => { try { return localStorage.getItem('ecw.fontScope') || 'zh'; } catch (_) { return 'zh'; } })();
let fontListBuilt = false;

const SCRIPT_GROUP = {
  zh: '中文字体',
  ja: '日文',
  ko: '韩文',
  latin: '西文 / 其他'
};

/** 构建字体浮层列表（首次打开或本机字体载入后重建） */
function renderFontList(q) {
  const box = el('fpList');
  if (!box) return;
  const s = String(q || '').trim().toLowerCase();
  const searching = !!s;
  const frag = document.createDocumentFragment();
  let shown = 0;

  const addItem = (val, name, tag, stack) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fp-item' + (val === cfg.fontFamily ? ' on' : '');
    b.dataset.v = val;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', val === cfg.fontFamily ? 'true' : 'false');
    const n = document.createElement('span');
    n.className = 'fp-n'; n.textContent = name;
    if (stack) n.style.fontFamily = stack;
    const sm = document.createElement('span');
    sm.className = 'fp-s'; sm.textContent = tag;   // 标签固定用界面字体，不被所选字体带歪
    b.append(n, sm);
    b.addEventListener('click', () => applyFont(val));
    frag.appendChild(b);
    shown++;
  };

  const addGroup = title => {
    const h = document.createElement('div');
    h.className = 'fp-group'; h.textContent = title;
    frag.appendChild(h);
  };

  // 内置
  const builtin = BUILTIN_FONTS.filter(f => !s || f.n.toLowerCase().includes(s) || f.v.includes(s));
  if (builtin.length) {
    addGroup('内置（随应用分发）');
    builtin.forEach(f => addItem(f.v, f.n, '内置', Render.resolveFamily(f.v)));
  }

  // 本机：搜索时全库匹配；不搜索时按范围过滤
  let pool = searching
    ? LOCAL_FONTS.filter(f => f.name.toLowerCase().includes(s) || (f.aliases || []).join(' ').toLowerCase().includes(s))
    : (FONT_SCOPE === 'zh' ? LOCAL_FONTS.filter(f => f.script === 'zh') : LOCAL_FONTS);

  // 当前字体被过滤掉时补回列表，避免「已选字体凭空消失」
  if (Render.isLocal(cfg.fontFamily)) {
    const nm = Render.localName(cfg.fontFamily);
    if (!pool.some(f => f.name === nm)) {
      const hit = LOCAL_FONTS.find(f => f.name === nm);
      if (hit) pool = [hit, ...pool];
    }
  }

  let localCount = 0;
  const order = ['zh', 'ja', 'ko', 'latin'];
  for (const sc of order) {
    const arr = pool.filter(f => (f.script || 'latin') === sc);
    if (!arr.length) continue;
    addGroup(`${SCRIPT_GROUP[sc] || '其他'}（${arr.length}）`);
    for (const f of arr) {
      addItem('local:' + f.name, f.name, sc === 'zh' ? '本机' : SCRIPT_GROUP[sc], Render.resolveFamily('local:' + f.name));
      localCount++;
    }
  }

  if (!shown) {
    const e = document.createElement('div');
    e.className = 'fp-empty';
    e.textContent = searching
      ? `没有匹配「${q}」的字体`
      : (LOCAL_FONTS.length ? '该范围内没有字体，试试切到「全部」' : '未读取到本机字体');
    frag.appendChild(e);
  }
  box.innerHTML = '';
  box.appendChild(frag);
  fontListBuilt = true;

  // 底部：区分「本机总数 / 当前范围条数」，搜索时说明已跨全库
  const foot = el('fpFoot');
  if (foot) {
    const zhN = FONT_STATS.zh || LOCAL_FONTS.filter(f => f.script === 'zh').length;
    foot.textContent = searching
      ? `全库匹配 ${localCount} 条（中文 ${zhN} / 共 ${LOCAL_FONTS.length}）`
      : `中文 ${zhN} 款 · 本机共 ${LOCAL_FONTS.length} 款`;
  }
  syncScopeUI();
}

/** 同步范围按钮的选中态与计数 */
function syncScopeUI() {
  const zhN = FONT_STATS.zh || LOCAL_FONTS.filter(f => f.script === 'zh').length;
  setText('fpScopeZh', zhN);
  setText('fpScopeAll', LOCAL_FONTS.length);
  document.querySelectorAll('#fpScope .fp-scope-btn').forEach(b => {
    b.classList.toggle('on', b.dataset.scope === FONT_SCOPE);
  });
}

/** 选定字体 */
function applyFont(val) {
  cfg.fontFamily = val;
  const sel = el('fontSelect');
  if (sel) sel.value = val;
  saveCfg();
  updateFontPreview();
  ensureFonts().then(() => scheduleRender(0));
  closeFontPop();
}

function openFontPop() {
  const pop = el('fpPop'), trg = el('fpTrigger');
  if (!pop || !trg) return;
  renderFontList(el('fontSearch').value || '');
  pop.hidden = false;
  trg.classList.add('open');

  const r = trg.getBoundingClientRect();
  const w = Math.min(320, Math.max(280, r.width + 40));
  pop.style.width = w + 'px';
  pop.style.maxHeight = '';                       // 先放开，量真实内容高度
  const h = pop.offsetHeight;
  const below = window.innerHeight - r.bottom - 12;
  const above = r.top - 12;
  const placeBelow = below >= Math.min(h, 360) || below >= above;
  // 高度必须受视口约束，否则窗口小的时候列表底部会被页脚压住
  const avail = Math.max(200, (placeBelow ? below : above) - 6);
  pop.style.maxHeight = Math.min(avail, h) + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
  pop.style.top = (placeBelow ? r.bottom + 6 : r.top - Math.min(avail, h) - 6) + 'px';

  const cur = pop.querySelector('.fp-item.on');
  if (cur) cur.scrollIntoView({ block: 'center' });
  const search = el('fontSearch');
  if (search) { search.value = ''; search.focus(); }
}

function closeFontPop() {
  const pop = el('fpPop'), trg = el('fpTrigger');
  if (pop) pop.hidden = true;
  if (trg) trg.classList.remove('open');
}

async function loadFontLibrary() {
  const hint = el('fontHint');
  if (!window.desktopApi || !window.desktopApi.listFonts) {
    if (hint) hint.textContent = '浏览器模式无法枚举本机字体；桌面版默认只列中文字体，可切「全部」看日文/西文';
    renderFontList('');
    updateFontPreview();
    return;
  }
  try {
    const r = await window.desktopApi.listFonts();
    if (!r || !r.ok) { if (hint) hint.textContent = '未读取到本机字体，仅可用内置字体'; return; }
    LOCAL_FONTS = r.fonts || [];
    FONT_STATS = r.stats || { zh: 0, ja: 0, ko: 0, latin: 0 };
    const aliasMap = {};
    for (const f of LOCAL_FONTS) if (f.aliases && f.aliases.length) aliasMap[f.name] = f.aliases;
    Render.setLocalFonts(aliasMap);
    renderFontList('');
    if (hint) hint.textContent = `已载入本机 ${r.count} 款字体，其中中文 ${FONT_STATS.zh || 0} 款（扫描 ${r.scanned} 个字体文件）`;
    syncUI();
  } catch (e) {
    if (hint) hint.textContent = '读取本机字体失败：' + (e.message || e);
  }
  updateFontPreview();
}

/** 刷新触发按钮文字、字形预览条 */
function updateFontPreview() {
  const stack = Render.resolveFamily(cfg.fontFamily);
  const pv = el('fontPreview');
  if (pv) pv.style.fontFamily = stack;

  const isLocal = Render.isLocal(cfg.fontFamily);
  const label = isLocal ? Render.localName(cfg.fontFamily) : (BUILTIN_FONT_NAME[cfg.fontFamily] || '阿里巴巴普惠体 3.0');
  setText('vFontName', label);
  setText('fpLabel', label);     // 按钮标签保持界面字体，字形由下方预览条展示

  const sel = el('fontSelect');
  if (sel && sel.value !== cfg.fontFamily) sel.value = cfg.fontFamily;
}

/* ---------- UI 同步 ---------- */
function syncUI() {
  document.querySelectorAll('[data-cfg]').forEach(node => {
    const key = node.dataset.cfg;
    const v = getPath(cfg, key);
    if (node.classList.contains('seg') || node.tagName === 'BUTTON') return;
    if (node.type === 'checkbox') node.checked = !!v;
    else if (node.type === 'range') node.value = v;
    else node.value = v == null ? '' : v;
  });
  // 分段控件高亮
  document.querySelectorAll('.seg button[data-cfg]').forEach(b => {
    b.classList.toggle('on', String(getPath(cfg, b.dataset.cfg)) === b.dataset.val);
  });
  // 布局
  document.querySelectorAll('.layout-btn').forEach(b => b.classList.toggle('active', b.dataset.layout === cfg.layout));
  // 只对某些版式有意义的字段：data-lay 列出可用版式
  document.querySelectorAll('[data-lay]').forEach(n => {
    n.hidden = !n.dataset.lay.split(/\s+/).includes(cfg.layout);
  });
  // 位置
  document.querySelectorAll('.pos-grid button').forEach(b => b.classList.toggle('on', b.dataset.pos === cfg.position));
  // 色板
  // 只标记「水印主题色」那排色板；.sw 是两排色板共用的类名，不加作用域会把界面色板的选中态清掉
  document.querySelectorAll('#swatches .sw').forEach(b => b.classList.toggle('active', normHex(b.style.getPropertyValue('--c').trim()) === normHex(cfg.accent)));
  el('accentPicker').value = cfg.accent;
  // 数值标签
  const pct = v => Math.round(v * 100) + '%';
  el('vOpacity').textContent = pct(cfg.opacity);
  el('vRadius').textContent = cfg.radius;
  el('vPad').textContent = (cfg.padPct * 100).toFixed(1) + '%';
  el('vFont').textContent = cfg.fontScale.toFixed(2) + '×';
  el('vFrame').textContent = (cfg.framePct * 100).toFixed(1) + '%';
  el('vLogo').textContent = cfg.logoSize.toFixed(2) + '×';
  el('vDX').textContent = cfg.offsetX + '%';
  el('vDY').textContent = cfg.offsetY + '%';
  el('vQuality').textContent = pct(cfg.outQuality);
  el('vMain').textContent = cfg.mainSize.toFixed(2) + '×';
  el('vSub').textContent = cfg.subSize.toFixed(2) + '×';
  el('vTrack').textContent = cfg.textTrack.toFixed(2);
  el('vSubOp').textContent = pct(cfg.subOpacity);
  el('vEdge').textContent = cfg.logoEdge.toFixed(2);
  el('vLgShadow').textContent = cfg.logoShadow.toFixed(2);
  el('vSepColor').textContent = cfg.sepColor.toUpperCase();
  el('vSepW').textContent = cfg.sepWidth.toFixed(2) + '×';
  el('vSepH').textContent = pct(cfg.sepHeight);
  el('vSepGap').textContent = cfg.sepGap.toFixed(2) + '×';
  el('vSepOp').textContent = pct(cfg.sepOpacity);
  const sepField = el('sepColorField');
  if (sepField) sepField.style.opacity = cfg.sepColorMode === 'custom' ? '1' : '.55';
  // 自绘下拉的显示文本跟随配置
  document.querySelectorAll('select[data-cfg][data-upgraded]').forEach(s => { if (s._syncLabel) s._syncLabel(); });
  updateFontPreview();
}
const normHex = h => (h || '').toLowerCase().replace(/\s/g, '');

/* ---------- 事件绑定 ---------- */
function bindControls() {
  document.querySelectorAll('input[data-cfg],select[data-cfg],textarea[data-cfg]').forEach(node => {
    node.addEventListener('input', () => {
      const key = node.dataset.cfg;
      let v;
      if (node.type === 'checkbox') v = node.checked;
      else if (node.type === 'range') v = parseFloat(node.value);
      else if (node.tagName === 'SELECT' && key === 'outMaxEdge') v = parseInt(node.value, 10);
      else v = node.value;
      setPath(cfg, key, v);
      // 直接挑竖线颜色 → 自动切到「自定义」模式
      if (key === 'sepColor' && cfg.sepColorMode !== 'custom') cfg.sepColorMode = 'custom';
      syncUI(); saveCfg();
      if (key === 'fontFamily') { updateFontPreview(); ensureFonts().then(() => scheduleRender(0)); }
      else scheduleRender();
    });
    node.addEventListener('change', () => {
      if (node.type === 'checkbox' || node.tagName === 'SELECT') node.dispatchEvent(new Event('input'));
    });
  });

  document.querySelectorAll('.seg button[data-cfg]').forEach(b => {
    b.addEventListener('click', () => {
      setPath(cfg, b.dataset.cfg, isNaN(+b.dataset.val) ? b.dataset.val : +b.dataset.val);
      syncUI(); saveCfg(); scheduleRender();
    });
  });

  document.querySelectorAll('.layout-btn').forEach(b => {
    b.addEventListener('click', () => { cfg.layout = b.dataset.layout; syncUI(); saveCfg(); scheduleRender(); });
  });

  document.querySelectorAll('.pos-grid button').forEach(b => {
    b.addEventListener('click', () => { cfg.position = b.dataset.pos; syncUI(); saveCfg(); scheduleRender(); });
  });

  document.querySelectorAll('[data-sep-preset]').forEach(b => {
    b.addEventListener('click', () => {
      cfg.sepColor = b.dataset.sepPreset; cfg.sepColorMode = 'custom';
      syncUI(); saveCfg(); scheduleRender();
    });
  });

  document.querySelectorAll('.sw').forEach(b => {
    b.addEventListener('click', () => {
      cfg.accent = b.style.getPropertyValue('--c').trim();
      syncUI(); saveCfg(); scheduleRender();
    });
  });
  el('accentPicker').addEventListener('input', e => { cfg.accent = e.target.value; syncUI(); saveCfg(); scheduleRender(); });

  // Tab 切换
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
      t.classList.add('active');
      document.querySelector(`.pane[data-pane="${t.dataset.tab}"]`).classList.add('active');
    });
  });

  // 导入
  el('btnFiles').onclick = () => el('fileInput').click();
  el('btnFolder').onclick = () => el('folderInput').click();
  el('fileInput').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  el('folderInput').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };

  // 拖放
  const dz = el('dropzone');

  // 点击拖拽区 → 打开文件选择（含键盘可达）
  const openFilePicker = () => el('fileInput').click();
  if (dz) {
    dz.addEventListener('click', openFilePicker);
    dz.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilePicker(); }
    });
  }
  const dzFolder = el('dzFolder');
  if (dzFolder) {
    dzFolder.addEventListener('click', e => { e.stopPropagation(); el('folderInput').click(); });
  }
  ;['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault(); dz.classList.add('over');
    const col = el('colList'); if (col) col.classList.add('over');   // 整块左栏描边高亮
  }));
  ;['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => {
    if (ev === 'dragleave' && e.relatedTarget) return;
    dz.classList.remove('over');
    const col = el('colList'); if (col) col.classList.remove('over');
  }));
  document.addEventListener('drop', async e => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    const files = [];
    const items = e.dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const entries = [...items].map(i => i.webkitGetAsEntry()).filter(Boolean);
      for (const en of entries) await walkEntry(en, files);
    } else {
      files.push(...e.dataTransfer.files);
    }
    addFiles(files);
  });

  // 导出 / 帮助 / 预设
  el('btnExport').onclick = exportAll;
  el('btnHelp').onclick = () => el('helpModal').classList.add('show');
  el('btnTheme').onclick = () => {
    const order = ['system', 'light', 'dark'];
    const names = { system: '跟随系统', light: '浅色', dark: '深色' };
    const next = order[(order.indexOf(themeMode) + 1) % order.length] || 'system';
    applyTheme(next);
    toast('界面主题：' + names[next]);
  };
  el('btnCloseHelp').onclick = () => el('helpModal').classList.remove('show');
  el('helpModal').addEventListener('click', e => { if (e.target.id === 'helpModal') el('helpModal').classList.remove('show'); });

  document.querySelectorAll('[data-preset]').forEach(b => {
    b.onclick = () => { Object.assign(cfg, PRESETS[b.dataset.preset]); syncUI(); saveCfg(); scheduleRender(); toast('已套用预设：' + b.textContent); };
  });
  el('btnReset').onclick = () => { cfg = structuredClone(DEFAULT_CFG); syncUI(); saveCfg(); scheduleRender(); toast('已恢复默认配置'); };
  el('btnSavePreset').onclick = () => {
    const list = JSON.parse(localStorage.getItem('ecw.presets.v1') || '[]');
    list.push({ name: '自定义 ' + (list.length + 1), cfg: structuredClone(cfg) });
    localStorage.setItem('ecw.presets.v1', JSON.stringify(list));
    toast('当前配置已存为自定义预设（' + list.length + '）');
  };

  // 版权模板
  document.querySelectorAll('[data-copytpl]').forEach(b => {
    b.onclick = () => {
      let tpl = b.dataset.copytpl;
      tpl = tpl.replace('{year}', new Date().getFullYear())
               .replace('{name}', '南宫大人')
               .replace('{model}', state.files[state.cur]?.info?.model || 'CAMERA');
      cfg.copyright = tpl; syncUI(); saveCfg(); scheduleRender();
    };
  });

  // Logo 上传
  el('btnUploadLogo').onclick = () => el('logoInput').click();
  el('logoInput').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const b = state.files[state.cur];
    if (!b) return toast('先导入照片以确定品牌');
    const url = await fileToDataURL(f);
    state.brandLogos[b.brand.key] = url;
    saveBrandLogos();
    toast('已为 ' + b.brand.name + ' 设置专属 Logo');
    scheduleRender();
  };
  el('btnClearLogo').onclick = () => {
    const b = state.files[state.cur]; if (!b) return;
    delete state.brandLogos[b.brand.key];
    saveBrandLogos(); toast('已清除 ' + b.brand.name + ' 的 Logo'); scheduleRender();
  };

  const btnDir = el('btnChangeDir');
  if (btnDir) btnDir.onclick = async () => {
    Saver.dir = null; Saver.dirHandle = null;
    const ok = await Saver.pick(true).catch(() => false);
    toast(ok ? '已切换输出目录' : '未选择目录，导出时将再次询问');
  };

  el('btnPrev').onclick = () => select(state.cur - 1);
  el('btnNext').onclick = () => select(state.cur + 1);
  window.addEventListener('resize', () => scheduleRender(120));

  bindZoom();
  bindFontPicker();
}

/* ---------- 预览缩放交互 ---------- */
function bindZoom() {
  const wrap = el('canvasWrap');
  const holder = el('cvHolder');

  // 以鼠标位置为锚点缩放
  wrap.addEventListener('wheel', e => {
    if (!state.files.length) return;
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    const ax = e.clientX - r.left - r.width / 2;
    const ay = e.clientY - r.top - r.height / 2;
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    setZoom(view.zoom * factor, ax, ay);
  }, { passive: false });

  // 拖拽平移
  let drag = null;
  wrap.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !state.files.length) return;
    if (e.target.closest && e.target.closest('.zoom-hud')) return;
    drag = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, moved: false };
    try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
    holder.classList.add('dragging');
  });
  wrap.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    view.x = drag.ox + dx;
    view.y = drag.oy + dy;
    applyView();
  });
  const endDrag = e => {
    if (!drag) return;
    drag = null;
    holder.classList.remove('dragging');
    try { wrap.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);

  // 双击复位
  wrap.addEventListener('dblclick', e => {
    if (!state.files.length || (e.target.closest && e.target.closest('.zoom-hud'))) return;
    resetView();
  });

  el('zoomIn').onclick = () => setZoom(view.zoom * 1.25);
  el('zoomOut').onclick = () => setZoom(view.zoom / 1.25);
  el('zoomFit').onclick = () => resetView();
  el('zoomOne').onclick = () => {
    if (!state.files.length) return;
    const fit = state.fitK || 1;
    setZoom(1 / fit);          // 一个图片像素 = 一个屏幕像素
  };

  // 键盘：+ / - / 0 / 1
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (!state.files.length) return;
    if (e.key === '+' || e.key === '=') { setZoom(view.zoom * 1.25); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { setZoom(view.zoom / 1.25); e.preventDefault(); }
    else if (e.key === '0') { resetView(); e.preventDefault(); }
    else if (e.key === '1') { setZoom(1 / (state.fitK || 1)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { select(state.cur - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { select(state.cur + 1); e.preventDefault(); }
  });

  // 全局快捷键：Ctrl+O 导入 / Ctrl+E 导出（有输入焦点在文本框时不抢）
  window.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.shiftKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (k === 'o') { e.preventDefault(); el('fileInput').click(); }
    else if (k === 'e') { e.preventDefault(); exportAll(); }
  });
}

/* ---------- 通用下拉自绘化 ----------
 * Windows 原生下拉面板由系统绘制，深色主题下容易出现「白底浅字」。
 * 这里把普通 select 换成按钮 + 自绘列表，原生 select 仍保留作为数据载体。
 */
function upgradeSelects() {
  document.querySelectorAll('select[data-cfg]').forEach(sel => {
    if (sel.id === 'fontSelect' || sel.dataset.upgraded) return;
    sel.dataset.upgraded = '1';
    sel.classList.add('native-hidden');

    const trg = document.createElement('button');
    trg.type = 'button';
    trg.className = 'fp-trigger sm';
    trg.innerHTML = '<span class="fp-current"></span><span class="fp-caret"></span>';
    sel.parentNode.insertBefore(trg, sel.nextSibling);
    sel.dataset.trigger = 'pick-' + Math.random().toString(36).slice(2, 8);
    trg.dataset.forSel = sel.dataset.trigger;

    const syncLabel = () => {
      const opt = sel.options[sel.selectedIndex];
      trg.querySelector('.fp-current').textContent = opt ? opt.textContent : '—';
    };
    sel._syncLabel = syncLabel;
    syncLabel();

    trg.addEventListener('click', e => {
      e.stopPropagation();
      openPickPop(sel, trg);
    });
  });
}

let pickTarget = null;

function openPickPop(sel, trg) {
  const pop = el('pickPop'), list = el('pickList');
  if (!pop || !list) return;
  if (!pop.hidden && pickTarget === sel) { closePickPop(); return; }

  pickTarget = sel;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  [...sel.options].forEach((opt, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fp-item' + (i === sel.selectedIndex ? ' on' : '');
    const n = document.createElement('span');
    n.className = 'fp-n';
    n.textContent = opt.textContent;
    b.appendChild(n);
    b.addEventListener('click', () => {
      sel.selectedIndex = i;
      if (sel._syncLabel) sel._syncLabel();
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      closePickPop();
    });
    frag.appendChild(b);
  });
  list.appendChild(frag);

  pop.hidden = false;
  trg.classList.add('open');
  const r = trg.getBoundingClientRect();
  const w = Math.max(180, r.width);
  pop.style.width = w + 'px';
  const h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
  pop.style.top = (r.bottom + 6 + h > window.innerHeight - 8 ? r.top - h - 6 : r.bottom + 6) + 'px';
}

function closePickPop() {
  const pop = el('pickPop');
  if (pop) pop.hidden = true;
  document.querySelectorAll('.fp-trigger.open').forEach(n => {
    if (n.dataset.forSel) n.classList.remove('open');
  });
  pickTarget = null;
}

/* ---------- 字体选择器 ---------- */
function bindFontPicker() {
  const trg = el('fpTrigger');
  const pop = el('fpPop');
  if (trg) {
    trg.addEventListener('click', e => {
      e.stopPropagation();
      if (pop && pop.hidden) openFontPop(); else closeFontPop();
    });
  }
  const search = el('fontSearch');
  if (search) {
    search.addEventListener('input', () => renderFontList(search.value));
    search.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeFontPop(); return; }
      if (e.key === 'Enter') {
        const first = el('fpList').querySelector('.fp-item');
        if (first) applyFont(first.dataset.v);
      }
    });
  }

  // 范围切换：中文字体 / 全部
  document.querySelectorAll('#fpScope .fp-scope-btn').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const sc = b.dataset.scope === 'all' ? 'all' : 'zh';
      if (sc === FONT_SCOPE) return;
      FONT_SCOPE = sc;
      try { localStorage.setItem('ecw.fontScope', sc); } catch (_) {}
      const s = el('fontSearch');
      if (s) s.value = '';
      renderFontList('');
      if (!el('fpPop').hidden) {
        const cur = el('fpList').querySelector('.fp-item.on');
        if (cur) cur.scrollIntoView({ block: 'nearest' });
      }
    });
  });
  // 点到外面 / 按 Esc 收起
  document.addEventListener('pointerdown', e => {
    if (pop && !pop.hidden) {
      if (!pop.contains(e.target) && !(trg && trg.contains(e.target))) closeFontPop();
    }
    const pk = el('pickPop');
    if (pk && !pk.hidden) {
      const t = e.target;
      if (!pk.contains(t) && !(t.closest && t.closest('.fp-trigger'))) closePickPop();
    }
  }, true);
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const pk = el('pickPop');
    if (pk && !pk.hidden) { closePickPop(); return; }
    if (pop && !pop.hidden) closeFontPop();
  });
  // 窗口尺寸变化时关闭，避免浮层飘走
  window.addEventListener('resize', () => { closeFontPop(); closePickPop(); });
}

/* ---------- 文件导入 ---------- */
async function walkEntry(entry, out) {
  if (entry.isFile) {
    const f = await new Promise((res, rej) => entry.file(res, rej));
    if (/image\/(jpeg|png|webp)/i.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)) out.push(f);
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = await new Promise(res => reader.readEntries(res));
    for (const e of entries) await walkEntry(e, out);
  }
}

async function addFiles(list) {
  const imgs = list.filter(f => /\.(jpe?g|png|webp)$/i.test(f.name) || /^image\//.test(f.type));
  if (!imgs.length) return toast('没有可用的图片文件');
  toast(`读取 ${imgs.length} 张照片…`);
  for (const f of imgs) {
    try {
      const buffer = await f.arrayBuffer();
      const info = Exif.read(buffer);
      const url = URL.createObjectURL(f);
      const img = await loadImage(url);
      const brand = Brands.detect(info.make, info.model);
      state.files.push({ name: f.name, size: f.size, buffer, info, img, url, brand });
    } catch (err) {
      console.warn('读取失败', f.name, err);
    }
  }
  renderList();
  if (state.files.length && state.cur < 0) select(0);
  else if (state.files.length === imgs.length) select(0);
  else scheduleRender();
  toast(`已导入 ${state.files.length} 张`);
  syncChips();
}

function renderList() {
  const box = el('fileList');
  box.innerHTML = '';
  state.files.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'file-item' + (i === state.cur ? ' active' : '');
    d.innerHTML = `<img src="${f.url}" alt=""><div><div class="fi-name">${escapeHtml(f.name)}</div>
      <div class="fi-sub">${escapeHtml(brief(f))}</div></div>`;
    d.onclick = () => select(i);
    box.appendChild(d);
  });
  setText('listMeta', state.files.length ? `${state.files.length} 张` : '未导入');
}
function brief(f) {
  const i = f.info;
  const p = [i.fnum && Exif.fmt.aperture(i.fnum), i.exposure && Exif.fmt.shutter(i.exposure), i.iso && Exif.fmt.iso(i.iso), i.focal && Exif.fmt.focal(i.focal)]
    .filter(Boolean).join(' ');
  return p || (i.ok ? f.brand.name : '无 EXIF');
}
/** 可靠加载图片：用 onload/onerror，避免 Electron 下 img.decode() 偶发挂起 */
function loadImage(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('图片加载超时')); } }, timeout);
    img.onload = () => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (!img.naturalWidth) return reject(new Error('图片尺寸为空'));
      resolve(img);
    };
    img.onerror = () => {
      if (done) return;
      done = true; clearTimeout(timer);
      reject(new Error('图片解码失败'));
    };
    img.src = url;
  });
}

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function select(i) {
  if (!state.files.length) return;
  state.cur = (i + state.files.length) % state.files.length;
  document.querySelectorAll('.file-item').forEach((n, k) => n.classList.toggle('active', k === state.cur));
  const f = state.files[state.cur];
  const hint = el('hint'); if (hint) hint.style.display = 'none';
  el('preview').classList.add('ready');
  el('zoomHud').classList.add('show');
  view.zoom = 1; view.x = 0; view.y = 0;      // 换图复位视图
  setText('previewMeta', f.name);
  setText('fileInfo', `${f.brand.name} · ${f.info.model || '未知机型'}`);
  setText('chipBrand', brandFor(f).name);
  updateBrandCard(f);
  scheduleRender();
}

/** 水印品牌：手动指定优先，否则跟随照片 EXIF */
function brandFor(f) {
  if (cfg.brandKey) {
    const b = Brands.LIST.find(x => x.key === cfg.brandKey);
    if (b) return b;
  }
  return f.brand;
}

/** 徽章字色按底色亮度自动黑白，保证浅色品牌色（佳能红白/苹果银）也看得清 */
function badgeFg(hex) {
  try {
    const { r, g, b } = hexToRgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62 ? '#101114' : '#fff';
  } catch (_) { return '#fff'; }
}

function updateBrandCard(f) {
  const b = brandFor(f);
  el('brandBadge').textContent = b.mono || '◎';
  el('brandBadge').style.background = b.color || '#9AA6B8';
  el('brandBadge').style.color = badgeFg(b.color || '#9AA6B8');
  el('brandName').textContent = b.name;
  const model = f.info.model || (f.info.ok ? '已识别' : '未读取到 EXIF');
  el('brandModel').textContent = (cfg.brandKey ? '手动指定 · ' : '') + model;
}

/* ---------- 品牌选择下拉 ---------- */
function renderBrandPop() {
  const pop = el('brandPop');
  if (!pop) return;
  const cur = cfg.brandKey || '';
  const items = [['', '自动识别', '◎', '#9AA6B8', '跟随照片 EXIF']]
    .concat(Brands.LIST.map(b => [b.key, b.name, b.mono, b.color, '']));
  pop.innerHTML = items.map(([k, name, mono, color, hint]) => `
    <button type="button" class="bp-item${k === cur ? ' on' : ''}" data-key="${k}">
      <span class="bp-badge" style="background:${color};color:${badgeFg(color)}">${mono || '◎'}</span>
      <span class="bp-name">${name}${hint ? ` <small class="muted">${hint}</small>` : ''}</span>
      ${k === cur ? '<span class="bp-check">✓</span>' : ''}
    </button>`).join('');
}

function bindBrandPicker() {
  const card = el('brandCard'), pop = el('brandPop');
  if (!card || !pop) return;
  card.onclick = () => {
    if (pop.hidden) renderBrandPop();
    pop.hidden = !pop.hidden;
  };
  card.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.onclick(); } };
  pop.addEventListener('click', e => {
    const it = e.target.closest('.bp-item');
    if (!it) return;
    cfg.brandKey = it.dataset.key || '';
    saveCfg();
    pop.hidden = true;
    const f = state.files[state.cur];
    if (f) {
      updateBrandCard(f);
      setText('chipBrand', brandFor(f).name);
      scheduleRender();
    }
    toast(cfg.brandKey ? '水印品牌：' + brandFor(f).name : '水印品牌：自动识别');
  });
  document.addEventListener('pointerdown', e => {
    if (!pop.hidden && !e.target.closest('#brandWrap')) pop.hidden = true;
  });
}

function syncChips() {
  setText('chipCount', `${state.files.length} 张素材`);
  if (window.desktopApi) el('chipPlat').textContent = window.__TAURI__ ? 'Tauri 桌面模式' : 'Electron 桌面模式';
}

/* ---------- 预览渲染 ---------- */
let rafTimer = 0;
function scheduleRender(delay = 16) {
  clearTimeout(rafTimer);
  rafTimer = setTimeout(renderPreview, delay);
}

/* 预览缩放：zoom 为「相对适配窗口」的倍率，x/y 为屏幕像素平移 */
const view = { zoom: 1, x: 0, y: 0 };
const ZOOM_MIN = 0.1, ZOOM_MAX = 12;
let zoomTimer = 0;

function applyView() {
  const h = el('cvHolder');
  if (!h) return;
  h.style.transform = `translate(-50%,-50%) translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
  h.classList.toggle('zoomed', view.zoom > 1.001);
  setText('zoomPct', Math.round(view.zoom * 100) + '%');
  setText('zoomInfo', `${Math.round(view.zoom * 100)}%  ·  ${state.pxInfo || ''}`.trim());
  const hud = el('zoomHud');
  if (hud && state.files.length) hud.classList.add('show');
}

/** 以容器中心为原点的锚点缩放，ax/ay 为相对中心坐标 */
function setZoom(z, ax, ay) {
  const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  if (Math.abs(next - view.zoom) < 1e-4) return;
  const k = next / view.zoom;
  if (ax != null && ay != null) {
    view.x = ax - (ax - view.x) * k;
    view.y = ay - (ay - view.y) * k;
  }
  view.zoom = next;
  applyView();
  // 缩放停下后再按新倍率重渲染，避免连续滚动时反复重绘大图
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(renderPreview, 220);
}

function resetView() {
  view.zoom = 1; view.x = 0; view.y = 0;
  applyView();
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(renderPreview, 30);
}

let previewCanvas, exportCanvas;

/** 场景几何：白色边框版式会把画布撑大，k 为整体缩放（1 = 输出尺寸） */
function sceneOf(f, k) {
  const { W, H } = orientedSize(f);
  const g = Render.frameGeom(cfg, W, H);
  return {
    g,
    outW: Math.round(g.outW * k),
    outH: Math.round(g.outH * k),
    px: Math.round(g.side * k),
    py: Math.round(g.side * k),
    pw: Math.max(1, Math.round(W * k)),
    ph: Math.max(1, Math.round(H * k))
  };
}

/** 铺底 + 照片 + 水印：预览与导出共用同一套坐标，保证所见即所得 */
function paintScene(ctx, f, sc) {
  const { brand, logo } = { brand: brandFor(f), logo: logoImg(brandFor(f)) };
  ctx.clearRect(0, 0, sc.outW, sc.outH);
  if (sc.g.framed) {
    ctx.save();
    ctx.fillStyle = sc.g.bg || cfg.frameColor || '#FFFFFF';
    ctx.fillRect(0, 0, sc.outW, sc.outH);
    ctx.restore();
  }
  ctx.save();
  ctx.translate(sc.px, sc.py);
  Render.drawImageOriented(ctx, f.img, f.info.orientation, sc.pw, sc.ph);
  ctx.restore();
  Render.draw(ctx, sc.outW, sc.outH, cfg, buildInfo(f), { brand, logo },
    { photo: { x: sc.px, y: sc.py, w: sc.pw, h: sc.ph } });
}

function renderPreview() {
  const f = state.files[state.cur];
  if (!f) return;
  const wrap = el('canvasWrap');
  const { W, H } = orientedSize(f);
  const g = Render.frameGeom(cfg, W, H);
  const maxW = Math.max(320, wrap.clientWidth - 36);
  const maxH = Math.max(240, wrap.clientHeight - 36);
  const fitK = Math.min(maxW / g.outW, maxH / g.outH, 1);
  const fitW = Math.max(1, Math.round(g.outW * fitK));
  const fitH = Math.max(1, Math.round(g.outH * fitK));

  // 渲染分辨率随缩放提升（不超过原图，长边上限 3200），放大看细节不糊
  const want = Math.min(1, fitK * Math.max(1, view.zoom));
  const rk = Math.max(0.02, Math.min(want, 3200 / Math.max(g.outW, g.outH)));
  const sc = sceneOf(f, rk);

  const c = el('preview');
  if (c.width !== sc.outW || c.height !== sc.outH) { c.width = sc.outW; c.height = sc.outH; }
  c.style.width = fitW + 'px';
  c.style.height = fitH + 'px';
  c.classList.add('ready');
  paintScene(c.getContext('2d'), f, sc);

  state.fitK = fitK;
  state.pxInfo = `${g.outW}×${g.outH}`;
  applyView();
}

function orientedSize(f) {
  const o = f.info.orientation || 1;
  const w = f.img.naturalWidth, h = f.img.naturalHeight;
  return (o >= 5 && o <= 8) ? { W: h, H: w } : { W: w, H: h };
}

function buildInfo(f) {
  const i = f.info;
  const auto = Exif.paramLine(i, cfg);
  const paramText = (cfg.paramOverride || '').trim() || auto;
  const modelShort = Brands.modelShort(i.make, i.model);
  const sub = (cfg.subOverride || '').trim();
  return {
    paramText,
    modelShort: sub ? '' : modelShort,
    copyright: sub ? sub : (cfg.showCopyright ? cfg.copyright : ''),
    info: i
  };
}

const logoCache = {};
function logoImg(brand) {
  const url = state.brandLogos[brand.key];
  if (!url) return null;
  if (!logoCache[brand.key] || logoCache[brand.key].src !== url) {
    const im = new Image(); im.src = url; logoCache[brand.key] = im;
  }
  return logoCache[brand.key];
}

/* ---------- 导出 ---------- */
const Saver = {
  dir: null,
  dirHandle: null,
  async pick(force) {
    if (!force && this.dir) return true;          // 已选过目录，直接复用
    if (window.desktopApi) { this.dir = await window.desktopApi.chooseDir(); return !!this.dir; }
    if (window.showDirectoryPicker) { this.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); return true; }
    return false;
  },
  async write(name, blob) {
    if (window.desktopApi && this.dir) {
      const buf = await blob.arrayBuffer();
      return window.desktopApi.saveFile(name, new Uint8Array(buf));
    }
    if (this.dirHandle) {
      const fh = await this.dirHandle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob); await w.close();
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    await new Promise(r => setTimeout(r, 120));
  }
};

let exportCancel = false;

async function exportAll() {
  if (!state.files.length) return toast('先导入照片');
  if (state.busy) return;
  state.busy = true;
  exportCancel = false;
  await ensureFonts();
  const ok = await Saver.pick().catch(e => { console.warn(e); return false; });
  if (!ok) {
    const keep = confirm('未选择输出文件夹，将逐张下载到浏览器默认目录。继续？');
    if (!keep) { state.busy = false; return; }
  }

  const modal = el('exportModal');
  const h3 = modal.querySelector('h3');
  el('btnOpenOutDir').hidden = !window.desktopApi;
  el('btnCancelExport').hidden = false;
  h3.textContent = '正在导出';
  modal.classList.add('show');

  const total = state.files.length;
  const t0 = Date.now();
  let done = 0, failed = 0;
  const cv = document.createElement('canvas');
  const update = name => {
    el('exCount').textContent = `${done} / ${total}`;
    el('exFile').textContent = name || '—';
    el('exBar').style.width = (done / total * 100) + '%';
    if (exportCancel) el('exEta').textContent = '正在取消…';
    else {
      const eta = done > 0 ? Math.ceil((Date.now() - t0) / done * (total - done)) : null;
      el('exEta').textContent = eta == null ? '剩余 —' : `剩余约 ${eta} 秒`;
    }
  };
  update('');

  for (const f of state.files) {
    if (exportCancel) break;
    try {
      const { W, H } = orientedSize(f);
      const g0 = Render.frameGeom(cfg, W, H);
      const edge = cfg.outMaxEdge ? Math.min(cfg.outMaxEdge / Math.max(g0.outW, g0.outH), 1) : 1;
      const sc = sceneOf(f, edge);
      cv.width = sc.outW; cv.height = sc.outH;
      paintScene(cv.getContext('2d'), f, sc);

      let blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', cfg.outQuality));
      if (cfg.keepExif && f.buffer) blob = await injectExif(blob, f.buffer);

      const base = f.name.replace(/\.[^.]+$/, '');
      await Saver.write(`${cfg.outPrefix}${base}.jpg`, blob);
      done++;
    } catch (e) {
      failed++;
      console.error('导出失败', f.name, e);
    }
    update(f.name);
    await new Promise(r => setTimeout(r, 0));   // 让进度条有机会绘制
  }
  state.busy = false;
  el('btnCancelExport').hidden = true;
  h3.textContent = exportCancel ? '已取消' : '导出完成';
  el('exEta').textContent = exportCancel ? `已输出 ${done}/${total} 张` : (failed ? `完成 · ${failed} 张失败` : '全部完成');
  el('exFile').textContent = done ? `输出目录：${Saver.dir || '浏览器默认下载目录'}` : '—';
  el('statusText').textContent = exportCancel ? `导出已取消 · 已完成 ${done} 张` : `导出完成 · ${done} 张`;
  if (!window.desktopApi) el('btnOpenOutDir').hidden = true;
}

async function injectExif(blob, origBuffer) {
  const app1 = Exif.extractApp1(origBuffer);
  if (!app1) return blob;
  const src = new Uint8Array(await blob.arrayBuffer());
  if (src[0] !== 0xff || src[1] !== 0xd8) return blob;
  const out = new Uint8Array(2 + app1.length + src.length - 2);
  out.set(src.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(src.subarray(2), 2 + app1.length);
  return new Blob([out], { type: 'image/jpeg' });
}

/* ---------- 杂项 ---------- */
function toast(msg) { el('statusText').textContent = msg; }
function fileToDataURL(file) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
}
function saveBrandLogos() {
  try { localStorage.setItem('ecw.brandLogos.v1', JSON.stringify(state.brandLogos)); } catch (_) {}
}
function loadBrandLogos() {
  try { state.brandLogos = JSON.parse(localStorage.getItem('ecw.brandLogos.v1') || '{}'); } catch (_) { state.brandLogos = {}; }
}

/* ============================================================
   外观系统：主题三态 / 界面主题色 / 应用 Logo / 设置抽屉
   --ui-primary（界面）与 --accent（水印导出）严格分离
   ============================================================ */
const THEME_KEY = 'ecw.theme', UI_COLOR_KEY = 'ecw.uiColor';
const THEME_PRESETS = ['#4F6BED', '#0FA3B1', '#7C5CFF', '#D99A2B', '#E0426A', '#2E8B57', '#5B6472', '#A8B0BD'];
/* 主题三档：跟随系统 / 浅色 / 深色 */
let themeMode = (() => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return (v === 'light' || v === 'dark') ? v : 'system';
  } catch (_) { return 'system'; }
})();
let uiColor = (() => { try { return localStorage.getItem(UI_COLOR_KEY) || '#4F6BED'; } catch (_) { return '#4F6BED'; } })();

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
function hexToRgb(h) {
  h = String(h || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => clampN(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
function shade(hex, dl) {          // HSL 亮度增减（正提亮 / 负压暗）
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn);
  let h = 0, s = 0, l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      default: h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  l = clampN(l + dl, 0, 1);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return rgbToHex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
}
function relLum(hex) {             // WCAG 相对亮度
  const { r, g, b } = hexToRgb(hex);
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const hexA = (hex, a) => { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
const isHexColor = h => /^#[0-9a-fA-F]{6}$/.test(h) || /^#[0-9a-fA-F]{3}$/.test(h);

function resolvedTheme() {
  if (themeMode === 'light' || themeMode === 'dark') return themeMode;
  return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

/** 应用主题三态（system / light / dark），并联动图标、分段控件、Logo、窗口背景 */
function applyTheme(mode, save = true) {
  themeMode = mode;
  if (save) { try { localStorage.setItem(THEME_KEY, mode); } catch (_) {} }
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
  // 顶栏三态图标：显示器 / 太阳 / 月亮
  // 注意 SVG 元素上的 `.hidden = true` 只是挂了个 JS 属性、不反射到 attribute，
  // CSS 的 [hidden] 选择器便匹配不到 —— 必须显式 setAttribute/removeAttribute。
  const icons = { system: 'thSys', light: 'thLight', dark: 'thDark' };
  Object.entries(icons).forEach(([m, id]) => {
    const n = el(id);
    if (!n) return;
    if (m === mode) n.removeAttribute('hidden');
    else n.setAttribute('hidden', '');
  });
  const btnTheme = el('btnTheme');
  const names = { system: '跟随系统', light: '浅色', dark: '深色' };
  if (btnTheme) btnTheme.title = '主题：' + (names[mode] || '跟随系统') + '（点击切换）';
  // 设置页分段高亮
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.themeMode === mode));
  applyPrimary(uiColor, false);
  if (window.desktopApi && window.desktopApi.setBgColor) {
    window.desktopApi.setBgColor(t === 'dark' ? '#101114' : '#F7F8FA');
  }
}

/** 界面主题色：派生 hover（-8% 亮度）/ soft（12% 透明）/ fg（按亮度自动黑白）；深色下提亮 8% */
function applyPrimary(color, save = true) {
  if (!isHexColor(color)) return;
  uiColor = color;
  if (save) { try { localStorage.setItem(UI_COLOR_KEY, uiColor); } catch (_) {} }
  const dark = resolvedTheme() === 'dark';
  const base = dark ? shade(uiColor, 0.08) : uiColor;
  const hover = dark ? shade(uiColor, 0.16) : shade(uiColor, -0.08);
  const rs = document.documentElement.style;
  rs.setProperty('--ui-primary', base);
  rs.setProperty('--ui-primary-hover', hover);
  rs.setProperty('--ui-primary-soft', hexA(base, 0.12));
  rs.setProperty('--ui-primary-fg', relLum(base) > 0.5 ? '#16181D' : '#FFFFFF');
  document.querySelectorAll('#uiSwatches .sw').forEach(b =>
    b.classList.toggle('active', normHex(b.style.getPropertyValue('--c').trim()) === normHex(uiColor)));
  const pk = el('uiColorPicker');
  if (pk && pk.value.toLowerCase() !== uiColor.toLowerCase()) pk.value = uiColor;
}

function buildUiSwatches() {
  const box = el('uiSwatches');
  if (!box) return;
  box.innerHTML = '';
  THEME_PRESETS.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw';
    b.style.setProperty('--c', c);
    b.title = c;
    b.addEventListener('click', () => applyPrimary(c));
    box.appendChild(b);
  });
}

/** 顶栏品牌位 Logo：内置浅/深两张，由 CSS 按 [data-theme] 切换，不提供自定义入口 */

/* ---------- 滑杆数值：点击键入精确值 ---------- */
/* f = 展示格式；e = 编辑框里的初始文本（不带单位）；p = 解析回内部值
 * 注意 e 与 p 必须互为逆运算：编辑框里看到什么数字，就按同样的数字输回去。
 * 百分比类内部存比例（0.03 = 3%），所以 e 要 ×100、p 要 ÷100。 */
const numOrNull = s => {
  const n = parseFloat(String(s).replace(/[%×\s]/g, ''));
  return isNaN(n) ? null : n;
};
const VAL_FMT = {
  pct:  { f: v => Math.round(v * 100) + '%',  e: v => String(Math.round(v * 100)),
          p: s => { const n = numOrNull(s); return n === null ? null : n / 100; } },
  pct1: { f: v => (v * 100).toFixed(1) + '%', e: v => (v * 100).toFixed(1),
          p: s => { const n = numOrNull(s); return n === null ? null : n / 100; } },
  x2:   { f: v => (+v).toFixed(2) + '×',      e: v => (+v).toFixed(2),
          p: s => { const n = numOrNull(s); return n === null ? null : n; } },
  int:  { f: v => String(Math.round(+v)),     e: v => String(Math.round(+v)),
          p: s => { const n = parseInt(s, 10); return isNaN(n) ? null : n; } },
  f2:   { f: v => (+v).toFixed(2),            e: v => (+v).toFixed(2),
          p: s => { const n = numOrNull(s); return n === null ? null : n; } },
  num:  { f: v => (+v) + '%',                 e: v => String(+v),
          p: s => { const n = numOrNull(s); return n === null ? null : n; } },
  hex:  { f: v => String(v).toUpperCase(),    e: v => String(v).toUpperCase(),
          p: s => { s = String(s).trim(); return isHexColor(s) ? s : null; } }
};

function startValEdit(btn) {
  const key = btn.dataset.cfgEdit;
  const fmt = VAL_FMT[btn.dataset.fmt] || VAL_FMT.f2;
  const slider = document.querySelector(`input[type=range][data-cfg="${key}"]`);
  const lab = btn.closest('label') || btn.parentElement;
  if (getComputedStyle(lab).position === 'static') lab.style.position = 'relative';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'val-input';
  // 初始文本用「用户看到的那个数字」，而不是内部存储值（0.03 vs 3.0）
  const cur = getPath(cfg, key);
  inp.value = String(fmt.e ? fmt.e(cur) : cur);
  if (slider && slider.min !== '' && slider.max !== '') {
    inp.title = `可填 ${fmt.f(parseFloat(slider.min))} ~ ${fmt.f(parseFloat(slider.max))}`;
    inp.placeholder = inp.title;
  }
  lab.appendChild(inp);
  btn.style.visibility = 'hidden';
  inp.focus(); inp.select();
  let settled = false;
  const commit = ok => {
    if (settled) return;
    settled = true;
    const raw = inp.value;
    btn.style.visibility = '';
    inp.remove();
    if (!ok) { scheduleRender(); return; }
    let v = fmt.p(raw);
    if (v === null) { scheduleRender(); return; }      // 解析失败 = 取消
    if (slider && slider.min !== '' && slider.max !== '') {
      const lo = parseFloat(slider.min), hi = parseFloat(slider.max);
      const clamped = clampN(v, lo, hi);
      // 超范围时明确告知，别静默改值让人以为「输入没反应」
      if (Math.abs(clamped - v) > 1e-9) {
        toast(`超出范围：可填 ${fmt.f(lo)} ~ ${fmt.f(hi)}，已按 ${fmt.f(clamped)} 处理`);
      }
      v = clamped;
      slider.value = v;
    }
    setPath(cfg, key, v);
    if (key === 'sepColor' && cfg.sepColorMode !== 'custom') cfg.sepColorMode = 'custom';
    syncUI(); saveCfg(); scheduleRender();
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  inp.addEventListener('blur', () => commit(true));
}
function bindValEditors() {
  document.querySelectorAll('button.val[data-cfg-edit]').forEach(b =>
    b.addEventListener('click', () => startValEdit(b)));
}

/* ---------- 设置抽屉 ---------- */
/* ---------- 设置抽屉 · 数据与存储（绿色版路径展示） ---------- */
async function bindDataSection() {
  const a = window.desktopApi;
  const od = el('btnOpenData'), ol = el('btnOpenLog');
  if (!a || !a.dataPaths) {
    setText('dataPath', '浏览器预览模式 · 无本地数据目录');
    setText('cfgPath', '—');
    if (od) od.hidden = true;
    if (ol) ol.hidden = true;
    return;
  }
  let p = null;
  try { p = await a.dataPaths(); } catch (_) {}
  if (p) {
    setText('dataPath', p.data || '—');
    setText('cfgPath', p.config || '—');
  }
  ['dataPath', 'cfgPath'].forEach(id => {
    const n = el(id);
    if (!n) return;
    n.style.cursor = 'pointer';
    n.title = '点击复制路径';
    n.onclick = () => {
      const t = n.textContent || '';
      if (!t || t === '—' || !navigator.clipboard) return;
      navigator.clipboard.writeText(t).then(() => toast('路径已复制')).catch(() => {});
    };
  });
  if (od) od.onclick = () => { a.openDataDir().catch(() => {}); };
  if (ol) ol.onclick = () => { a.openLogFile().catch(() => {}); };
}

function bindSettings() {
  const drawer = el('settingsDrawer'), bd = el('settingsBackdrop');
  const open = () => { drawer.classList.add('show'); bd.classList.add('show'); };
  const close = () => { drawer.classList.remove('show'); bd.classList.remove('show'); };
  el('btnSettings').onclick = open;
  el('btnCloseSettings').onclick = close;
  bd.onclick = close;

  document.querySelectorAll('#themeSeg button').forEach(b =>
    b.onclick = () => applyTheme(b.dataset.themeMode));

  el('uiColorPicker').addEventListener('input', e => applyPrimary(e.target.value));

  // 导出进度模态：取消 / 打开输出目录 / 点空白关闭
  el('btnCancelExport').onclick = () => { exportCancel = true; };
  el('btnOpenOutDir').onclick = async () => {
    if (window.desktopApi && window.desktopApi.openOutDir) {
      const r = await window.desktopApi.openOutDir();
      if (r && r.ok) el('exportModal').classList.remove('show');
    }
  };
  el('exportModal').addEventListener('click', e => {
    if (e.target.id === 'exportModal' && !state.busy) el('exportModal').classList.remove('show');
  });

  // Esc 关抽屉
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawer.classList.contains('show')) close();
  });

  // 系统主题变化时联动（跟随系统模式下）
  if (window.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (themeMode === 'system') applyTheme('system', false); };
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
  }

  buildUiSwatches();
}

/* ---------- 无边框窗口控制（仅 Tauri） ----------
 * 关掉系统标题栏后：顶栏空白/标题区可拖拽，双击切最大化，右侧三颗按钮接管
 * 最小化·最大化·关闭，四周 5px 热区负责缩放。Electron 与浏览器模式保持原生边框，
 * 这些按钮与热区一律不出现。
 */
function wireWindowControls() {
  const api = window.desktopApi;
  const isTauri = !!window.__TAURI__;
  document.documentElement.dataset.shell = isTauri ? 'tauri' : (api ? 'electron' : 'web');
  if (!isTauri || !api || !api.winMin) return;

  el('winCtrl').hidden = false;
  el('rzLayer').hidden = false;
  el('winMin').onclick = () => api.winMin();
  el('winMax').onclick = () => api.winToggleMax().then(syncMaxState);
  el('winClose').onclick = () => {
    // 关窗前把配置强制落盘；最多等 300ms，写盘卡住也不能关不掉窗口
    Promise.race([Store.flush(), new Promise(r => setTimeout(r, 300))]).finally(() => api.winClose());
  };

  const bar = document.querySelector('.topbar');
  // 按钮/输入框上的按下不当作拖窗，否则点一下按钮窗口就跟着跑
  const isCtl = t => !!(t && t.closest && t.closest('button, input, select, textarea, a'));
  bar.addEventListener('mousedown', e => {
    // e.detail > 1 是双击的第二次按下：交给 dblclick 处理，避免进入拖拽循环
    if (e.button !== 0 || e.detail > 1 || isCtl(e.target)) return;
    api.winDrag();
  });
  bar.addEventListener('dblclick', e => {
    if (isCtl(e.target)) return;
    api.winToggleMax().then(syncMaxState);
  });

  document.querySelectorAll('#rzLayer i').forEach(h => {
    h.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      api.winResize(h.dataset.rz);
    });
  });

  let raf = 0;
  const syncMaxState = async () => {
    try { document.body.classList.toggle('is-max', !!(await api.winState())); } catch (_) {}
  };
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(syncMaxState);
  });
  syncMaxState();
}

/* ---------- 启动 ---------- */
async function boot() {
  // 绿色版：先接管 localStorage 镜像，必要时从 data/config.json 把设置恢复回来
  if (Store.install()) {
    const restored = await Store.hydrate();
    // config.json 是权威快照：命中就重新求值，避免强杀后 WebView 缓存落后
    if (restored > 0) reloadPrefs();
  }

  // 外观系统先就位：主题、界面主题色、品牌位 Logo（在首帧渲染前）
  bindSettings();
  bindDataSection();
  bindBrandPicker();
  wireWindowControls();
  applyTheme(themeMode, false);
  bindValEditors();
  loadBrandLogos();
  await ensureFonts();
  try { await Brands.preload(); } catch (e) { console.warn('内置标识预载失败', e); }
  bindControls();
  upgradeSelects();
  syncUI();
  syncChips();
  if (window.desktopApi) { el('chipPlat').textContent = window.__TAURI__ ? 'Tauri 桌面模式' : 'Electron 桌面模式'; el('engineInfo').textContent = 'Canvas 合成引擎 · 桌面版'; }
  // 关于 · 技术信息按实际运行环境填充
  if (el('aboutTech')) {
    const host = window.__TAURI__ ? 'Tauri 2 · WebView2' : (window.desktopApi ? 'Electron 33' : '浏览器内核');
    el('aboutTech').textContent = `${host} · Canvas 合成引擎 · 本地离线`;
  }
  // 本机字体库异步载入，不阻塞首屏
  loadFontLibrary();

  // 演示模式：?demo=1
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) {
    let img = null;
    try { img = await loadImage(window.DEMO_IMAGE || 'assets/demo.jpg'); } catch (e) { console.warn('演示图加载失败', e); return; }
    const info = {
      make: 'Canon', model: 'Canon EOS R6 Mark II', lens: 'RF50mm F1.8 STM',
      fnum: 1.8, exposure: 1 / 200, iso: 400, focal: 50, focal35: 50,
      date: '2026:11:01 16:30:12', orientation: 1, ok: true
    };
    const brand = Brands.detect(info.make, info.model);
    state.files = [{ name: 'DEMO_0001.jpg', size: 0, buffer: null, info, img, url: img.src, brand }];
    state.cur = 0;
    renderList();
    select(0);
    toast('演示模式 · 已载入样例照片');
  }
  logEvent('info', `界面就绪 · ${window.__TAURI__ ? 'Tauri/WebView2' : '浏览器'} · ${navigator.userAgent.slice(0, 120)}`);
  // 首次启动就把当前状态落盘，让 data/config.json 立刻有内容（而不是等用户改一次设置）
  if (Store.hooked) setTimeout(() => Store.flush(), 800);
}

window.addEventListener('error', e => {
  setText('statusText', 'JS 错误：' + (e.message || e.error));
  console.error('[app]', e.error || e.message);
  logEvent('error', `${e.message || ''} @ ${e.filename || ''}:${e.lineno || 0}`);
});
window.addEventListener('unhandledrejection', e => {
  setText('statusText', 'Promise 错误：' + (e.reason && e.reason.message || e.reason));
  console.error('[app] rejection', e.reason);
  logEvent('error', 'Promise 未捕获：' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
});

// 异常退出前也尽量把配置推一次（正常关闭走 winClose 那条路）
window.addEventListener('beforeunload', () => { Store.flush(); });

document.addEventListener('DOMContentLoaded', boot);
