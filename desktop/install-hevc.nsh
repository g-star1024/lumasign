; 灵屏桌面端 NSIS 自定义脚本
; 安装完成后自动打开 Microsoft Store 的 HEVC 视频扩展页面，
; 便于用户一键「获取」，以预览 H.265/HEVC 视频（Windows 版 Chrome/Edge 默认不支持）。
; electron-builder 会在安装区段自动插入 !insertmacro postInstall
!macro postInstall
  ExecShell "open" "ms-windows-store://pdp/?ProductId=9n4wgh0z6vhq"
!macroend
