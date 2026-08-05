# 灵屏 LumaSign · 安卓播放端 APK

Kotlin 编写的轻量 WebView 壳，加载管理端托管的 HTML5 播放引擎（`/player/?mode=term`），
通过 JS Bridge 暴露硬件/系统能力。目标是 **0 成本替换触拓 CHUTO「液晶互动」播放端**。

## 能力对照（e 版功能 → 本端实现）

| 能力 | 实现 |
|------|------|
| 远程升级 / 安装 / 卸载 | `downloadAndInstallApk()` + FileProvider 自安装；管理端 Fleet 经 ADB 远程推送 |
| 截屏上报 | `capture()` 截取 WebView → base64 → 上传 `/api/t/shot` |
| 音量控制 | `setVolume()` 调用 AudioManager |
| 重启 / 重启应用 | `reboot()`（需系统权限，失败降级重启应用）/ `restartApp()` |
| 定时开关机 | `setPowerSchedule()` + AlarmManager + PowerAlarmReceiver（熄屏省电；root/系统签名可真断电） |
| 开机自启 | BootReceiver 监听 BOOT_COMPLETED（需在厂商设置里授予自启动） |
| 全屏沉浸 | SYSTEM_UI_FLAG_IMMERSIVE_STICKY，拦截返回键防误退 |
| 硬件指纹 | `getHardwareInfo()` 上报 mac/serial/model/分辨率，作为注册幂等键 |

## 目录结构

```
android/
├── settings.gradle
├── build.gradle
├── gradle.properties
├── gradle/wrapper/gradle-wrapper.properties
├── app/
│   ├── build.gradle
│   ├── proguard-rules.pro
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/lumasign/player/
│       │   ├── MainActivity.kt        # 全屏 WebView + 桥接 + 首次配置
│       │   ├── LumaBridge.kt          # JS 桥：原生能力
│       │   ├── ScreenPower.kt         # 真熄屏统一入口（系统签名/root/降级）
│       │   ├── BootReceiver.kt        # 开机自启
│       │   ├── PowerAlarmReceiver.kt  # 定时开关机触发
│       │   ├── PowerScheduleManager.kt# 定时调度
│       │   └── UpdateManager.kt       # 自升级下载安装
│       ├── res/...                    # 布局/主题/图标/网络安全/FileProvider
```

## 构建

### 方式 A：Android Studio（推荐）
1. 打开 `android/` 目录（File → Open）。
2. 等待 Gradle 同步（首次会下载 AGP/Kotlin/依赖）。
3. 菜单 Build → Build Bundle(s) / APK(s) → Build APK(s)。
4. 产物在 `android/app/build/outputs/apk/release/app-release.apk`。

### 方式 B：命令行（需已装 Android SDK + 命令行工具）
```bash
cd android
gradle wrapper            # 若缺少 gradle wrapper jar，先生成
./gradlew assembleRelease # 或 Windows: gradlew.bat assembleRelease
```
> 若没有 gradle wrapper jar，可用本机已装的 Gradle 执行 `gradle wrapper` 生成，
> 或用 Android Studio 打开一次即自动补全。

也可直接双击 `build-release.bat`（Windows）或执行 `build-release.sh`（Mac / Linux），
脚本会自动选择 `gradlew` / 系统 `gradle`，并在缺 `keystore.properties` 时产出未签名 release。

## 首次配置（三种方式）

1. **手动**：首次打开 App 会弹出对话框，填管理端地址
   `http://192.168.1.10:7788`，可选填终端预置编码（如 `LS-0001`）。
2. **深链**：在已联网设备上点击 `lumasync://config?server=http://192.168.1.10:7788&code=LS-0001`
   即可静默写入并启动（可用于批量部署二维码）。
3. **管理端下发**：在管理端「设备开通」页经 ADB/厂商通道远程安装并预置配置。

配置存于 `SharedPreferences`，重启/自启后自动加载，无需重复输入。

## 权限说明

- `INTERNET` / `ACCESS_WIFI_STATE`：拉取节目与清单。
- `REQUEST_INSTALL_PACKAGES`：自升级安装。
- `RECEIVE_BOOT_COMPLETED`：开机自启（各厂商「自启动管理」需手动放行）。
- `SCHEDULE_EXACT_ALARM`：定时开关机。
- `REBOOT` / `DEVICE_POWER`：真重启/真熄屏（**仅系统签名或 root 应用生效**，普通安装会优雅降级）。

## 替换触拓 e 版（嵌墙屏不拆机）

1. 在管理端「设备开通」填入屏的 IP，扫描指纹。
2. 若设备开放网络 ADB(5555) 或厂商远程安装：一键推送本 APK 覆盖「液晶互动」。
3. 首装后用浏览器/深链配置管理端地址；之后由管理端「自升级」通道持续迭代。
4. 旧「液晶互动」可保留为降级兜底（本端离线仍按本地缓存播放）。

详见 `docs/07-安卓播放端APK与替换迁移.md`。
