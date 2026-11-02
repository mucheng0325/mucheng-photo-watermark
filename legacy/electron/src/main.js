const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { listFonts } = require('./fonts');

let win = null;
let outDir = process.env.ECW_OUT_DIR || '';

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#07090E',
    show: false,
    title: '暮呈照片水印工作台',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('choose-dir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择水印照片输出目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths.length) return '';
  outDir = r.filePaths[0];
  return outDir;
});

ipcMain.handle('list-fonts', () => listFonts());

ipcMain.handle('set-bg-color', (_e, c) => {
  try { if (win && /^#[0-9a-fA-F]{6}$/.test(String(c))) win.setBackgroundColor(String(c)); } catch (_) {}
  return { ok: true };
});

ipcMain.handle('open-out-dir', async () => {
  if (!outDir) return { ok: false, error: '未选择输出目录' };
  await shell.openPath(outDir);
  return { ok: true };
});

ipcMain.handle('save-file', async (_e, name, bytes) => {
  if (!outDir) return { ok: false, error: '未选择输出目录' };
  try {
    const safe = String(name).replace(/[\\/:*?"<>|]/g, '_');
    const p = path.join(outDir, safe);
    fs.writeFileSync(p, Buffer.from(bytes));
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
