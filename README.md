# 暮呈照片水印工作台

> 读 EXIF，出片尾注。一个完全本地、绿色免安装的照片水印工具。

自动读取照片的相机型号、镜头、光圈、快门、ISO、焦距与拍摄时间，合成一条克制克制的
「杂志题注」式水印，支持批量导出。全部计算在本地 Canvas 完成，照片不上传任何服务器。

- 单文件主程序 + 一个 160KB 运行时 DLL，**双击即用，不安装、不写注册表**
- 所有数据（配置 / 日志 / 缓存）**只写在软件自己的文件夹里**，不碰 C 盘与系统用户目录
- 支持 JPEG / PNG / WebP / TIFF，批量拖入、逐张预览、批量导出

---

## 目录

- [功能](#功能)
- [快速开始](#快速开始)
- [数据存放在哪里（绿色版约定）](#数据存放在哪里绿色版约定)
- [从源码构建](#从源码构建)
- [目录结构](#目录结构)
- [测试与验收](#测试与验收)
- [常见问题](#常见问题)
- [许可](#许可)

---

## 功能

**水印版式（9 种）**

| 版式 | 说明 |
| --- | --- |
| 悬浮卡片 | 半透明圆角底板承托 Logo + 参数，九宫格任意定位 |
| 底部通栏 | 渐变通栏压暗底部，参数随画面边缘对齐 |
| 右侧竖排 | 参数逐项分行，适合竖构图与社交平台 |
| 四角极简 | 无底板，仅柔光过渡，最接近印刷题注 |
| 取景器 HUD | 四角取景框 + 中心准星 + 顶部水平仪，参数压在角线内侧 |
| 胶片竖边 | 右侧窄带竖排参数，左缘配刻度与三角标记，占用面积最小 |
| 胶片齿孔 | 上下片基带：边码、发丝线、透光齿孔分层，参数印在下带 |
| 美术馆装裱 | 宽卡纸 + 底部展签，卡纸宽度可调，文字自动转深色墨 |
| 白色边框 | 照片外圈留白，参数写在底部白边上，白边宽度可调 |

**细节能力**

- 26 个相机品牌的官方配色标识（徕卡红白、佳能红、尼康黄…），按 EXIF 自动识别，也可手动改
- Logo 尺寸、字号、竖线、内边距同步等比缩放；九宫格任意位置视觉尺寸一致
- 参数可逐项开关：机型 / 镜头 / 光圈 / 快门 / ISO / 焦距 / 时间 / 自定义版权
- 本机字体库接入（约 660 款），中文 240+ 款，可筛选、可搜索
- 深浅双主题 + 三档切换（跟随系统 / 浅色 / 深色），界面主题色与水印主题色互不影响
- 无边框自绘窗口，八向缩放热区，快捷键 `Ctrl+O` / `Ctrl+E` / `←` `→` / `+` `-` / `0` `1`

---

## 快速开始

1. 下载发布包，解压到任意**有写入权限**的目录（如 `D:\Tools\暮呈照片水印工作台\`）
2. 双击 `暮呈照片水印工作台.exe`
3. 拖入照片 → 右侧调版式 → 点「导出全部」

> 运行依赖 **Microsoft Edge WebView2 Runtime**。Windows 10/11 一般自带；
> 若提示缺失，请到微软官网安装 Evergreen Runtime。
>
> `WebView2Loader.dll` 是必需的运行时组件，**请勿删除**。

---

## 数据存放在哪里（绿色版约定）

程序启动时用 `current_exe()` 解析自身所在目录，所有运行期数据都挂在这棵树下：

```
暮呈照片水印工作台/            ← 整个文件夹可以随意搬
├─ 暮呈照片水印工作台.exe
├─ WebView2Loader.dll
├─ 使用说明.txt
├─ LICENSE
└─ data/                      ← 首次运行自动创建
   ├─ config.json             全部设置（人类可读，可备份 / 可手改 / 可换机带走）
   ├─ logs/
   │  └─ app.log              运行日志（超 2MB 自动轮转为 app.1.log）
   └─ webview/
      └─ EBWebView/           WebView2 用户数据（localStorage、缓存）
```

**三条硬约定**

1. 不安装、不注册表、不写 `%APPDATA%` / `%LOCALAPPDATA%` / `%TEMP%`
2. 路径全部由程序自身目录动态推导，代码里没有任何硬编码盘符
3. 需要换机器时，把整个文件夹拷走即可，配置与预设跟着走

**关于 config.json**

WebView 的 localStorage 是 LevelDB 二进制，不方便备份。程序因此在每次设置变更后
（400ms 防抖）把整份 `ecw.*` 快照镜像写入 `data/config.json`，字段为 `{ schema, app,
savedAt, kv: { ... } }`。启动时以这份快照为准回填，所以：

- 强杀进程 / 断电也不会丢最后一次改动（镜像比 WebView 缓存更早落盘）
- 手动改 `config.json` 里 `kv` 的某项，重启即生效
- 只把 `config.json` 拷到另一台机器的 `data/` 下，配置就能恢复

**旧版本数据迁移**

若检测到旧版（配置写在 `%LOCALAPPDATA%\com.linghang.exifcam\EBWebView` 的时期）数据，
首次启动会**只读**地复制一份到 `data/webview/EBWebView`，并在
`data/webview/.migrated-from-legacy` 留下记录。旧目录不会被修改或删除，可自行清理。

---

## 从源码构建

**环境要求**

- Node.js ≥ 18（构建脚本与验收脚本）
- Rust ≥ 1.77（GNU 工具链，`x86_64-pc-windows-gnu`）
- MinGW-w64 工具链（提供 `windres` / `dlltool` / `as`），推荐 [w64devkit](https://github.com/skeeto/w64devkit)

**一条命令**

```bash
npm run build
```

等价于 `node scripts/build-win.js`，它会：

1. `cargo build --release`（自动把 `W64DEVKIT` 加入 PATH）
2. 组装 `build-out/暮呈照片水印工作台/`：复制 exe → 改中文名、带上 `WebView2Loader.dll`、
   生成 `使用说明.txt` 与 `LICENSE`

**为什么 exe 名要改而不是直接编译成中文名**

`cargo` 的 target 名保持 ASCII（`exif-cam`）。实测把 `[[bin]] name` 设成中文虽然能编译
通过，但 `tauri-build` 经 `windres` 产出的中文目标文件名会让成品在**加载阶段**直接退出
（进程进不到 `main`，退出码 `0xC0000135`，且没有任何日志）。因此中文名由构建脚本在
构建完成后重命名，`src-tauri/tauri.conf.json` 的 `mainBinaryName` 同步设为中文，
保证 `tauri build` 打包时命名一致。

**调试模式**

```bash
npm run dev     # 本地静态服务 http://127.0.0.1:8080，浏览器里直接调 UI
```

在浏览器里打开时没有 `window.desktopApi`，程序会自动降级（不能选目录、导出走浏览器下载），
方便快速改 UI。桌面行为（绿色目录、配置落盘、窗口控制）需跑真机验收。

---

## 目录结构

```
.
├─ src/                       前端（Tauri 的 frontendDist 直接指这里，无二次同步）
│  ├─ index.html
│  ├─ css/style.css           双主题 token 化样式
│  ├─ js/
│  │  ├─ app.js               应用主逻辑 + 绿色版持久化层（Store）
│  │  ├─ render.js            Canvas 水印合成（9 种版式）
│  │  ├─ brands.js            26 品牌配色标识绘制
│  │  ├─ logos.js             内置 Logo 位图
│  │  ├─ exif.js              EXIF 解析
│  │  └─ api-bridge.js        Electron / Tauri / 浏览器三态桥接
│  ├─ assets/                 Logo 与应用图标
│  └─ fonts/                  普惠体子集（GB2312 全字，4.7MB）
├─ src-tauri/                 Rust 桌面外壳
│  ├─ src/
│  │  ├─ main.rs              命令注册 + 自建主窗口（钉住 WebView2 数据目录）
│  │  ├─ paths.rs             绿色版路径解析（current_exe 派生）
│  │  ├─ store.rs             config.json 原子读写
│  │  ├─ logger.rs            文件日志 + panic hook
│  │  └─ fonts_scan.rs        系统字体枚举
│  ├─ tauri.conf.json
│  └─ icons/
├─ scripts/                   构建与资源生成
│  ├─ build-win.js            一条命令产出发布目录
│  ├─ make-logo.py            图标 / 位图 Logo 生成
│  ├─ subset_fonts.py         字体子集化
│  └─ serve.js                本地静态服务（调试）
├─ tests/                     验收脚本（无头 Chrome + 真机 CDP）
│  ├─ render.test.js          水印合成 31 项
│  ├─ ui.test.js              界面与交互 40 项
│  └─ app.test.js             真机与绿色化 47 项
├─ docs/                      使用 / 数据目录 / 构建说明
├─ tools/                     临时诊断脚本
├─ legacy/electron/           早期 Electron 实现（已归档，不参与构建）
└─ resources/fonts-full/      字体源文件（体积大，未纳入版本控制）
```

---

## 测试与验收

```bash
npm test              # 三层全跑
npm run test:render   # 水印合成（无头 Chrome，31 项）
npm run test:ui       # 界面交互（无头 Chrome，40 项）
npm run test:app      # 真机（跑打包 exe，47 项）
```

`tests/app.test.js` 会把 exe 复制进一个全新的空目录再运行，因此它同时验证了绿色版行为：

- `data/` 是否真的建在 exe 同级
- `config.json` 是否被正确镜像（含 `ecw.cfg.v4` 且能反序列化）
- `logs/app.log` 是否记录启动路径
- `%LOCALAPPDATA%` 里是否**没有**新建产品目录
- 改主题后 `config.json` 是否同步
- 关窗重启后配置是否仍在

脚本用 `Input.dispatchMouseEvent` 发真实鼠标事件（合成 `click()` 不经过命中测试，
测不出层级遮挡问题），并监听 `Runtime.exceptionThrown` 断言 0 运行时异常。

---

## 常见问题

**双击没反应 / 一闪而过**

多半是 exe 与 `WebView2Loader.dll` 不在同一目录。两者必须放在一起。

**提示「数据目录不可写」**

程序被放进了只读位置（如 `Program Files`）。把它移到 `D:\` 等可写目录再运行。

**换电脑后配置没了**

只拷了 exe。要把整个文件夹（含 `data/`）一起拷走；或至少把 `data/config.json`
放到新机器同名目录下。

**导出很慢**

大批量高分辨率照片受限于 Canvas 逐张合成，属正常。可在「输出」页签限制最长边。

---

## 许可

本项目源码公开，但**不是 OSI 定义的开源许可**，采用自定义限制性条款：

- ✅ 可**个人免费使用**
- ✅ 可自由复制与分享
- ⚠️ **转载需注明出处**（软件名称 + `https://github.com/mucheng0325`）
- ❌ **禁止一切商业行为**（销售、捆绑、付费服务、广告导流等）

完整条款见 [LICENSE](LICENSE)。商业授权请联系著作权人。

---

Copyright © 2026 mucheng0325 · https://github.com/mucheng0325
