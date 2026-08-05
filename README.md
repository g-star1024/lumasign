# 灵屏 LumaSign

<p align="center">
  <strong>局域网数字标牌管理系统</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22+-green?logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License" />
  <img src="https://img.shields.io/badge/Platform-Win%20%7C%20Mac%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/Android-APK-success" alt="Android" />
</p>

---

**灵屏 LumaSign** 是一套**零成本、开箱即用**的局域网数字标牌（Digital Signage）管理系统，可用于替代商业数字标牌方案（如触拓 CHUTO「数字标牌 e 版」），管理 1–50 台安卓电子终端的节目编排与下发。

## 核心特性

| 特性 | 说明 |
|------|------|
| **零依赖服务端** | 纯 Node.js 内置模块，无需 `npm install`、无原生编译 |
| **现代 SaaS 风格管理端** | 原生 ESM + 手写 CSS 设计系统，浅色/暗色主题切换 |
| **三栏可视化编辑器** | 左侧组件库 + 中间画布预览 + 右侧属性面板 |
| **HTML5 播放引擎** | 一份代码三处复用：编辑器预览 = 终端渲染 = 浏览器预览 |
| **安卓播放端** | Kotlin WebView 壳 + JS Bridge（真熄屏 / 截屏 / 音量 / 自升级） |
| **桌面客户端** | Electron 封装，Win(MSI) + Mac(DMG) 双平台安装包 |
| **大屏监看墙** | 一块大屏集中监控所有终端实时画面与状态 |
| **远程设备开通** | ADB / 厂商通道远程推送 APK 到嵌墙设备 |
| **安全合规** | PBKDF2-SHA512 / 令牌桶限速 / SHA-256 去重 / RBAC 权限 |

## 截图

> （待补充实际截图）

## 快速开始

### 环境要求

- **Node.js** >= 22（或 18+ LTS）
- **npm** >= 9（仅桌面端打包时需要）

### 1. 启动服务端

```bash
git clone https://github.com/<user>/lumasign.git
cd lumasign
node server/server.js
```

管理端地址：**http://localhost:7788/**
默认账号：`admin` / `admin123`

Windows 用户可直接双击 `启动-Windows.bat`。

### 2. 使用管理端

1. 打开浏览器访问 http://localhost:7788/
2. 用 admin/admin123 登录
3. **素材库** → 上传图片/视频
4. **节目制作** → 新建节目 → 编辑器中拖入组件并绑定素材
5. **终端管理** → 添加终端（或使用设备开通远程部署）
6. **排期下发** → 将节目排期到目标终端

### 3. 接入终端

**方式 A — 安卓 APK**
```bash
# 见 docs/07-安卓播放端APK与替换迁移.md
# Android Studio 打包 android/ 目录，安装到各终端
```

**方式 B — 浏览器预览**
```
http://<你的IP>:7788/player/index.html?mode=preview&layoutId=<节目ID>
```

**方式 C — 大屏监看墙**
```
http://<你的IP>:7788/player/monitor.html?key=<monitorToken>
```

## 项目结构

```
lumasign/
├── server/                  # 零依赖 Node 服务端
│   ├── server.js            # 主入口（可被 Electron 同进程托管）
│   ├── lib/                 # store / http / auth / bus / schedule / logger / discovery / seed / fleet
│   └── api/                 # admin / terminal / fleet 三套 REST API
├── admin/                   # 现代风管理端（原生 ESM）
│   ├── index.html           # 单页应用入口
│   ├── theme.css            # 设计系统（SaaS 浅色 + macOS 暗色双主题）
│   └── js/
│       ├── core.js          # API 客户端 / 状态 / UI 辅助函数
│       ├── shell.js         # 路由 / 导航 / 模态框
│       ├── views.js         # 全部页面渲染器（12 个页面）
│       └── app.js           # 应用初始化
├── player/                  # HTML5 播放引擎（三处复用）
│   ├── index.html           # 播放入口
│   ├── engine.js            # 核心：布局解析 / 区域调度 / widget 渲染
│   ├── widgets.js           # Widget 渲染器（图片/视频/文字/时钟/二维码…）
│   ├── styles.css           # 播放样式
│   └── monitor.html/js      # 大屏监看墙全屏页
├── desktop/                 # Electron 桌面端外壳
│   ├── main.cjs             # 主进程
│   ├── preload.cjs          # 预加载脚本
│   └── loading.html         # 加载界面
├── android/                 # 安卓播放端 APK 工程（Kotlin）
│   ├── app/src/main/java/   # MainActivity / LumaBridge / ScreenPower / …
│   └── build.gradle / …     # 构建配置（需 gradle wrapper）
├── docs/                    # 项目文档
│   ├── 01-市场调研.md
│   ├── 02-e版对标.md
│   ├── 03-架构设计.md
│   ├── 04-迁移指南.md
│   ├── 05-API文档.md
│   ├── 06-远程开通与APK部署.md
│   └── 07-安卓播放端APK与替换迁移.md
├── 启动-Windows.bat         # Windows 一键启动
├── 启动-Mac.command         # Mac 一键启动
└── package.json             # type:module; Electron 仅构建期依赖
```

## 架构设计

```
┌─────────────┐  HTTP/SSE   ┌──────────────┐  UDP 广播   ┌──────────┐
│  Admin 管理端 │ ◄────────► │  Server 服务端 │ ◄─────────► │ 终端设备  │
│  (Browser)   │              │  (Node.js)    │              │ (Android)│
└─────────────┘              └──────────────┘              └──────────┘
        │                             │                         │
        │                        ┌────┴────┐                    │
        │                        │ JSON 存储│                    │
        │                        └─────────┘                    │
        │                                                     │
        ▼                                                     ▼
┌──────────────┐                                       ┌──────────────┐
│ Player 播放引擎 │◄──── postMessage ──────────────────│ WebView 壳  │
│ (iframe/独立)  │                                       │ (LumaBridge) │
└──────────────┘                                       └──────────────┘
```

### 数据模型

```
Layout（节目）
├── width, height, orientation
├── background { color?, mediaId? }
└── Region[]（区域）
    ├── x, y, w, h, z, transition
    └── Item[]（条目/Widget）
        ├── widget: image | video | text | marquee | clock | qrcode
        ├── mediaId?（关联素材）
        └── duration, x, y, w, h, ...
```

### 四态排期语义

| 模式 | 说明 | 优先级 |
|------|------|--------|
| `default` | 默认播放 | 最低 |
| `cycle` | 周期轮播 | |
| `insert` | 插播（临时覆盖） | |
| `exclusive` | 独占（最高优先） | 最高 |

## 安全机制

- **认证**: PBKDF2-SHA512 100,000 轮加盐哈希 + 会话 Cookie
- **授权**: RBAC 双维度（功能 permission + 机构树 orgScope）
- **限速**: 令牌桶算法防暴力破解
- **传输**: Range 断点续传大文件
- **去重**: SHA-256 素材去重，节省存储
- **签名**: HMAC 清单签名防止篡改

## CI/CD（GitHub Actions）

项目配置了自动化构建工作流：

| 工作流 | 触发条件 | 产物 |
|--------|----------|------|
| `desktop.yml` | push to main / PR | Win(.exe,.msi) + Mac(.dmg) 桌面端 |
| `android-apk.yml` | push to main / PR / tag | Android debug+release APK |

详见 `.github/workflows/` 目录。

## 开发指南

### 添加新页面

1. 在 `admin/js/views.js` 中添加 `async function renderXxx()` 函数
2. 返回值根节点挂 `class='page-xxx'`（自动继承 SaaS 设计令牌）
3. 在 `admin/js/app.js` 的路由表中注册
4. 在侧栏导航中添加入口

### 添加新 Widget

1. 在 `player/widgets.js` 中添加 `renderXxx(holder, item, resolver, onEnd)` 函数
2. 在 `RENDERERS` 映射表中注册
3. 在编辑器 `defaultItem()` 中添加默认数据
4. 在属性面板 `buildProps()` 中添加对应表单

### 设计系统令牌

管理端使用 CSS 变量体系：

```css
/* 全局令牌（浅色） */
--c-primary: #2563EB;      /* 主色 */
--c-bg: #F7F8FC;           /* 页面背景 */
--c-surface: #FFFFFF;      /* 卡片背景 */
--c-border: #E5E7EB;       /* 边框 */
--c-text: #111111;         /* 主文字 */

/* 组件类（全局 .t-*） */
.t-btn.primary   /* 主按钮 */
.t-badge.s/w/d   /* 状态徽标 */
.t-table         /* 数据表格 */
.t-stat          /* 统计卡片 */
```

## 技术栈

| 层 | 技术 |
|----|------|
| 服务端 | Node.js 内置模块（零外部依赖） |
| 管理端 | 原生 ESM + Vanilla JS + CSS Variables |
| 播放引擎 | HTML5 + CSS3 + ES6 Modules |
| 桌面端 | Electron 28+ |
| 安卓端 | Kotlin + WebView + MinSdk 21 |
| 构建 | GitHub Actions (Win/Mac/Android) |

## 对标商业方案

| 能力 | 触拓 e 版 | 灵屏 LumaSign |
|------|-----------|---------------|
| 节目编辑 | ✅ | ✅ 可视化三栏编辑器 |
| 素材管理 | ✅ | ✅ 上传/预览/分类 |
| 排期下发 | ✅ | ✅ 四态语义对齐 |
| 终端管理 | ✅ | ✅ 心跳/状态/指令 |
| 远程开机 | ✅ | ✅ Wake-on-LAN / 定时 |
| 真熄屏 | ✅ | ✅ root / 系统签名 |
| 截屏监看 | ✅ | ✅ 监看墙 |
| 远程装机 | ✅ | ✅ ADB / 厂商通道 |
| 自升级 | ✅ | ✅ APK 远程推送 |
| **费用** | **按终端收费** | **免费开源 (MIT)** |

## 文档索引

| 文档 | 内容 |
|------|------|
| [01-市场调研](docs/01-市场调研.md) | 数字标牌行业分析 |
| [02-e版对标](docs/02-e版对标.md) | 功能对标清单 |
| [03-架构设计](docs/03-架构设计.md) | 技术架构详解 |
| [04-迁移指南](docs/04-迁移指南.md) | 从 e 版迁移步骤 |
| [05-API文档](docs/05-API文档.md) | 完整 API 参考 |
| [06-远程开通](docs/06-远程开通与APK部署.md) | 远程装机流程 |
| [07-安卓端](docs/07-安卓播放端APK与替换迁移.md) | APK 构建与部署 |

## License

MIT License - 详见 [LICENSE](LICENSE) 文件。

---

<p align="center">
  <strong>灵屏 LumaSign</strong> · 让每块屏幕都发挥价值
</p>
