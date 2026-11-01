// Finds a link in a message and says which site it is for. The host is checked exactly ("evil-tiktok.com" or
// "tiktok.com.evil.io" are NOT TikTok), so a command only accepts links of the site it is made for.
const SITES = {
  tiktok: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
  instagram: ['instagram.com', 'instagr.am'],
  youtube: ['youtube.com', 'youtu.be', 'music.youtube.com'],
};

function firstLink(text) {
  const m = /https?:\/\/[^\s<>"']+/i.exec(String(text || ''));
  return m ? m[0].replace(/[).,!?]+$/, '') : '';
}

function hostOf(link) {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, '');
  } catch (err) {
    return '';
  }
}

// 'tiktok' | 'instagram' | 'youtube' | null
function kindOf(link) {
  const host = hostOf(link);
  if (!host) return null;
  for (const [kind, hosts] of Object.entries(SITES)) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return kind;
  }
  return null;
}

// Instagram: what kind of link it is (post, reel, story...) for the help text
function instagramKind(link) {
  const p = (() => {
    try {
      return new URL(link).pathname;
    } catch (err) {
      return '';
    }
  })();
  if (/^\/stories\//.test(p)) return 'story';
  if (/^\/reels?\//.test(p)) return 'reel';
  if (/^\/(p|tv)\//.test(p)) return 'post';
  return 'other';
}

module.exports = { firstLink, hostOf, kindOf, instagramKind };
