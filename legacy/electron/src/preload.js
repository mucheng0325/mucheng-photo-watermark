const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', name, bytes),
  listFonts: () => ipcRenderer.invoke('list-fonts'),
  setBgColor: hex => ipcRenderer.invoke('set-bg-color', hex),
  openOutDir: () => ipcRenderer.invoke('open-out-dir'),
  platform: process.platform
});
