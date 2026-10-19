# 灵屏 APK · 56iq/触拓 兼容改造清单（分批落地）

> 目标：让灵屏播放端 APK（com.lumasign.player）能在「56iq 兼容模式」下，像 56iq/触拓 播放端一样工作：
> 向 CMS 注册、轮询节目、渲染内容、响应插播/音量、回传播放反馈。
> 约束：minSdk 19（Android 4.4 / Chromium 33）；**本机无 Android 构建环境，编译验证全走 GitHub Actions CI**。
> 架构关键决策：**重逻辑放 JS（player/siqian-shell.js，已 ES5 化，node 可单测），Kotlin 只做胶水**——把不可本地编译的风险降到最低。

---

## CI 触发方式（所有 Kotlin 改动的验证途径）

- 工作流：`.github/workflows/android-apk.yml`
- 触发：push `main` 或 tag `v*`，且改动命中 `paths: [android/**, player/**, .github/workflows/android-apk.yml]`；或 `workflow_dispatch` 手动。
- 环境：ubuntu + JDK 17 + Gradle 8.7；产物 debug + release（稳定签名）APK。
- **验证闭环**：每次 push `main` → CI 跑 `assembleDebug` + `assembleRelease` → 编译失败会把错误回贴到 commit comment（workflow 内置步骤）→ 我据此迭代。
- 节奏：每批一个 commit + push main，看 CI 绿了再进下一批，避免把多个未编译错误叠加。

---

## Batch 1（本批，已落地）— 底座：版本 + JS Shell + CMS JSONP

| 文件 | 类型 | 改动 |
|---|---|---|
| `android/app/build.gradle` | 改 | versionCode 44→45，versionName 1.3.38→**1.3.39** |
| `player/siqian.html` | 新 | 56iq 兼容播放宿主页（ES5、显式定位规避 inset、HUD + 插播层） |
| `player/siqian-shell.js` | 新 | 兼容 Shell 逻辑：JSONP 注册/轮询 programs·list·nowlist/渲染网页·视频·图片/插播/音量/反馈信标 |
| `server/lib/siqian.js` | 改 | CMS 模拟层加 **JSONP（callback）** 响应 + `/api/feedback` 信标 + nowlist 折带 volume/insert/command |

- 验证：`node --check` 三文件通过；本批**无 Kotlin 逻辑改动**，CI 应保持绿（仅版本号 + player 静态资源变化）。
- 到此，服务端(兼 CMS) + JS Shell 已能闭环；只差 Kotlin 把 WebView 指到这个 Shell 页。

---

## Batch 2 — Kotlin 胶水层（依赖 Batch1 CI 绿）

| 文件 | 类型 | 改动 |
|---|---|---|
| `MainActivity.kt` | 改 | ① companion 增常量 `KEY_SIQIAN_MODE="siqian_mode"`、`KEY_SIQIAN_CMS="siqian_cms"`；② `loadPlayer()` 开头加 56iq 兼容分支：命中模式则 `webView.loadUrl("<base>/player/siqian.html?mode=siqian&cms=<CMS>&code=<code>&name=<name>")`；③ 深链 `lumasync://config` 增 `mode=siqian` + `cms=` 解析；④ 桥已挂 `LumaBridge`，补 `addJavascriptInterface(bridge, "Android")` 别名 |
| `LumaBridge.kt` | 改 | 增 `@JavascriptInterface fun getDeviceInfo(): String` → 返回 `{"authorized_device_id": <terminal_code 或 mac>}`（对齐 56iq default.html 的 `Android.getDeviceInfo()` 约定，便于直接跑触拓原生网页模板） |

- 风险点：`loadPlayer()` 分支要保持原 LumaSign 行为不变（仅新增 if 提前 return）；`getDeviceInfo` 自包含低风险。
- 验证：push main → CI 编译。若报错按 commit comment 迭代。

---

## Batch 3 — 配置联动（管理端 / 深链二维码）

| 文件 | 类型 | 改动 |
|---|---|---|
| `server/lib/seed.js` 或 settings 默认 | 改 | settings 增 `siqianCms`（默认空）等 |
| `server/api/admin.js`（或 terminal.js） | 改 | 管理端可写「56iq 兼容模式 + CMS 地址」到终端；或生成 `lumasync://config?...&mode=siqian&cms=` 深链二维码供现场扫码 |
| `admin/js/views.js` | 改 | 终端配置/开通页加「56iq 兼容模式」开关 + CMS 输入框 |

- 目的：不用改 APK 也能给指定终端切模式 / 指向 CMS。

---

## Batch 4 — 节目真实映射 + 反馈入库 + 联调

| 文件 | 类型 | 改动 |
|---|---|---|
| `server/lib/siqian.js` | 改 | `programResolver` 真映射：灵屏「终端 + 排期/layout」→ 56iq `programs/list`（含 `Url`/`Media`/`TaskType`），让 Shell 渲染真内容；`/api/feedback` 写入灵屏 `playlog` 集合 |
| （可选）`UpdateManager.kt` | 改 | 解析 56iq `EAutoUpdate.xml`（若要给 56iq 设备推包） |

- 真机联调：**192.168.2.153**（RK312x/4.4/触拓）→ 注册→节目→插播→音量→反馈→OTA 全链路。
- 发布：`android/app/build.gradle` 已 bump 到 1.3.39；联调通过后 `git tag -a v1.3.39` + push tag 出正式包。

---

## 待确认 / 风险

1. 56iq 原生广播发现包格式未公开 → Batch2 的注册以「深链/手动指向 CMS」为主，广播发现作补充。
2. 触拓 APK 与灵屏签名不同 → 若要给触拓设备推灵屏包，跨签名需先卸载（沿用 v1.3.24 逻辑）。
3. Chromium 33 限制已规避（无 fetch/inset/let/const/箭头）。
4. `getDeviceInfo` 的 `authorized_device_id` 取值口径需与现场注册策略对齐（terminal_code 优先，mac 兜底）。
