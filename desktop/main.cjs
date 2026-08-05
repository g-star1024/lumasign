/**
 * 灵屏 LumaSign · Electron 桌面端主进程（CJS）
 *
 * 关键设计：
 *  - 同进程托管 Node 服务端：Electron 主进程本身就是 Node，直接 import('../server/server.js').init()，
 *    无需单独打包 node 二进制、无需子进程管理。服务端读写数据落在 userData（asar 之外）。
 *  - 启动顺序：显示 macOS 风格 loading → 等服务端 ready → 加载管理端。
 *  - 打包后 adb 置于 extraResources/adb；开发态回退到 PATH 的 adb。
 *  - 单实例锁、托盘、优雅退出（flush 数据）。
 */
const { app, BrowserWindow, Tray, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const isWin = process.platform === 'win32';
const isPackaged = app.isPackaged;
const ROOT = isPackaged ? path.dirname(__dirname) : path.resolve(__dirname, '..');

const PORT = parseInt(process.env.LUMASIGN_PORT || '7788', 10);
const DATA_DIR = path.join(app.getPath('userData'), 'lumasign-data');
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.LUMASIGN_DATA = DATA_DIR;

// adb 路径：打包态用 resources/adb，开发态用 desktop/adb，缺失则回退 PATH 中的 adb
const adbRel = isPackaged
  ? path.join(process.resourcesPath, 'adb', isWin ? 'adb.exe' : 'adb')
  : path.join(__dirname, 'adb', isWin ? 'adb.exe' : 'adb');
const ADB_PATH = fs.existsSync(adbRel) ? adbRel : 'adb';
process.env.LUMASIGN_ADB = ADB_PATH;

let mainWin = null;
let tray = null;
let serverApi = null;       // { shutdown }

/* ---------------- 单实例 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

app.on('second-instance', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });

/* ---------------- 窗口 ---------------- */
function createWindow() {
  const win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 980, minHeight: 640,
    show: false,
    title: '灵屏 LumaSign',
    titleBarStyle: isWin ? 'default' : 'hiddenInset',
    vibrancy: isWin ? undefined : 'sidebar',
    backgroundColor: '#0e0f13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 先展示 loading（file://），服务端 ready 后再切到管理端
  win.loadFile(path.join(__dirname, 'loading.html'));

  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    if (process.platform === 'darwin' && !forceQuit) {
      e.preventDefault(); win.hide();
    }
  });
  return win;
}

let forceQuit = false;
app.on('before-quit', () => { forceQuit = true; });

/* ---------------- 托盘 ---------------- */
function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'tray.png'));
  } catch { return; } // 缺图标不致命
  const ctx = Menu.buildFromTemplate([
    { label: '打开管理端', click: () => { if (mainWin) { mainWin.show(); mainWin.focus(); } } },
    { label: '打开数据目录', click: () => shell.showItemInFolder(DATA_DIR) },
    { type: 'separator' },
    { label: '退出', click: () => { forceQuit = true; app.quit(); } },
  ]);
  tray.setToolTip('灵屏 LumaSign');
  tray.setContextMenu(ctx);
  tray.on('click', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
}

/* ---------------- 启动服务端（同进程） ---------------- */
async function startServer() {
  // 用 pathToFileURL 转 file:// 协议：ESM 动态 import 只接受 file:/data: URL，不接受裸路径
  const serverEntry = pathToFileURL(path.resolve(__dirname, '..', 'server', 'server.js')).href;
  const { init } = await import(serverEntry);
  // 监听 0.0.0.0：本地窗口用 127.0.0.1 访问；局域网安卓设备也能连接注册/发现
  serverApi = await init({ dataDir: DATA_DIR, port: PORT, adbPath: ADB_PATH, host: '0.0.0.0' });
  await serverApi.ready;
}

/* ---------------- App 生命周期 ---------------- */
app.whenReady().then(async () => {
  mainWin = createWindow();
  createTray();

  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox('灵屏服务端启动失败', String(e && e.stack || e));
    app.quit();
    return;
  }

  // 服务端就绪，加载管理端
  const url = `http://127.0.0.1:${PORT}/`;
  mainWin.loadURL(url);

  // 外部链接走系统浏览器
  mainWin.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return { action: 'allow' };
    shell.openExternal(u);
    return { action: 'deny' };
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow(); });

app.on('before-quit', () => {
  try { if (serverApi && serverApi.shutdown) serverApi.shutdown(); } catch {}
});

// 桌面端暴露给渲染进程的远端调用
const { ipcMain } = require('electron');
ipcMain.on('open-external', (e, u) => { try { shell.openExternal(u); } catch {} });
ipcMain.on('reveal-data', () => { try { shell.showItemInFolder(DATA_DIR); } catch {} });
