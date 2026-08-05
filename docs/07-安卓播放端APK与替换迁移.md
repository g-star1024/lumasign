# 文档 07 · 安卓播放端 APK 与替换迁移

## 一、为什么能 0 成本替换触拓 e 版

用户现场的电子屏已内嵌「液晶互动」（触拓 CHUTO 播放端 APK），证明设备**允许侧载第三方 APK**。
灵屏播放端用一份 HTML5 播放引擎（与管理端编辑器预览、浏览器预览**同一份代码**）顶替它，
实现对等甚至更强的功能，且**不必拆墙**——首装一次后由自升级通道持续迭代。

## 二、播放端工程

工程位于 `android/`，纯 Kotlin + 原生 WebView，无第三方 SDK：

| 文件 | 职责 |
|------|------|
| `MainActivity.kt` | 全屏沉浸式 WebView，加载 `${server}/player/?mode=term`；首次配置对话框；深链配置；开机/定时拉起时应用开屏状态 |
| `LumaBridge.kt` | `window.LumaBridge` JS 桥：硬件信息、截屏、音量、重启、开关屏、亮度、定时开关机、自升级 |
| `BootReceiver.kt` | 开机自启 + 自升级后自拉起 |
| `PowerAlarmReceiver.kt` / `PowerScheduleManager.kt` | 定时开关机调度 |
| `UpdateManager.kt` | 下载 APK → FileProvider → 安装（自升级） |

构建产物 `app-release.apk` 即播放端安装包。

## 三、远程装机（嵌墙屏不拆机）

管理端「设备开通」页（Fleet 模块）已具备扫描已知 IP、指纹识别、远程推送能力：

1. **填入已知 IP**（用户已知所有屏的地址）→ 扫描。
2. **指纹识别通道优先级**：
   - `adb`（TCP 5555）：`adb install -r -g` 直接覆盖安装（最通用，多数数字标牌 ROM 开放或一处开关即可开）。
   - 厂商远程安装 API：触拓官方文档明确支持「远程升级、安装与卸载」。
   - 厂商 Web 配置页：手动上传 APK。
3. **首装后配置**：用 `lumasync://config?server=...&code=...` 深链（可印成二维码贴在运维手册）静默写入管理端地址。
4. **持续迭代**：之后管理端「终端→APK升级包」上传新版本，经 `upgrade_apk` 指令由 `UpdateManager` 自升级。

> 凡标记 `adb` 的设备，需其已开「网络 ADB 调试」。多数 CHUTO 默认开放；否则在设备设置里一键开启（可经厂商 Web 页远程完成）。

## 四、能力对齐 e 版

| e 版能力 | 灵屏实现 |
|----------|----------|
| 节目编辑/排期 | 管理端「节目制作」+ 四态排期（默认/周期/插播/独占） |
| 素材管理 | 素材库（SHA-256 去重） |
| 远程监控 | **监看墙**：管理端集中查看所有屏当前画面 + 大屏 `monitor.html` 全屏轮询 |
| 截屏 | `LumaBridge.capture` → 上传 → 监看墙展示 |
| 音量/重启/定时开关机 | JS 桥原生调用 |
| 远程升级 | 自升级 + Fleet 远程推送 |
| 开机自启 | BootReceiver |
| 播放证明（增量） | 服务端 Proof of Play 报表 |

## 五、真熄屏（root / 系统签名）

之前熄屏是「亮度置 0」的假熄屏（背光仍亮、只是黑屏、仍在耗电）。现已接成**真熄屏**：
`LumaBridge.screenOff()/screenOn()` 与定时开关机 `PowerAlarmReceiver` 统一走 `ScreenPower`：

1. **系统签名 / priv-app（真熄屏）**：APK 用设备 platform 密钥签名，或作为 priv-app 安装并授予 `DEVICE_POWER`，
   调用隐藏 API `PowerManager.goToSleep()/wakeUp()` 真正切断 / 点亮屏幕供电。
2. **root（真熄屏）**：设备已 root，经 `su` 执行 `input keyevent 26` 真正开关屏。
3. **均无**：自动降级为亮度置 0（假熄屏），保证「看起来关了」。

桥新增 `powerCapabilities()` 返回 `{root, systemPower, trueOffSupported}`，管理端可据此显示该终端是否支持真熄屏。
判定方式：`systemPower = checkSelfPermission("android.permission.DEVICE_POWER") == GRANTED`；`root = su` 探测。

> 普通用自己的 keystore 签名安装：**拿不到 `DEVICE_POWER`**，只会走 root 或降级。
> 想不 root 就真熄屏，必须走「系统签名」或「priv-app」方案（见第六节）。

## 六、构建 APK 环境与步骤

### 6.1 需要安装的软件（任选其一）

| 方案 | 软件 | 用途 |
|------|------|------|
| A. Android Studio（推荐新手） | [Android Studio](https://developer.android.com/studio)（含 SDK、Gradle、JDK） | 图形化一键 Build |
| B. 命令行（CI / 老手） | JDK 17 + [Android SDK Command-line Tools](https://developer.android.com/tools) + Gradle | `gradlew assembleRelease` |

二者都要求：
- **JDK 17**（工程 `compileOptions` / `kotlinOptions` 指定 VERSION_17）。
- **Android SDK**：`platforms;android-34`、`build-tools;34.0.0`、`platform-tools`。
- 网络（首次构建需联网下载 Gradle 分发与依赖；之后可离线）。

> 我在当前沙箱里**无法**直接执行构建：命令行解释器可用、D/E/F 盘也有空闲空间，
> 但本环境走的是**白名单代理**——只有 `dl.google.com`（Android SDK）和 `services.gradle.org`（Gradle 发行包，307 可达）放行，
> 而 **JDK 下载源 `api.adoptium.net` 超时、`mavenCentral`（`repo1.maven.org`，Gradle 依赖）超时**，
> 缺 JDK + 拉不到 Kotlin Gradle 插件依赖，编译起不来。
> 所以「打包 APK」这一步需要你在**自己电脑（有正常外网）**上完成。最简单的方式见 **6.5 一键构建**——双击一个脚本即可。

### 6.2 用 Android Studio 打包（方案 A）

1. 安装 Android Studio（勾选 Android SDK + 一路默认）。
2. `File > Open` 打开 `lumasign/android/` 目录（识别到 `settings.gradle` 即正确）。
3. 首次打开会「Sync Project with Gradle Files」，等待下载依赖完成（需联网）。
4. 生成签名密钥（一次即可，备份好）：
   `Build > Generate Signed Bundle / APK > APK > Create new keystore`
   路径选 `android/keystore.jks`，Alias 填 `lumasign`，记下密码。
5. 回到项目，把密钥信息写进 `android/keystore.properties`（对照 `keystore.properties.template`）：
   ```
   storeFile=../keystore.jks
   storePassword=你的密码
   keyAlias=lumasign
   keyPassword=你的密码
   ```
6. `Build > Select Build Variant` 选 `release`，再 `Build > Build Bundle(s) / APK(s) > Build APK(s)`。
7. 产物：`android/app/build/outputs/apk/release/app-release.apk`。

### 6.3 用命令行打包（方案 B）

> 本仓库未包含 `gradle-wrapper.jar`（二进制，不入库）。首次构建前需生成 Gradle Wrapper：
> 在已装 Gradle 的环境执行 `gradle wrapper`；或直接用 Android Studio 打开工程（会自动生成 wrapper）。
> 生成后 `gradlew` / `gradlew.bat` 就位，构建脚本即可调用；若两者皆无，脚本会自动改用系统 `gradle`。

本机装好 JDK17 + Android SDK（cmdline-tools），并 `sdkmanager` 安装：
```
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools"
```
生成密钥：
```
keytool -genkeypair -v -keystore android/keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias lumasign
```
写 `android/keystore.properties`（同上），然后执行本仓库自带脚本（自动调用 Gradle）：
- Windows：双击 `android/build-release.bat`
- Mac / Linux：`./android/build-release.sh`

产物同为 `android/app/build/outputs/apk/release/app-release.apk`。

> 没配 `keystore.properties` 也能构建，但产出的是**未签名 release**（仅本地调试用，不能正式分发 / 系统安装）。

### 6.5 一键构建（debug，零配置，推荐）

不想装 Android Studio、也不想配密钥？用本仓库自带的**一键脚本**即可，它会自己下载 JDK17 + Android SDK + Gradle 并编出可安装的 debug 包：

- Windows：双击 `android/build-apk.bat`（脚本纯 ASCII，避开中文 .bat 编码坑；内部调用 `build-apk.ps1`）。
- 脚本会自动挑一块 >25GB 空闲的盘（D/E/F…）放工具链，无需动 C 盘。
- 产物：`android/app/build/outputs/apk/debug/app-debug.apk`（**自动用 debug 密钥签名，可直接 `adb install` 安装到屏上测试 / 替换 e 版**）。

> debug 包与 release 包功能完全一致；区别仅在签名。对内网标牌自用的场景（尤其你已知所有屏 IP、走 Fleet/ADB 推送），debug 包足够。
> 若要对外分发或申请系统签名 / priv-app 真熄屏，再走 6.2 / 6.3 出 `app-release.apk` 并用 platform 密钥重签。

### 6.4 让真熄屏生效（关键）

| 你的情况 | 做法 | 结果 |
|----------|------|------|
| 设备已 root | 普通安装 APK 即可 | `ScreenPower` 走 root 分支，真熄屏生效 |
| 设备未 root，但有 OEM platform 密钥 | 用 platform 密钥重签 APK | `DEVICE_POWER` 被授予，走系统 API 真熄屏 |
| 设备未 root，能 push 到 `/system/priv-app` | 将 APK 放入 `/system/priv-app/LumaSign/`，并放 `privapp-permissions.xml` 授予 `DEVICE_POWER` | 真熄屏生效 |
| 以上都没有 | 普通安装 | 自动降级亮度 0，假熄屏（不额外耗电显示，但背光仍亮） |

`privapp-permissions.xml` 模板（放到设备 `/system/etc/permissions/`）：
```xml
<?xml version="1.0" encoding="utf-8"?>
<permissions>
    <privapp-permissions package="com.lumasign.player">
        <permission name="android.permission.DEVICE_POWER" />
        <permission name="android.permission.REBOOT" />
    </privapp-permissions>
</permissions>
```

### 6.5 安装到屏

首装见第三节「远程装机」；之后用管理端「终端 -> APK 升级包」经 `upgrade_apk` 自升级迭代。

## 七、注意事项

- **权限降级**：`reboot` 需系统签名或 root；普通安装时 `reboot` 自动降级为重启应用。
  真熄屏见第六节，无权限时降级为亮度置 0。
- **开机自启**：Android 各厂商对自启动有限制，需在各品牌「自启动管理 / 电池优化」中放行本应用。
- **离线兜底**：播放端本地缓存最近清单与素材，断网时按上次节目继续播放，不会黑屏。
- **安全**：管理端与播放端通信用令牌 + HMAC 清单签名；ADB 通道仅用于同局域网运维，建议运维完成后关闭。
