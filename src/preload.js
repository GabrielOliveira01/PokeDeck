'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, listener) => {
  const handler = (_event, data) => listener(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('pokeDeck', Object.freeze({
  getState: () => ipcRenderer.invoke('app:state:get'),
  updateLayout: entries => ipcRenderer.send('layout:update', entries),
  reloadAccount: id => ipcRenderer.invoke('account:reload', id),
  resetGoogleLogin: id => ipcRenderer.invoke('account:google-reset', id),
  toggleMute: id => ipcRenderer.invoke('account:mute', id),
  togglePark: id => ipcRenderer.invoke('account:park', id),
  toggleParkAll: () => ipcRenderer.invoke('app:park-all'),
  enterImmersive: id => ipcRenderer.invoke('app:immersive-enter', id),
  exitImmersive: () => ipcRenderer.invoke('app:immersive-exit'),
  setEconomy: enabled => ipcRenderer.invoke('app:economy', enabled),
  setKeepLiveBackground: enabled => ipcRenderer.invoke('app:keep-live-background', enabled),
  selectTab: (id, tabId) => ipcRenderer.invoke('app:tab-select', id, tabId),
  closeStreamTab: tabId => ipcRenderer.invoke('app:tab-close', tabId),
  muteStreamTab: tabId => ipcRenderer.invoke('app:tab-mute', tabId),
  onState: listener => subscribe('app:state', listener),
  onMetrics: listener => subscribe('app:metrics', listener)
}));
