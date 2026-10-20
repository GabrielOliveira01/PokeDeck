'use strict';

// Only remove Google identity-provider data from ONE PokeDeck profile.
// Never clear pokeidle.io, Twitch, Kick, or other partitions.
function isGoogleAuthCookie(cookie) {
  if (!cookie || typeof cookie.domain !== 'string') return false;
  const domain = cookie.domain.replace(/^\./, '').toLowerCase();
  return domain === 'google.com' || domain.endsWith('.google.com');
}

async function clearGoogleAuth(browserSession) {
  // Do not call session.clearStorageData() without an origin: that signs out the game.
  const cookies = await browserSession.cookies.get({});
  const googleCookies = cookies.filter(isGoogleAuthCookie);
  let removed = 0;
  for (const cookie of googleCookies) {
    const domain = cookie.domain.replace(/^\./, '');
    const cookiePath = cookie.path?.startsWith('/') ? cookie.path : '/';
    const url = `https://${domain}${cookiePath}`;
    await browserSession.cookies.remove(url, cookie.name);
    removed += 1;
  }
  // Clear only identity-provider origin storage; this does not delete the PokeIdle login.
  await browserSession.clearStorageData({
    origin: 'https://accounts.google.com',
    storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers']
  });
  await browserSession.cookies.flushStore();
  return removed;
}

module.exports = { isGoogleAuthCookie, clearGoogleAuth };
