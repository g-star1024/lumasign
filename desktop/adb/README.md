# adb 二进制放置说明

远程开通（Fleet Provisioning）依赖 Android `adb` 把播放端 APK 推送到已嵌墙、无法拆机的安卓设备。
adb 走 **网络调试（TCP 5555）**，无需数据线、无需物理接触。

## 放置方式
打包前，把对应平台的 adb 可执行文件放到本目录：

- Windows：`desktop/adb/adb.exe`（以及同目录的 `AdbWinApi.dll`、`AdbWinUsbApi.dll`）
- macOS：`desktop/adb/adb`（需 `chmod +x`）

electron-builder 会将其作为 `extraResources` 复制到：
- 打包后：`resources/adb/adb(.exe)`
- 桌面端运行时自动探测；若缺失则回退到系统 `PATH` 中的 `adb`

## 获取 adb
从 Android 官方下载 **platform-tools**：
https://developer.android.com/tools/release-notes  （或 SDK Manager 中的 "Android SDK Platform-Tools"）

## 设备端前置（一次性，可远程）
安卓设备需开启「网络 ADB 调试」：
- 路径多为：设置 → 关于本机 → 连续点击「版本号」7 次开启开发者模式 → 返回 → 开发者选项 → 开启「USB 调试 / 网络 ADB 调试」→ 启用「无线调试 / ADB over network」。
- 部分数字标牌 ROM（如触拓 CHUTO）默认即开放 5555，扫描到 5555 端口即可直接开通。
- 若设备仅开放厂商 Web 配置页，则在管理端「设备开通」选择「厂商 API」并填入其升级端点。

详见 `docs/06-远程开通与APK部署.md`。
