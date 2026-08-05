/**
 * 灵屏 LumaSign · Electron 预加载脚本（CJS，contextIsolation 隔离）
 * 仅暴露安全的桌面能力给渲染进程（管理端是纯 Web，绝大多数能力已走 HTTP）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumaDesktop', {
  platform: process.platform,
  isPackaged: require('electron').app.isPackaged,
  openExternal: (u) => ipcRenderer.send('open-external', u),
  revealData: () => ipcRenderer.send('reveal-data'),
});
