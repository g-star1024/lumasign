/**
 * 灵屏 LumaSign · Electron 预加载脚本（CJS，contextIsolation 隔离）
 * 仅暴露安全的桌面能力给渲染进程（管理端是纯 Web，绝大多数能力已走 HTTP）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumaDesktop', {
  platform: process.platform,
  // 注意：preload 运行在渲染进程，require('electron') 只有 ipcRenderer/contextBridge 等，
  // 没有 app 对象——此前在这里读 app.isPackaged 会让整个 preload 加载失败，
  // 导致 lumaDesktop（HEVC 检测/开机自启）全部不可用。
  openExternal: (u) => ipcRenderer.send('open-external', u),
  revealData: () => ipcRenderer.send('reveal-data'),
  installHevc: () => ipcRenderer.invoke('install-hevc'),
  detectHevc: () => ipcRenderer.invoke('detect-hevc'),
  // 原生文件对话框：避开 Electron 渲染进程在 DOM 中出现 <input type=file> 时崩溃的已知问题
  pickFiles: (opts) => ipcRenderer.invoke('pick-files', opts),
  openStoreHevc: () => ipcRenderer.send('open-store-hevc'),
  getStartupEnabled: () => ipcRenderer.invoke('get-startup-enabled'),
  setStartupEnabled: (b) => ipcRenderer.invoke('set-startup-enabled', b),
});
