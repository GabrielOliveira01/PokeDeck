'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');
const { parseStreamUrl } = require('../src/stream-url');
const { clearGoogleAuth } = require('../src/google-auth-reset');
const source = readFileSync(join(__dirname, '..', 'src', 'main.js'), 'utf8');

function makeRuntime() {
  const ipc = new Map();
  const views = [];
  const sessions = new Map();
  let index = 0;
  class FakeContents extends EventEmitter {
    constructor() { super(); this.id = ++index; this.closed = false; this.throttling = true; }
    isDestroyed() { return this.closed; }
    close() { this.closed = true; }
    setBackgroundThrottling(value) { this.throttling = value; }
    setAudioMuted(value) { this.audioMuted = value; }
    setWindowOpenHandler(handler) { this.popupHandler = handler; }
    loadURL() { this.emit('did-finish-load'); return Promise.resolve(); }
    reload() {}
    send() {}
  }
  class FakeView {
    constructor({ webPreferences }) {
      this.webContents = new FakeContents();
      this.webContents.throttling = webPreferences.backgroundThrottling;
      this.prefs = webPreferences;
      views.push(this);
    }
    setVisible(value) { this.visible = value; }
    setBounds(bounds) { this.bounds = bounds; }
  }
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new FakeContents();
      this.contentView = { addChildView() {}, removeChildView() {} };
      this.destroyed = false;
      this.fullScreen = false;
    }
    loadFile() { Promise.resolve().then(() => this.webContents.emit('did-finish-load')); }
    getContentSize() { return [1540, 920]; }
    setFullScreen(value) { this.fullScreen = value; this.emit(value ? 'enter-full-screen' : 'leave-full-screen'); }
    isFullScreen() { return this.fullScreen; }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    isVisible() { return true; }
    show() {}
  }
  class FakeApp extends EventEmitter {
    setAppUserModelId() {}
    requestSingleInstanceLock() { return true; }
    whenReady() { return Promise.resolve(); }
    getPath() { return '/unwritable/test-profile'; }
    getAppMetrics() { return []; }
  }
  const app = new FakeApp();
  let mainWindow;
  const context = {
    require: name => name === 'electron'
      ? { app, BrowserWindow: class extends FakeWindow { constructor() { super(); mainWindow = this; } }, WebContentsView: FakeView,
          ipcMain: { handle: (name, handler) => ipc.set(name, handler), on: () => {} },
          session: { fromPartition: id => {
            if (!sessions.has(id)) sessions.set(id, {
              id,
              removedCookies: [],
              clearedOrigins: [],
              cookies: {
                get: async () => [
                  { domain: '.google.com', name: 'SID', path: '/' },
                  { domain: 'pokeidle.io', name: 'session', path: '/' }
                ],
                remove: async (url, name) => { sessions.get(id).removedCookies.push({ url, name }); },
                flushStore: async () => {}
              },
              clearStorageData: async options => { sessions.get(id).clearedOrigins.push(options); }
            });
            return sessions.get(id);
          } },
          Menu: { setApplicationMenu() {} } }
      : name === './stream-url' ? { parseStreamUrl }
      : name === './google-auth-reset' ? { clearGoogleAuth } : require(name),
    __dirname: join(__dirname, '..', 'src'), process, setInterval, clearInterval, setImmediate,
    console, Buffer, URL
  };
  vm.runInNewContext(source, context);
  return { ipc, views, sessions, get window() { return mainWindow; } };
}

test('fluxo real: duas lives na conta 1 continuam abertas após voltar ao JOGO', async () => {
  const rt = makeRuntime();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(rt.views.length, 4, 'criou 4 contas');
  const firstGame = rt.views[0];
  const secondGame = rt.views[1];
  assert.notEqual(firstGame.prefs.session, secondGame.prefs.session, 'partições isoladas');
  assert.equal(firstGame.prefs.session.id, 'persist:pokeidle-account-1');
  const open = firstGame.webContents.popupHandler;
  assert.equal(open({ url: 'https://www.twitch.tv/streamer_a' }).action, 'deny');
  assert.equal(open({ url: 'https://kick.com/streamer-b' }).action, 'deny');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(rt.views.length, 6);
  const getState = rt.ipc.get('app:state:get');
  // The only authorizer of ipc calls is the BrowserWindow's own webContents.
  // FakeContents IDs: main Window = 1; accounts 2..5.
  const event = { sender: { id: 1 } };
  const state = getState(event);
  assert.equal(state.streams.length, 2);
  assert.equal(state.accounts[0].selectedTab, state.streams[1].tabId);
  assert.equal(rt.views[4].prefs.session, firstGame.prefs.session);
  assert.equal(rt.views[5].prefs.session, firstGame.prefs.session);
  assert.equal(rt.views[4].webContents.throttling, false, 'prioritize background live playback');
  assert.equal(rt.ipc.get('app:tab-select')(event, 1, 'game'), true);
  assert.equal(getState(event).accounts[0].selectedTab, 'game');
  assert.equal(rt.views[4].webContents.closed, false, 'stream 1 retained');
  assert.equal(rt.views[5].webContents.closed, false, 'stream 2 retained');
  assert.equal(rt.ipc.get('app:tab-close')(event, state.streams[0].tabId), true);
  assert.equal(rt.views[4].webContents.closed, true, 'only chosen stream closed');
  assert.equal(rt.views[5].webContents.closed, false);
  assert.equal(getState(event).streams.length, 1);
  assert.equal(rt.ipc.get('app:keep-live-background')(event, false), true);
  assert.equal(rt.views[5].webContents.throttling, true, 'economy option re-enables throttling');
});


test('trocar Google na conta 2 remove Google apenas do perfil 2 sem afetar outras contas ou o jogo', async () => {
  const rt = makeRuntime();
  await new Promise(resolve => setTimeout(resolve, 20));
  const event = { sender: { id: 1 } };
  const handler = rt.ipc.get('account:google-reset');
  assert.equal(await handler(event, 2), true);
  const s2 = rt.sessions.get('persist:pokeidle-account-2');
  assert.deepEqual(s2.removedCookies, [{ url: 'https://google.com/', name: 'SID' }]);
  assert.deepEqual(s2.clearedOrigins, [{
    origin: 'https://accounts.google.com',
    storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers']
  }]);
  for (const id of [1, 3, 4]) {
    assert.equal(rt.sessions.get(`persist:pokeidle-account-${id}`).removedCookies.length, 0);
  }
  assert.equal(rt.ipc.get('app:state:get')(event).accounts[1].selectedTab, 'game');
  assert.equal(await handler({ sender: { id: 9999 } }, 2), false, 'blocked unauthorized IPC');
  assert.equal(await handler(event, 5), false, 'blocked invalid account');
});


test('tela cheia usa somente a conta escolhida e sai com Escape sem perder sessões', async () => {
  const rt = makeRuntime();
  await new Promise(resolve => setTimeout(resolve, 20));
  const event = { sender: { id: rt.window.webContents.id } };
  const enter = rt.ipc.get('app:immersive-enter');
  const getState = rt.ipc.get('app:state:get');
  assert.equal(enter(event, 3), true);
  assert.equal(rt.window.isFullScreen(), true);
  assert.equal(getState(event).immersiveAccountId, 3);
  assert.equal(getState(event).accounts[2].selectedTab, 'game');
  assert.equal(enter({ sender: { id: -1 } }, 2), false, 'rejeita origem externa');
  let prevented = false;
  rt.views[2].webContents.emit('before-input-event', {
    preventDefault() { prevented = true; }
  }, { type: 'keyDown', key: 'Escape' });
  assert.equal(prevented, true, 'Escape tem prioridade no jogo');
  assert.equal(rt.window.isFullScreen(), false);
  assert.equal(getState(event).immersiveAccountId, null);
  assert.equal(rt.views[2].webContents.closed, false);
  assert.equal(enter(event, 1), true);
  rt.window.setFullScreen(false); // User/OS exited without our IPC.
  assert.equal(getState(event).immersiveAccountId, null);
  assert.equal(rt.ipc.get('app:immersive-exit')(event), false, 'fora de tela cheia');
});

test('ocultar quatro contas ao mesmo tempo e restaurar não encerra sessão/lives', async () => {
  const rt = makeRuntime();
  await new Promise(resolve => setTimeout(resolve, 20));
  const event = { sender: { id: rt.window.webContents.id } };
  const getState = rt.ipc.get('app:state:get');
  const toggle = rt.ipc.get('app:park-all');
  assert.equal(toggle(event), true);
  assert.equal(getState(event).allParked, true);
  assert.ok(getState(event).accounts.every(acc => acc.parked));
  assert.ok(rt.views.slice(0, 4).every(view => view.visible === false));
  assert.equal(toggle(event), true);
  assert.equal(getState(event).allParked, false);
  assert.ok(getState(event).accounts.every(acc => !acc.parked));
  assert.ok(rt.views.slice(0, 4).every(view => !view.webContents.closed));
  assert.equal(toggle({ sender: { id: 999 } }), false);
});

test('cada nova live inicia mutada; só a aba escolhida pode ser desmutada no app', async () => {
  const rt = makeRuntime();
  await new Promise(resolve => setTimeout(resolve, 20));
  const event = { sender: { id: rt.window.webContents.id } };
  rt.views[0].webContents.popupHandler({ url: 'https://www.twitch.tv/mute_a' });
  rt.views[0].webContents.popupHandler({ url: 'https://kick.com/mute_b' });
  await new Promise(resolve => setTimeout(resolve, 20));
  const state = rt.ipc.get('app:state:get')(event);
  assert.equal(state.streams.length, 2);
  assert.ok(state.streams.every(tab => tab.muted));
  assert.equal(rt.views[4].webContents.audioMuted, true);
  assert.equal(rt.views[5].webContents.audioMuted, true);
  assert.equal(rt.ipc.get('app:tab-mute')(event, state.streams[0].tabId), true);
  assert.equal(rt.views[4].webContents.audioMuted, false);
  assert.equal(rt.views[5].webContents.audioMuted, true);
  assert.equal(rt.ipc.get('app:state:get')(event).streams[0].muted, false);
});

test('abrir live durante jogo em tela cheia retorna automaticamente ao painel', async () => {
  const rt = makeRuntime();
  await new Promise(resolve => setTimeout(resolve, 20));
  const event = { sender: { id: rt.window.webContents.id } };
  assert.equal(rt.ipc.get('app:immersive-enter')(event, 1), true);
  rt.views[0].webContents.popupHandler({url:'https://kick.com/canal_live'});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(rt.window.isFullScreen(), false);
  const state = rt.ipc.get('app:state:get')(event);
  assert.equal(state.immersiveAccountId, null);
  assert.equal(state.streams.length, 1);
  assert.equal(state.accounts[0].selectedTab, state.streams[0].tabId);
});
