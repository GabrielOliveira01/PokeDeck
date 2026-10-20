'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const src = join(root, 'src');
const main = readFileSync(join(src, 'main.js'), 'utf8');
const renderer = readFileSync(join(src, 'renderer.js'), 'utf8');
const preload = readFileSync(join(src, 'preload.js'), 'utf8');
const html = readFileSync(join(src, 'index.html'), 'utf8');
const css = readFileSync(join(src, 'styles.css'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { parseStreamUrl } = require(join(src, 'stream-url.js'));

test('quatro perfis mantêm partições, appId e preferências anteriores', () => {
  assert.match(main, /MAX_ACCOUNTS = 4/);
  assert.match(main, /`persist:pokeidle-account-\$\{id\}`/);
  assert.match(main, /preferences\.muted/);
  assert.equal(pkg.build.appId, 'br.independente.pokedeck4');
});
test('conteúdo remoto sem Node, com isolamento e sandbox', () => {
  for (const expression of [/nodeIntegration: false/, /contextIsolation: true/, /sandbox: true/, /webSecurity: true/]) assert.match(main, expression);
  assert.doesNotMatch(main, /executeJavaScript\(/);
});
test('cada clique gera ID de live único, sem fechar outra aba', () => {
  assert.match(main, /const liveTabs = new Map\(\)/);
  assert.match(main, /tabId: `live-\$\{nextLiveTabId\+\+\}`/);
  assert.match(main, /liveTabs\.set\(tab\.tabId, tab\)/);
  assert.doesNotMatch(main, /if \(streamTab\) closeStreamTab\(/);
  assert.match(main, /MAX_LIVE_TABS = 12/);
});
test('trocar aba mantém a WebContentsView e fecha somente aba selecionada explicitamente', () => {
  const selectionBody = main.slice(main.indexOf('function selectTab('), main.indexOf('function closeStreamTab('));
  assert.match(selectionBody, /acc\.selectedTab = tabId/);
  assert.doesNotMatch(selectionBody, /destroyView|\.reload\(|\.pause\(/);
  assert.match(main, /function closeStreamTab\(tabId\)/);
  assert.match(main, /liveTabs\.delete\(tabId\)/);
  assert.match(main, /destroyView\(tab\.view\)/);
});
test('reprodução de fundo priorizada com controle independente de economia', () => {
  assert.match(main, /keepLiveBackground: true/);
  assert.match(main, /preferences\.keepLiveBackground \? false : preferences\.economy/);
  assert.match(main, /setBackgroundThrottling\(liveBackgroundThrottling\(\)\)/);
  assert.match(renderer, /setKeepLiveBackground\(/);
  assert.match(preload, /setKeepLiveBackground/);
  assert.ok(html.includes('id="live-background-toggle"'));
});
test('quatro painéis exibem abas de live geradas dinamicamente', () => {
  for (let id = 1; id <= 4; id++) {
    for (const fragment of [`id="viewport-${id}"`, `data-account="${id}"`, `data-tabs="${id}"`]) assert.ok(html.includes(fragment), fragment);
  }
  assert.match(renderer, /for \(const stream of streams\)/);
  assert.match(renderer, /api\.selectTab\(account\.id, stream\.tabId\)/);
  assert.match(renderer, /api\.closeStreamTab\(stream\.tabId\)/);
  assert.match(renderer, /api\.muteStreamTab\(stream\.tabId\)/);
  assert.match(css, /\.stream-pill\.active/);
});
test('Twitch e Kick páginas originais/embeds aceitos', () => {
  assert.deepEqual(parseStreamUrl('https://www.twitch.tv/poke_idle?ref=abc'), {
    url: 'https://www.twitch.tv/poke_idle', provider: 'Twitch', channel: 'poke_idle'
  });
  assert.deepEqual(parseStreamUrl('https://kick.com/meu-canal'), {
    url: 'https://kick.com/meu-canal', provider: 'Kick', channel: 'meu-canal'
  });
  assert.deepEqual(parseStreamUrl('https://player.twitch.tv/?channel=canal123&parent=pokeidle.io'), {
    url: 'https://www.twitch.tv/canal123', provider: 'Twitch', channel: 'canal123'
  });
  assert.deepEqual(parseStreamUrl('https://player.kick.com/mychannel?autoplay=true'), {
    url: 'https://kick.com/mychannel', provider: 'Kick', channel: 'mychannel'
  });
});
test('URL hostil ou autenticação são ignoradas como live', () => {
  for (const bad of [
    'https://twitch.tv.evil.com/abc', 'http://kick.com/abc', 'file:///tmp/test',
    'javascript:alert(1)', 'https://www.kick.com@evil.net/abc', 'https://kick.com/a/b',
    'https://kick.com/', 'https://example.org/abc', 'https://www.twitch.tv/login',
    'https://id.twitch.tv/oauth2/authorize', 'https://kick.com/settings',
    'https://player.twitch.tv/?parent=pokeidle.io', 'https://kick.com:8080/foo',
    'https://twitch.tv/%2f'
  ]) assert.equal(parseStreamUrl(bad), null, bad);
});
test('lives originadas no jogo abrem abas internas, sem janela própria de stream', () => {
  assert.match(main, /function captureStreamNavigation\(ownerId, rawUrl\)/);
  assert.match(main, /setWindowOpenHandler\(makeSafePopupHandler/);
  assert.match(main, /webContents\.on\('will-navigate'/);
  assert.match(main, /session: acc\.browserSession/);
  assert.match(main, /mainWindow\.contentView\.addChildView\(view\)/);
  assert.doesNotMatch(main, /openExternal\(/);
  assert.doesNotMatch(main, /new BrowserWindow\(\{\s*title: `Live/);
});
test('cálculo de CPU/RAM só em janela visível', () => {
  assert.match(main, /getAppMetrics\(\)/);
  assert.match(main, /setInterval\(sendMetrics, 10000\)/);
  assert.match(main, /mainWindow\.isMinimized\(\)/);
});
test('instalador NSIS para Windows inclui Electron, atalhos e ícone', () => {
  assert.equal(pkg.version, '2.4.0');
  assert.equal(pkg.build.win.icon, 'assets/pokedeck4.ico');
  assert.deepEqual(pkg.build.win.target, ['nsis']);
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.ok(pkg.scripts['dist:win'].includes('electron-builder'));
  assert.ok(existsSync(join(root, 'assets', 'pokedeck4.ico')));
  assert.ok(existsSync(join(root, '.github', 'workflows', 'windows-installer.yml')));
  assert.match(main, /app\.setAppUserModelId\(APP_ID\)/);
});

test('trocar Google por painel preserva partição persistente e integra a interface', () => {
  for (let id = 1; id <= 4; id++) {
    assert.match(html, new RegExp(`data-google-reset="${id}"`));
  }
  assert.match(main, /ipcMain\.handle\('account:google-reset'/);
  assert.match(main, /authWindowOwners\.get\(popup\) === id/);
  assert.match(main, /await clearGoogleAuth\(acc\.browserSession\)/);
  assert.match(preload, /resetGoogleLogin/);
  assert.match(renderer, /api\.resetGoogleLogin\(id\)/);
});
