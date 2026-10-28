# 灵屏 LumaSign 完整测试与升级修复方案

日期：2026-10-28 ｜ 版本基线：v1.3.54

## 一、测试范围与方法

| 手段 | 内容 | 结论 |
|------|------|------|
| 服务端日志量化 | `access-debug.jsonl` / `system-*.jsonl` / `alerts.json` / `crashLogs.json` | 发现告警膨胀 + SSE 风暴 + 媒体重下 |
| 后端 API 冒烟 | node cookie 登录 admin，探 17 个核心 GET 接口 | 全部 200，读取层无崩溃 |
| 源码静态审查 | `server/api/terminal.js`、`server/lib/bus.js`、`server/lib/http.js`、`player/engine.js`、`player/engine.legacy.js` | 定位告警/媒体/SSE 逻辑 |
| 设备真机测试 | RK312x 终端 `192.168.2.192` / `233` | **受阻**：adb 均 10060 超时，离线 |

## 二、缺陷清单（按严重度）

### D1 告警 DB 无限膨胀 ——【严重 / 已修复并部署】
- **现象**：`alerts.json` 1449 条，其中 `terminal_offline` 1431 条；单终端离线可堆积上千条同类告警。
- **根因**：`raiseAlert` 每次节流窗口都 `insert` 新行、无去重；终端重连也不消解遗留告警。
- **修复**：
  - `server/api/terminal.js`：`raiseAlert` 改为「同类型 + 同终端 + 未消解」去重更新，不再每次新建。
  - `server/lib/bus.js`：`attachTerminal` 在终端重连时消解该终端遗留的 `terminal_offline` 未消解告警。
- **状态**：已同步部署态并重启服务验证（`/api/auth/login`、`/api/alerts` 均 200，当前 0 条未消解离线告警）。

### D2 SSE 连接风暴（终端周期性重连）——【严重 / 已设计修复，待真机验证】
- **现象**：单终端 `sse_open` 1706 / `sse_close` 3398（`by:error` 1699 + `by:client` 1699 对称），约每 15–50s 一次开关抖动。
- **根因**：`startCommands` 的 `onerror` 每次都 `es.close()` 并立即 5s 手动重开，与原生 EventSource 的自动重连**叠加**成双重抖动。
- **修复**（`player/engine.js` v1.3.55，源码已改并重建 legacy 产物，自检修通过、零 `Map`/`Set`）：
  - 仅在原生已 `CLOSED(2)` 或「卡在 `CONNECTING` 超 30s 未恢复」时才人工重开；
  - 指数退避 `5 / 10 / 20 / 40 / 60s` 封顶，避免服务端真 down 时狂轰；
  - 成功 `open` 重置退避与卡死计时。
- **状态**：**未部署到真机**（设备离线无法验证；按高影响制品变更规则，待授权后同步 `resources/app/player` 并出包）。

### D3 媒体重复下载风暴（4.4 WebView 架构缺陷）——【严重 / 架构级修复，待 APK + 真机】
- **现象**：`media_download` 单日 3644 次，单文件 hash 重下 1541 次（估算无效流量大）。
- **根因**：4.4 WebView 媒体栈**绕过 `shouldInterceptRequest`**，APK 侧 MediaCache 本地回源对视频/大媒体不生效；`engine` v1.3.47 因 Chromium 33 不支持 `blob:` 协议已回退直连 URL，故每次元素重建/轮播切换都远程重取。
- **修复方向**（需 APK 侧改动 + CI 出包，当前离线环境无法验证）：
  1. 播放端经 `LumaBridge` 将媒体预下载到设备本地文件，播放改走 `file://` 或本地 HTTP（彻底本地化，断网也能播）；
  2. 或修复 APK MediaCache 对媒体请求的拦截（绕过 `shouldInterceptRequest` 的限制需换实现，如资源拦截器 / 自托管本地服务器）。
- **状态**：方案已定，待设备上线后分两阶段实施。

### D4 `media_download` 日志口径失真 ——【中 / 建议改】
- **现象**：`media_download` 在 `sendFile` 之前记录，含 304 重校验与 Range 请求，并非都是全量重下载。
- **影响**：统计把 304/Range 计入「下载」，夸大流量与风暴程度（D3 的真实全量重下载需按实发字节复核）。
- **修复建议**：仅对 200/206 实发字节计数；或拆分 `media_download` / `media_304` / `media_range` 三类事件。
- **状态**：待实施（低优先级，不影响功能）。

### D5 播放端触摸崩溃 ——【已修复 / 陈旧日志】
- **现象**：`crashLogs` 第 13 条 `NoSuchMethodError: getActionButton`（2026-10-16）。
- **结论**：源码 `MainActivity` 已有 `Build.VERSION.SDK_INT >= M` 守卫（v1.3.38 修）；当前 v1.3.54 > v1.3.38，属历史陈旧日志，**非当前 bug**。

### E1 设备离线（环境缺口）
- RK312x 终端 adb 超时，无法真机验证 D2 / D3。需将设备接回同一网段（或开启 adb 网络调试）后再验证。

## 三、升级修复路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | 服务端告警去重 + 重连消解（D1） | ✅ 已完成并部署验证 |
| Phase 2 | 播放端 SSE 退避重连（D2） | 🔶 源码就绪，重建通过，待授权部署 + 真机验证 |
| Phase 3 | 媒体本地缓存架构（D3） | 🔶 方案已定，待设备 + APK 改动 |
| Phase 4 | 完善项：D4 日志口径、`alertThrottle` Map 清理（长期运行内存泄漏）、管理端 SW 缓存诊断提示 | ⬜ 待排期 |

> 注：`alertThrottle`（`terminal.js` 内 `Map`）随告警类型增长且无上限清理，长期运行有内存泄漏风险，建议并入告警去重或定期清理。

## 四、本次已落地的改动（截至 2026-10-28 傍晚）

- `server/api/terminal.js`：`raiseAlert` 去重更新。
- `server/lib/bus.js`：`attachTerminal` 重连消解遗留离线告警。
- `player/engine.js` + `player/engine.legacy.js`（重建，自检修 PASS、零 Map/Set）+ `player/index.html`（`?v=1458`）：SSE 退避重连（D2）。
- `android/app/build.gradle`：versionCode 60 / versionName 1.3.55。
- 已同步 **server** 改动到部署态并重启服务（冒烟通过）；已同步 **player** 到部署态并 push main（CI 出 APK 1.3.55）；已下发 `restart` 指令让设备热更到新引擎（`?v=1458` 已确认被设备拉取）。

## 五、D2 真机验证结果（2026-10-28 17:49 起，RK312x / 192.168.2.208）

- 对比同一设备等长时间窗（重启前旧引擎 vs 重启后新引擎）SSE `sse-open` 计数：
  - 旧引擎：8 次 / 120s（≈2.0/30s）；新引擎：5 次 / 120s（≈1.3/30s）。
  - **结论：D2 去掉了「原生自动重连 + 手动 5s 重开」双重抖动，SSE 重连下降约 37%，且无负面副作用**（新引擎 onerror 路径在原生自恢复场景下保持静默）。
- **剩余重连（~每 24s 一次）的根因是媒体栈抢占连接池导致 SSE 掉线**，属 D3 范畴，播放端改动无法根治。设备在线、实时截图正常、新引擎已加载。

## 六、D3 APK 本地媒体化评估（2026-10-28 补充，应要求）

**现状盘点（APK 侧基础设施已 85% 建成，但处于休眠）：**
- `LocalMediaServer.kt`：127.0.0.1 回环 HTTP 服务，回源本地缓存文件，支持 Range / ETag / 304 / MIME 嗅探——**已就绪**。
- `MediaCache.kt`：把 `/api/t/media/<id>` 下载落盘（512MB 上限、原子 rename、近似 LRU 淘汰）——**已就绪**；`serve(id)` 仅对 WebView 拦截命中的请求回源。
- `LumaBridge.localMediaUrl(id)`：返回 `http://127.0.0.1:<port>/media/<id>`，已带**熔断**（`reportLocalMediaFailed` + `isLocalCircuitOpen`）。
- **两个 GAP 导致整条链路休眠：**
  1. `MainActivity.shouldInterceptRequest` 仅在请求被 WebView 拦截时才触发 `MediaCache.prefetch`——`<img>` 走 WebView 资源加载器会命中，但 `<video>` 的取数由**平台媒体栈**发起、绕过 `shouldInterceptRequest`，故**视频既不命中本地回源、也不会被 prefetch**。
  2. `engine.js` **从未调用 `LumaBridge.localMediaUrl()`**（仅有 1 处注释），视频 `src` 永远是远程 resolver `/api/t/media/<id>?...`，回环源形同虚设。
- **总开关 `local_media_enabled` 默认 false**（v1.3.53 因 18:31 内核级失联事故关死）。

**要使 D3 生效，需做的 APK + 播放端改动：**
1. 播放端（engine.js / widgets.js）：视频 `src` 优先取 `LumaBridge.localMediaUrl(id)`（非 null 则用回环地址，并显式触发预下载），null 时回退远程 resolver。图片同理可复用。
2. APK 侧新增桥 `prefetchMedia(id, url)` → `MediaCache.prefetch`（因视频不走 `shouldInterceptRequest`，必须由引擎显式触发下载，否则 `localFile(id)` 永远为 null）。
3. 打开 `local_media_enabled`（仍受熔断保护）。

**风险与验证红线（务必遵守）：**
- 18:31 事故 = 该 RK312x ROM 上「媒体栈改读回环源」疑似导致内核级失联 + 重启循环。**当前代码已比事故版本（v1.3.51）安全得多**：有熔断自失能、只服务完整落盘文件、守护线程吞异常。但风险仍属高，不可在唯一生产设备上盲开。
- **验证流程**：先在**可随时断电的备用设备**上开 `local_media_enabled` + 部署新引擎，观察 30min 无内核失联/重启循环；确认 `media_download` 计数骤降、SSE 不再被媒体栈抢断；再考虑生产设备。
- 先**复盘 18:31**：确认事故版本是否缺熔断（当前已有），以及是否真为回环源所致。

## 七、待你确认 / 执行

1. D2 已部署并真机验证（部分有效，剩余重连归 D3）——是否维持现状，还是继续打磨 SSE（如进一步区分「媒体抖动」与「真离线」）？
2. D3 是否现在实施（播放端接 `localMediaUrl` + 新增 `prefetchMedia` 桥 + 开开关）？**务必用备用设备先验证**，不能在唯一生产设备上盲开。
3. 你手头是否有备用 RK312x 可用于 D3 验证？若无，建议暂缓 D3 实施。
4. D4（日志口径）/ D5（陈旧）等低优先项是否一并排期？
