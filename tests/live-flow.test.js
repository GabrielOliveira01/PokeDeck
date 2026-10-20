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
    setAudioMuted() {}
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
    }
    loadFile() { Promise.resolve().then(() => this.webContents.emit('did-finish-load')); }
    getContentSize() { return [1540, 920]; }
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
  const context = {
    require: name => name === 'electron'
      ? { app, BrowserWindow: FakeWindow, WebContentsView: FakeView,
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
  return { ipc, views, sessions };
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
