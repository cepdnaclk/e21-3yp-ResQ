// Entry point for the Electron main process

import { app, ipcMain } from 'electron';
import { createMainWindow } from './windows/mainWindow';
import { ServiceManager } from './services/serviceManager';
import { IPC_CHANNELS } from './ipc/channels';

const manager = new ServiceManager();

app.whenReady().then(() => {
  createMainWindow();

  // IPC handlers
  ipcMain.handle(IPC_CHANNELS.START_SERVICES, async () => {
    const result = await manager.startAll();
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.STOP_SERVICES, async () => {
    const result = await manager.stopAll();
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.NETWORK_INFO, async () => {
    const info = await import('./services/networkInfo');
    return info.getNetworkInfo();
  });

  ipcMain.handle(IPC_CHANNELS.GENERATE_QR, async (_e, payload) => {
    const qr = await import('./services/qrService');
    return qr.generateQr(payload);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
