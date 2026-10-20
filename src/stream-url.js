'use strict';

// A pagina original dos canais e usada em WebContentsView, nao em iframe.
// Evita requisitos do parametro Twitch `parent` em apps locais (file://).
const CHANNEL = /^[a-zA-Z0-9_-]{1,40}$/;
const TWITCH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'player.twitch.tv']);
const KICK_HOSTS = new Set(['kick.com', 'www.kick.com', 'player.kick.com']);
const NON_CHANNELS = new Set([
  'login', 'signup', 'register', 'settings', 'directory', 'downloads',
  'videos', 'clips', 'search', 'subscriptions', 'inventory', 'drops',
  'wallet', 'payments', 'dashboard', 'messages', 'privacy', 'terms',
  'about', 'help', 'contact', 'logout', 'activate', 'auth', 'oauth'
]);

function parseStreamUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const twitch = TWITCH_HOSTS.has(host);
    const kick = KICK_HOSTS.has(host);
    if (!twitch && !kick) return null;

    // Em vez do embed, abrimos a pagina publica do canal, que funciona
    // em uma aba nativa Electron independentemente de `parent` HTTPS.
    const parts = url.pathname.split('/').filter(Boolean);
    let channel = null;
    if (host === 'player.twitch.tv') channel = url.searchParams.get('channel');
    else if (parts.length === 1) channel = parts[0];
    if (!channel || !CHANNEL.test(channel) || NON_CHANNELS.has(channel.toLowerCase())) return null;
    const provider = twitch ? 'Twitch' : 'Kick';
    return {
      url: `https://${twitch ? 'www.twitch.tv' : 'kick.com'}/${channel}`,
      provider,
      channel
    };
  } catch {
    return null;
  }
}

module.exports = { parseStreamUrl };
