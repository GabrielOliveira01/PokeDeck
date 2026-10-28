'use strict';

const api = window.pokeDeck;
const cards = document.getElementById('cards');
const economyButton = document.getElementById('economy-toggle');
const backgroundButton = document.getElementById('live-background-toggle');
const allPanelsButton = document.getElementById('all-panels-toggle');
let currentMode = 'grid';
let modeBeforeImmersive = null;
let lastBounds = '';
let latestState = { economy: true, keepLiveBackground: true, streams: [], accounts: [], immersiveAccountId: null, allParked: false };
let requested = false;
let lastStreamIds = new Set();

function boundsChanged() {
  const entries = [];
  for (let id = 1; id <= 4; id++) {
    const viewport = document.getElementById(`viewport-${id}`);
    const state = latestState.accounts.find(account => account.id === id);
    if (!viewport || state?.parked || !viewport.getClientRects().length) {
      entries.push({ id, rect: null }); continue;
    }
    const { x, y, width, height } = viewport.getBoundingClientRect();
    entries.push({ id, rect: { x, y, width, height } });
  }
  const json = JSON.stringify(entries);
  if (json !== lastBounds) { lastBounds = json; api.updateLayout(entries); }
}
function requestLayout() {
  if (requested) return;
  requested = true;
  window.requestAnimationFrame(() => { requested = false; boundsChanged(); });
}
function changeMode(mode) {
  if (mode !== 'grid' && !['1', '2', '3', '4'].includes(String(mode))) return;
  if (latestState.immersiveAccountId !== null && mode !== String(latestState.immersiveAccountId)) return;
  currentMode = String(mode);
  cards.classList.toggle('grid-mode', currentMode === 'grid');
  cards.classList.toggle('focus-mode', currentMode !== 'grid');
  document.querySelectorAll('.account-card').forEach(card => {
    card.classList.toggle('focus-hide', currentMode !== 'grid' && card.dataset.account !== currentMode);
  });
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === currentMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-focus]').forEach(button => {
    const focused = button.dataset.focus === currentMode;
    button.textContent = focused ? '▦' : '▣';
    button.title = focused ? 'Mostrar as quatro contas' : 'Destacar esta conta';
  });
  if (latestState.accounts.length) updateParkLabels();
  lastBounds = ''; requestLayout();
}
function updateParkLabels() {
  const grid = currentMode === 'grid';
  for (const account of latestState.accounts) {
    const button = document.querySelector(`[data-park="${account.id}"]`);
    if (!button) continue;
    button.title = grid ? (latestState.allParked ? 'Mostrar as 4 contas' : 'Ocultar as 4 contas') :
      (account.parked ? 'Mostrar esta conta' : 'Ocultar esta conta');
    button.setAttribute('aria-label', button.title);
  }
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function buildTabs(account, streams) {
  const nav = document.querySelector(`[data-tabs="${account.id}"]`);
  if (!nav) return;
  const game = el('button', `panel-tab game-tab${account.selectedTab === 'game' ? ' current' : ''}`);
  game.type = 'button'; game.setAttribute('aria-selected', String(account.selectedTab === 'game'));
  game.append(el('span', 'tab-symbol', '◆'), document.createTextNode(' JOGO'));
  game.addEventListener('click', () => api.selectTab(account.id, 'game'));
  const fragment = document.createDocumentFragment(); fragment.append(game);
  for (const stream of streams) {
    const wrapper = el('div', `stream-pill${account.selectedTab === stream.tabId ? ' active' : ''}`);
    const select = el('button', `panel-tab stream-tab${account.selectedTab === stream.tabId ? ' current' : ''}`);
    select.type = 'button'; select.title = `${stream.provider} · ${stream.channel} — ${stream.status}`;
    select.setAttribute('aria-selected', String(account.selectedTab === stream.tabId));
    const status = account.selectedTab === stream.tabId ? 'NA TELA' : 'EM 2º PLANO';
    const name = el('span', 'stream-tab-name', `${stream.provider.toUpperCase()} · ${stream.channel}`);
    select.append(el('span', 'tab-live-dot'), name, el('span', 'stream-tab-status', status));
    select.addEventListener('click', () => api.selectTab(account.id, stream.tabId));
    const mute = el('button', `stream-tab-action stream-mute${stream.muted ? ' muted' : ''}`, stream.muted ? '♪̸' : '♫');
    mute.type = 'button'; mute.title = stream.muted ? 'Ativar áudio desta live' : 'Silenciar esta live';
    mute.setAttribute('aria-label', mute.title);
    mute.addEventListener('click', () => api.muteStreamTab(stream.tabId));
    const close = el('button', 'stream-tab-action stream-close', '×');
    close.type = 'button'; close.title = `Fechar live ${stream.channel}`;
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', () => api.closeStreamTab(stream.tabId));
    wrapper.append(select, mute, close);
    fragment.append(wrapper);
  }
  nav.replaceChildren(fragment);
}
function drawState(state) {
  if (!state) return;
  const enteringImmersive = state.immersiveAccountId !== null;
  if (enteringImmersive && modeBeforeImmersive === null) modeBeforeImmersive = currentMode;
  latestState = state;
  document.body.classList.toggle('immersive-mode', enteringImmersive);
  if (enteringImmersive) changeMode(state.immersiveAccountId);
  else if (modeBeforeImmersive !== null) {
    const previousMode = modeBeforeImmersive;
    modeBeforeImmersive = null;
    changeMode(previousMode);
  }
  allPanelsButton.classList.toggle('is-parked', state.allParked);
  allPanelsButton.setAttribute('aria-pressed', String(state.allParked));
  allPanelsButton.querySelector('.all-panels-label').textContent = state.allParked ? 'MOSTRAR 4' : 'OCULTAR 4';
  allPanelsButton.querySelector('.all-panels-icon').textContent = state.allParked ? '▶' : '☾';
  economyButton.classList.toggle('enabled', state.economy);
  economyButton.classList.toggle('disabled', !state.economy);
  economyButton.setAttribute('aria-pressed', String(state.economy));
  economyButton.querySelector('.economy-value').textContent = state.economy ? 'ECO LIGADO' : 'COMPATÍVEL';
  backgroundButton.classList.toggle('enabled', state.keepLiveBackground);
  backgroundButton.classList.toggle('disabled', !state.keepLiveBackground);
  backgroundButton.setAttribute('aria-pressed', String(state.keepLiveBackground));
  backgroundButton.querySelector('.live-value').textContent = state.keepLiveBackground ? 'LIVES CONTÍNUAS' : 'ECONOMIZAR LIVES';
  document.getElementById('economy-detail').textContent = state.keepLiveBackground
    ? 'Lives permanecem carregadas nas outras abas · mais CPU/RAM conforme a quantidade'
    : 'Lives preservadas em abas, mas reprodução em segundo plano pode ser limitada';
  document.getElementById('open-live-count').textContent = `${state.streams.length} ${state.streams.length === 1 ? 'LIVE ABERTA' : 'LIVES ABERTAS'}`;
  document.getElementById('live-hint').classList.toggle('live-playing', state.streams.length > 0);
  const notice = document.getElementById('app-notice');
  notice.textContent = state.notice || '';
  notice.hidden = !state.notice;

  for (const account of state.accounts) {
    const id = account.id;
    const statusEl = document.querySelector(`[data-status="${id}"]`);
    const muteEl = document.querySelector(`[data-mute="${id}"]`);
    const parkEl = document.querySelector(`[data-park="${id}"]`);
    const card = document.querySelector(`[data-account="${id}"]`);
    if (!statusEl || !muteEl || !parkEl || !card) continue;
    const dot = el('span', 'status-dot');
    dot.classList.toggle('ok', account.status === 'Site aberto');
    dot.classList.toggle('error', account.status.startsWith('Falha'));
    statusEl.replaceChildren(dot, document.createTextNode(account.parked ? 'Painel em repouso' : account.status));
    muteEl.textContent = account.muted ? '♪̸' : '♫';
    muteEl.classList.toggle('muted', account.muted);
    muteEl.setAttribute('aria-label', account.muted ? 'Ativar áudio do jogo' : 'Silenciar jogo');
    parkEl.textContent = account.parked ? '▶' : '☾';
    parkEl.title = account.parked ? 'Reativar painel' : 'Ocultar painel';
    parkEl.setAttribute('aria-pressed', String(account.parked));
    parkEl.classList.toggle('sleeping', account.parked);
    card.classList.toggle('parked', account.parked);
    const ownStreams = state.streams.filter(stream => stream.id === id);
    card.classList.toggle('live-card', account.selectedTab !== 'game');
    buildTabs(account, ownStreams);
  }
  updateParkLabels();
  // A newly clicked live receives a NEW tab; focus its originating account.
  const ids = new Set(state.streams.map(stream => stream.tabId));
  const newest = state.streams.find(stream => !lastStreamIds.has(stream.tabId));
  if (newest && !enteringImmersive) changeMode(newest.id);
  lastStreamIds = ids;
  lastBounds = ''; requestLayout();
}

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => changeMode(button.dataset.mode));
}
for (const button of document.querySelectorAll('[data-focus]')) {
  button.addEventListener('click', () => changeMode(currentMode === button.dataset.focus ? 'grid' : button.dataset.focus));
}
for (const button of document.querySelectorAll('[data-fullscreen]')) {
  button.addEventListener('click', () => api.enterImmersive(Number(button.dataset.fullscreen)));
}
allPanelsButton.addEventListener('click', () => api.toggleParkAll());
window.addEventListener('keydown', event => {
  if (latestState.immersiveAccountId !== null && (event.key === 'Escape' || event.key === 'F11')) {
    event.preventDefault(); api.exitImmersive();
  }
});
for (const button of document.querySelectorAll('[data-google-reset]')) {
  button.addEventListener('click', async () => {
    const id = Number(button.dataset.googleReset);
    if (!window.confirm(`Redefinir apenas o login Google da conta ${id}? As outras contas e os logins do jogo serão preservados.`)) return;
    button.disabled = true;
    try { await api.resetGoogleLogin(id); }
    finally { button.disabled = false; }
  });
}
for (const button of document.querySelectorAll('[data-reload]')) {
  button.addEventListener('click', () => api.reloadAccount(Number(button.dataset.reload)));
}
for (const button of document.querySelectorAll('[data-mute]')) {
  button.addEventListener('click', () => api.toggleMute(Number(button.dataset.mute)));
}
for (const button of document.querySelectorAll('[data-park]')) {
  button.addEventListener('click', () => currentMode === 'grid' ? api.toggleParkAll() : api.togglePark(Number(button.dataset.park)));
}
economyButton.addEventListener('click', () => api.setEconomy(!latestState.economy));
backgroundButton.addEventListener('click', () => api.setKeepLiveBackground(!latestState.keepLiveBackground));
window.addEventListener('resize', requestLayout);
new ResizeObserver(requestLayout).observe(cards);
for (const element of document.querySelectorAll('.viewport')) new ResizeObserver(requestLayout).observe(element);
api.onState(drawState);
api.onMetrics(metrics => {
  document.getElementById('ram-value').textContent = metrics.mb ? `~${metrics.mb} MB` : '—';
  document.getElementById('cpu-value').textContent = Number.isFinite(metrics.cpu) ? `~${metrics.cpu.toFixed(1)}%` : '—';
});
api.getState().then(drawState).catch(() => {
  document.getElementById('economy-detail').textContent = 'Falha ao ler o estado do aplicativo.';
});
requestLayout();
