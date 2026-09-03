// Wiki homes per mod, verified by asking each site's api.php whether it actually has
// articles named after this pack's items. wiki.gg only — the fandom candidates had 0 matching
// articles, so a mod that is on neither gets no link rather than a dead one.
//
// Mods without their own wiki live on the shared terrariamods.wiki.gg, where the article is a
// subpage (`Secrets_Of_The_Shadows/Elemental_Helmet`) and the file carries the mod in brackets
// (`Elemental Helmet (Secrets Of The Shadows).png`).
const WIKIS = {
  v: { base: 'https://terraria.wiki.gg/' },
  CalamityMod: { base: 'https://calamitymod.wiki.gg/' },
  ThoriumMod: { base: 'https://thoriummod.wiki.gg/' },
  StarsAbove: { base: 'https://starsabovemod.wiki.gg/' },
  SOTS: { base: 'https://terrariamods.wiki.gg/', page: 'Secrets_Of_The_Shadows/', file: ' (Secrets Of The Shadows)' },
};

const enc = (s) => encodeURIComponent(s.replace(/ /g, '_'));

/** Base name (no extension) of an item's sprite file on its wiki, or null when it has no wiki. */
export const wikiFile = (it) => {
  const w = WIKIS[it?.mod];
  return w && it.name ? it.name + (w.file ?? '') : null;
};

/** Article URL for an item/material, or null when the mod has no known wiki. */
export function wikiUrl(it) {
  const w = WIKIS[it?.mod];
  return w && it.name ? `${w.base}wiki/${w.page ?? ''}${enc(it.name)}` : null;
}

/**
 * Sprite URL. MediaWiki's static layout is /images/<h0>/<h0h1>/<File_name>.png where h is the md5
 * of the file name; the miner precomputes that prefix as `icon` (over `wikiFile`, so the shared
 * wiki's bracketed names hash right). Going through `Special:Redirect/file/` also works but it is
 * a special page, and wiki.gg answers a page full of those with 429s. A wrong guess 404s and the
 * <img> hides itself.
 */
export function wikiImg(it) {
  const file = wikiFile(it);
  if (!file) return null;
  return it.icon ? `${WIKIS[it.mod].base}images/${it.icon}/${enc(file)}.png` : wikiImgByName(it);
}

/**
 * The same sprite asked for by name instead of by hash. Slower (a special page), but it resolves
 * to whatever the wiki actually stores — animated sprites are `.gif`, and the precomputed hash is
 * of a `.png` that does not exist. Used only after the direct URL 404s.
 */
export function wikiImgByName(it) {
  const file = wikiFile(it);
  return file ? `${WIKIS[it.mod].base}wiki/Special:Redirect/file/${enc(file)}.png` : null;
}

export const wikiHost = (url) => url?.split('/')[2] ?? '';
