'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { parseStreamUrl } = require('./stream-url');
const { clearGoogleAuth } = require('./google-auth-reset');

const GAME_URL = 'https://pokeidle.io/app';
const MAX_ACCOUNTS = 4;
const MAX_LIVE_TABS = 12; // Protection against accidentally opening dozens of videos.
const APP_ID = 'br.independente.pokedeck4'; // Keep previous userData and 4 session partitions.
const APP_ICON = path.join(__dirname, '..', 'assets', 'pokedeck4.ico');
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
const HAS_LOCK = app.requestSingleInstanceLock();
if (!HAS_LOCK) app.quit();

const accounts = new Map();
const liveTabs = new Map();
const authWindows = new Set();
const authWindowOwners = new WeakMap();
const googleResetInProgress = new Set();
let nextLiveTabId = 1;
let mainWindow = null;
let metricsTimer = null;
let notice = '';
let preferences = { economy: true, keepLiveBackground: true, muted: [false, true, true, true] };

const validAccountId = id => Number.isInteger(id) && id >= 1 && id <= MAX_ACCOUNTS;
const isOurWindow = event => Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id);
function configPath() { return path.join(app.getPath('userData'), 'preferences.json'); }
function loadPreferences() {
  try {
    const data = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (typeof data.economy === 'boolean') preferences.economy = data.economy;
    if (typeof data.keepLiveBackground === 'boolean') preferences.keepLiveBackground = data.keepLiveBackground;
    if (Array.isArray(data.muted) && data.muted.length === 4 && data.muted.every(v => typeof v === 'boolean')) preferences.muted = data.muted;
  } catch { /* First run. */ }
}
function savePreferences() {
  try { fs.writeFileSync(configPath(), JSON.stringify(preferences, null, 2), { mode: 0o600 }); }
  catch (error) { console.warn('Falha ao salvar preferências:', error.message); }
}
function liveBackgroundThrottling() {
  // WARNING: false on a WebContentsView may disable frame throttling for ALL
  // views in the owning BrowserWindow. This costs CPU but avoids deliberate
  // background timer/render throttling for ongoing video playback.
  return preferences.keepLiveBackground ? false : preferences.economy;
}
function publicState() {
  return {
    economy: preferences.economy,
    keepLiveBackground: preferences.keepLiveBackground,
    notice,
    streams: Array.from(liveTabs.values(), tab => ({
      tabId: tab.tabId, id: tab.id, provider: tab.provider, channel: tab.channel,
      muted: tab.muted, status: tab.status
    })),
    accounts: Array.from(accounts.values(), acc => ({
      id: acc.id, muted: acc.muted, status: acc.status,
      parked: acc.parked, selectedTab: acc.selectedTab
    }))
  };
}
function sendState() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('app:state', publicState());
  }
}
function showNotice(message) {
  notice = message;
  sendState();
}
function destroyView(view) {
  if (!view) return;
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(view); }
  catch { /* Detached. */ }
  if (!view.webContents.isDestroyed()) view.webContents.close();
}
function setEco(enabled) {
  preferences.economy = enabled;
  for (const acc of accounts.values()) {
    if (!acc.view.webContents.isDestroyed()) acc.view.webContents.setBackgroundThrottling(enabled);
  }
  for (const tab of liveTabs.values()) {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.setBackgroundThrottling(liveBackgroundThrottling());
  }
  for (const popup of authWindows) {
    if (!popup.isDestroyed()) popup.webContents.setBackgroundThrottling(enabled);
  }
  savePreferences(); sendState();
}
function setKeepLiveBackground(enabled) {
  preferences.keepLiveBackground = enabled;
  for (const tab of liveTabs.values()) {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.setBackgroundThrottling(liveBackgroundThrottling());
  }
  savePreferences(); sendState();
}
function captureStreamNavigation(ownerId, rawUrl) {
  const stream = parseStreamUrl(rawUrl);
  if (!stream || !validAccountId(ownerId)) return false;
  // Avoid constructing WebContents synchronously during window.open callbacks.
  setImmediate(() => openStreamTab(ownerId, stream));
  return true;
}
function makeSafePopupHandler(browserSession, ownerId) {
  return ({ url }) => {
    if (captureStreamNavigation(ownerId, url)) return { action: 'deny' };
    if (url !== 'about:blank') {
      try { if (new URL(url).protocol !== 'https:') return { action: 'deny' }; }
      catch { return { action: 'deny' }; }
    }
    // OAuth/support popups may still open as dialogs. STREAMS never do.
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 710, height: 740, minWidth: 460, minHeight: 340,
        show: url !== 'about:blank', icon: APP_ICON,
        backgroundColor: '#09111d', autoHideMenuBar: true,
        webPreferences: {
          session: browserSession, nodeIntegration: false, contextIsolation: true,
          sandbox: true, webSecurity: true, backgroundThrottling: preferences.economy
        }
      }
    };
  };
}
function watchPopup(ownerId, popup) {
  authWindows.add(popup);
  authWindowOwners.set(popup, ownerId);
  popup.on('closed', () => authWindows.delete(popup));
  popup.webContents.on('did-navigate', (_event, url) => {
    if (url !== 'about:blank' && !parseStreamUrl(url) && !popup.isDestroyed() && !popup.isVisible()) popup.show();
  });
  popup.webContents.on('will-navigate', (event, details) => {
    const url = typeof details === 'string' ? details : details.url;
    if (captureStreamNavigation(ownerId, url)) {
      event.preventDefault();
      if (!popup.isDestroyed()) popup.close();
    }
  });
}
function createAccount(id) {
  // SAME persistent partitions as PokeDeck 2.0–2.2: do not force relogin.
  const browserSession = session.fromPartition(`persist:pokeidle-account-${id}`);
  const view = new WebContentsView({
    webPreferences: {
      session: browserSession, nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, backgroundThrottling: preferences.economy,
      spellcheck: false
    }
  });
  view.setVisible(false);
  mainWindow.contentView.addChildView(view);
  const acc = { id, view, browserSession, muted: preferences.muted[id - 1], status: 'Carregando', parked: false, selectedTab: 'game' };
  accounts.set(id, acc);
  view.webContents.setAudioMuted(acc.muted);
  view.webContents.on('did-start-loading', () => { acc.status = 'Carregando'; sendState(); });
  view.webContents.on('did-finish-load', () => { acc.status = 'Site aberto'; sendState(); });
  view.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { acc.status = 'Falha na conexão'; sendState(); }
  });
  view.webContents.on('render-process-gone', () => { acc.status = 'Falha na aba'; sendState(); });
  view.webContents.setWindowOpenHandler(makeSafePopupHandler(browserSession, id));
  view.webContents.on('did-create-window', popup => watchPopup(id, popup));
  view.webContents.on('will-navigate', (event, details) => {
    const url = typeof details === 'string' ? details : details.url;
    if (captureStreamNavigation(id, url)) event.preventDefault();
  });
  view.webContents.loadURL(GAME_URL).catch(() => {
    acc.status = 'Falha na conexão'; sendState();
  });
}
function createStreamView(tab) {
  const acc = accounts.get(tab.id);
  if (!acc || !mainWindow || mainWindow.isDestroyed()) return;
  const view = new WebContentsView({
    webPreferences: {
      // Keep the matching account's own Twitch/Kick cookies and credentials.
      session: acc.browserSession, nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, backgroundThrottling: liveBackgroundThrottling(),
      spellcheck: false
    }
  });
  tab.view = view;
  view.setVisible(false);
  mainWindow.contentView.addChildView(view);
  view.webContents.setAudioMuted(tab.muted);
  view.webContents.on('did-start-loading', () => {
    if (liveTabs.has(tab.tabId)) { tab.status = 'Carregando'; sendState(); }
  });
  view.webContents.on('did-finish-load', () => {
    if (liveTabs.has(tab.tabId)) { tab.status = 'Página aberta'; sendState(); }
  });
  view.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (liveTabs.has(tab.tabId) && isMainFrame && code !== -3) { tab.status = 'Falha ao carregar'; sendState(); }
  });
  view.webContents.on('render-process-gone', () => {
    if (liveTabs.has(tab.tabId)) { tab.status = 'Falha no player'; sendState(); }
  });
  view.webContents.setWindowOpenHandler(makeSafePopupHandler(acc.browserSession, tab.id));
  view.webContents.on('did-create-window', popup => watchPopup(tab.id, popup));
  view.webContents.on('will-navigate', (event, details) => {
    const rawUrl = typeof details === 'string' ? details : details.url;
    const parsed = parseStreamUrl(rawUrl);
    // Visiting ANOTHER channel inside a live creates a new tab; a redirect
    // to the currently open stream is allowed to stay in the original tab.
    if (parsed && parsed.url !== tab.url) {
      event.preventDefault(); captureStreamNavigation(tab.id, rawUrl);
    }
  });
  view.webContents.loadURL(tab.url).catch(error => {
    if (liveTabs.has(tab.tabId)) {
      tab.status = 'Falha ao carregar'; console.warn('Erro na live:', error.message); sendState();
    }
  });
}
function openStreamTab(id, stream) {
  const acc = accounts.get(id);
  if (!acc || !stream) return false;
  if (liveTabs.size >= MAX_LIVE_TABS) {
    showNotice(`Limite de ${MAX_LIVE_TABS} abas de live. Feche uma antes de abrir outra.`);
    return false;
  }
  notice = '';
  acc.parked = false;
  const tab = {
    tabId: `live-${nextLiveTabId++}`, id, ...stream,
    muted: false, status: 'Carregando', view: null
  };
  liveTabs.set(tab.tabId, tab);
  acc.selectedTab = tab.tabId;
  createStreamView(tab);
  sendState();
  return true;
}
function selectTab(id, tabId) {
  const acc = accounts.get(id);
  if (!acc || typeof tabId !== 'string') return false;
  if (tabId !== 'game' && (!liveTabs.has(tabId) || liveTabs.get(tabId).id !== id)) return false;
  acc.parked = false;
  acc.selectedTab = tabId;
  // Do NOT destroy, reload or pause other streams. Chromium may still throttle
  // hidden media or providers may stop it; no bonus eligibility guarantee.
  sendState();
  return true;
}
function closeStreamTab(tabId) {
  const tab = liveTabs.get(tabId);
  if (!tab) return false;
  liveTabs.delete(tabId);
  const acc = accounts.get(tab.id);
  if (acc && acc.selectedTab === tabId) acc.selectedTab = 'game';
  destroyView(tab.view); // Closing, and ONLY closing, frees this live player.
  sendState();
  return true;
}
function updateLayout(event, entries) {
  if (!isOurWindow(event) || !Array.isArray(entries) || entries.length !== MAX_ACCOUNTS) return;
  const [w, h] = mainWindow.getContentSize();
  for (const acc of accounts.values()) {
    const entry = entries.find(item => item && item.id === acc.id);
    const rect = entry && entry.rect;
    const valid = Boolean(!acc.parked && rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
      rect.width >= 100 && rect.height >= 100 && rect.x >= 0 && rect.y >= 0 &&
      rect.x + rect.width <= w + 3 && rect.y + rect.height <= h + 3);
    const bounds = valid ? {
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.floor(rect.width), height: Math.floor(rect.height)
    } : null;
    const gameVisible = valid && acc.selectedTab === 'game';
    acc.view.setVisible(Boolean(gameVisible));
    if (gameVisible) acc.view.setBounds(bounds);
    for (const tab of liveTabs.values()) {
      if (tab.id !== acc.id || !tab.view) continue;
      const selected = valid && acc.selectedTab === tab.tabId;
      tab.view.setVisible(Boolean(selected));
      if (selected) tab.view.setBounds(bounds);
      // All hidden WebContents survive and retain their navigation/playback.
    }
  }
}
function sendMetrics() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return;
  const samples = app.getAppMetrics();
  const memoryKb = samples.reduce((sum, metric) => {
    const mem = metric.memory || {};
    const kb = process.platform === 'win32' ? (mem.privateBytes ?? mem.workingSetSize) : mem.workingSetSize;
    return sum + (Number.isFinite(kb) ? kb : 0);
  }, 0);
  const cpu = samples.reduce((sum, metric) => sum + (Number.isFinite(metric.cpu?.percentCPUUsage) ? metric.cpu.percentCPUUsage : 0), 0);
  mainWindow.webContents.send('app:metrics', {
    mb: Math.max(0, Math.round(memoryKb / 1024)),
    cpu: Math.max(0, Math.round(cpu * 10) / 10)
  });
}
function setupIPC() {
  ipcMain.handle('app:state:get', event => isOurWindow(event) ? publicState() : null);
  ipcMain.on('layout:update', updateLayout);

  ipcMain.handle('account:google-reset', async (event, id) => {
    if (!isOurWindow(event) || !validAccountId(id) || googleResetInProgress.has(id)) return false;
    const acc = accounts.get(id);
    if (!acc) return false;
    googleResetInProgress.add(id);
    const oldStatus = acc.status;
    acc.status = 'Limpando login Google';
    sendState();
    try {
      // Invalidate only active OAuth popups for THIS account.
      for (const popup of [...authWindows]) {
        if (authWindowOwners.get(popup) === id && !popup.isDestroyed()) popup.close();
      }
      await clearGoogleAuth(acc.browserSession);
      acc.selectedTab = 'game';
      acc.parked = false;
      await acc.view.webContents.loadURL(GAME_URL);
      showNotice(`Conta ${id}: tentativa de login Google redefinida. Clique em Entrar com Google e escolha outro e-mail.`);
      return true;
    } catch (error) {
      acc.status = oldStatus;
      showNotice(`Conta ${id}: não foi possível limpar a sessão do Google. ${error.message}`);
      return false;
    } finally {
      googleResetInProgress.delete(id);
      sendState();
    }
  });
  ipcMain.handle('account:reload', (event, id) => {
    if (!isOurWindow(event) || !validAccountId(id)) return false;
    const acc = accounts.get(id);
    if (!acc) return false;
    const tab = liveTabs.get(acc.selectedTab);
    (tab?.view || acc.view).webContents.reload();
    return true;
  });
  ipcMain.handle('account:mute', (event, id) => {
    if (!isOurWindow(event) || !validAccountId(id)) return false;
    const acc = accounts.get(id);
    if (!acc) return false;
    acc.muted = !acc.muted;
    acc.view.webContents.setAudioMuted(acc.muted);
    preferences.muted[id - 1] = acc.muted;
    savePreferences(); sendState(); return true;
  });
  ipcMain.handle('account:park', (event, id) => {
    if (!isOurWindow(event) || !validAccountId(id)) return false;
    const acc = accounts.get(id);
    if (!acc) return false;
    acc.parked = !acc.parked;
    if (acc.parked) acc.view.setVisible(false);
    // Streams remain open while account panel is parked, by design.
    sendState(); return true;
  });
  ipcMain.handle('app:economy', (event, enabled) => {
    if (!isOurWindow(event) || typeof enabled !== 'boolean') return false;
    setEco(enabled); return true;
  });
  ipcMain.handle('app:keep-live-background', (event, enabled) => {
    if (!isOurWindow(event) || typeof enabled !== 'boolean') return false;
    setKeepLiveBackground(enabled); return true;
  });
  ipcMain.handle('app:tab-select', (event, id, tabId) => isOurWindow(event) && selectTab(id, tabId));
  ipcMain.handle('app:tab-close', (event, tabId) => isOurWindow(event) && closeStreamTab(tabId));
  ipcMain.handle('app:tab-mute', (event, tabId) => {
    if (!isOurWindow(event)) return false;
    const tab = liveTabs.get(tabId);
    if (!tab || !tab.view) return false;
    tab.muted = !tab.muted;
    tab.view.webContents.setAudioMuted(tab.muted);
    sendState(); return true;
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'PokeDeck 4 · Premium Eco',
    width: 1540, height: 920, minWidth: 950, minHeight: 640,
    backgroundColor: '#090f19', autoHideMenuBar: true, icon: APP_ICON, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: true
    }
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('did-finish-load', () => {
    if (accounts.size === 0) for (let id = 1; id <= MAX_ACCOUNTS; id++) createAccount(id);
    sendState();
  });
  metricsTimer = setInterval(sendMetrics, 10000);
  metricsTimer.unref();
  mainWindow.on('closed', () => {
    if (metricsTimer) clearInterval(metricsTimer);
    metricsTimer = null;
    for (const tab of liveTabs.values()) destroyView(tab.view);
    liveTabs.clear();
    for (const popup of authWindows) if (!popup.isDestroyed()) popup.close();
    authWindows.clear();
    for (const acc of accounts.values()) destroyView(acc.view);
    accounts.clear(); mainWindow = null;
  });
}
if (HAS_LOCK) {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => { loadPreferences(); setupIPC(); createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); });
}
