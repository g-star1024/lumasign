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
const { spawnSync } = require('node:child_process');
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
    // 关闭窗口 = 最小化到托盘（而非退出）。服务端同进程托管，必须常驻后台。
    // 仅托盘「退出」或 before-quit 会置 forceQuit=true，届时不再拦截、真正退出。
    if (!forceQuit) {
      e.preventDefault();
      win.hide();
      maybeHintTray();
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
  const trayItems = [
    { label: '打开管理端', click: () => { if (mainWin) { mainWin.show(); mainWin.focus(); } } },
    { label: '打开数据目录', click: () => shell.showItemInFolder(DATA_DIR) },
  ];
  if (isWin) trayItems.push({
    label: '安装 HEVC 视频扩展',
    click: () => { const r = installHevcExtension(); if (!r.ok) dialog.showErrorBox('安装未自动完成', (r.message || '') + '\n请手动在 Microsoft Store 搜索「HEVC 视频扩展」安装。'); },
  });
  trayItems.push({ type: 'separator' }, { label: '退出', click: () => { forceQuit = true; app.quit(); } });
  const ctx = Menu.buildFromTemplate(trayItems);
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

  // 首次启动引导安装 HEVC 扩展（缺失则提示一次）
  maybePromptHevc();

  // 外部链接走系统浏览器
  mainWin.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return { action: 'allow' };
    shell.openExternal(u);
    return { action: 'deny' };
  });
});

app.on('window-all-closed', () => {
  // 不自动退出：服务端同进程托管，需常驻后台持续运行。
  // 窗口「关闭」实为隐藏到托盘（见 win.on('close')）；仅托盘「退出」或 before-quit 才真正退出。
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow(); });

app.on('before-quit', () => {
  try { if (serverApi && serverApi.shutdown) serverApi.shutdown(); } catch {}
});

// 桌面端暴露给渲染进程的远端调用
const { ipcMain } = require('electron');
ipcMain.on('open-external', (e, u) => { try { shell.openExternal(u); } catch {} });
ipcMain.on('reveal-data', () => { try { shell.showItemInFolder(DATA_DIR); } catch {} });

/* ---------------- HEVC 视频扩展：检测 / 一键安装 ----------------
 * HEVC 扩展是 Windows Store 应用，装的是"让 Windows 系统能解码 H.265"的能力。
 * 管理端浏览器（Windows 上的 Chrome/Edge）需要它才能预览 H.265 视频。
 * 桌面端有系统权限，可在首次启动检测并触发安装。 */
const HEVC_STORE_URL = 'ms-windows-store://pdp/?ProductId=9n4wgh0z6vhq';

function detectHevcWindows() {
  if (!isWin) return null;            // 非 Windows：macOS 多原生支持，返回 unknown
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      'Get-AppxPackage -Name *HEVC* | Select-Object -First 1 -ExpandProperty Name'],
      { encoding: 'utf8', timeout: 8000 });
    return !!String(r.stdout || '').trim();
  } catch { return null; }
}

function installHevcExtension() {
  if (!isWin) {
    return { ok: false, message: '当前平台（macOS）通常原生支持 HEVC；若无法预览请改用 Safari 或转码为 H.264。' };
  }
  // 优先 winget 静默安装（需 Windows 10 1809+ 且已装 App Installer）
  try {
    const r = spawnSync('winget', ['install', '--exact',
      '--accept-package-agreements', '--accept-source-agreements', '--silent',
      'Microsoft.HEVCVideoExtensions'], { encoding: 'utf8', timeout: 180000 });
    if (r.status === 0) return { ok: true, method: 'winget' };
  } catch {}
  // 退回打开 Microsoft Store 页面（用户点「获取」即可）
  try { shell.openExternal(HEVC_STORE_URL); return { ok: true, method: 'store' }; }
  catch (e) { return { ok: false, message: String((e && e.message) || e) }; }
}

ipcMain.handle('detect-hevc', () => detectHevcWindows());
ipcMain.handle('install-hevc', () => installHevcExtension());
ipcMain.on('open-store-hevc', () => { try { shell.openExternal(HEVC_STORE_URL); } catch {} });

// 首次「关闭窗口最小化到托盘」时提示一次，避免 Windows 用户误以为程序已退出/崩溃
function maybeHintTray() {
  if (!isWin) return;
  const flag = path.join(app.getPath('userData'), 'tray-hinted.json');
  if (fs.existsSync(flag)) return;
  try { fs.writeFileSync(flag, '1'); } catch {}
  dialog.showMessageBox(undefined, {
    type: 'info',
    title: '已最小化到系统托盘',
    message: '管理端窗口已最小化到系统托盘，灵屏服务端仍在后台运行（设备可继续连接）。',
    detail: '如需完全退出程序，请在系统托盘（任务栏右下角）的灵屏图标上右键选择「退出」。',
    buttons: ['知道了'], defaultId: 0,
  });
}

// 首次启动（仅 Windows、仅提示一次）：缺失则引导安装 HEVC 扩展
async function maybePromptHevc() {
  if (!isWin) return;
  const flag = path.join(app.getPath('userData'), 'hevc-prompted.json');
  if (fs.existsSync(flag)) return;
  try { fs.writeFileSync(flag, JSON.stringify({ promptedAt: Date.now() })); } catch {}
  let installed = false;
  try { installed = detectHevcWindows() === true; } catch {}
  if (installed) return;
  const { response } = await dialog.showMessageBox(mainWin || undefined, {
    type: 'info',
    title: '建议安装 HEVC 视频扩展',
    message: '本机尚未安装 Windows HEVC 视频扩展，预览 H.265 视频会黑屏。是否现在安装？',
    detail: '灵屏已内置一键安装：点「安装」将打开 Microsoft Store，点击「获取」即可。安卓播放端不受影响。',
    buttons: ['现在安装', '稍后'], defaultId: 0, cancelId: 1,
  });
  if (response === 0) {
    const r = installHevcExtension();
    if (!r.ok) dialog.showErrorBox('安装未自动完成', (r.message || '') + '\n请手动在 Microsoft Store 搜索「HEVC 视频扩展」安装。');
  }
}
