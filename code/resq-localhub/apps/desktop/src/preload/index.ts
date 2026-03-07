import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../main/ipc/channels';

contextBridge.exposeInMainWorld('electronAPI', {
  startServices: () => ipcRenderer.invoke(IPC_CHANNELS.START_SERVICES),
  stopServices: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_SERVICES),
  onServiceStatus: (cb: (status: any) => void) => ipcRenderer.on(IPC_CHANNELS.SERVICE_STATUS, (_e, status) => cb(status)),
  getNetworkInfo: () => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_INFO),
  generateQr: (payload: string) => ipcRenderer.invoke(IPC_CHANNELS.GENERATE_QR, payload),
});
