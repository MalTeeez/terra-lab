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
  InfernumMode: { base: 'https://infernummod.wiki.gg/' }, // 16/16 articles, 12/16 sprites

  SOTS: { base: 'https://terrariamods.wiki.gg/', page: 'Secrets_Of_The_Shadows/', file: ' (Secrets Of The Shadows)' },
  // the mod's in-game name is not its wiki's: CalamityHunt is "Hunt of the Old God", NoxusBoss is
  // "Wrath of the Gods". Article hit rate over this pack's items: 20/23, 31/31, 3/5.
  CalamityHunt: { base: 'https://terrariamods.wiki.gg/', page: 'Hunt_of_the_Old_God/', file: ' (Hunt of the Old God)' },
  CatalystMod: { base: 'https://terrariamods.wiki.gg/', page: 'Catalyst/', file: ' (Catalyst)' },
  NoxusBoss: { base: 'https://terrariamods.wiki.gg/', page: 'Wrath_of_the_Gods/', file: ' (Wrath of the Gods)' },
  CalValEX: { base: 'https://terrariamods.wiki.gg/', page: "Calamity's_Vanities/", file: " (Calamity's Vanities)" }, // 61/77, the misses are undocumented vanity
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
 *
 * `img` beats both: the file the wiki actually stores, with its real extension, looked up from the
 * article by `tools/wiki-icons.mjs`. Bosses need it — plenty are filed under a phase or animation
 * name (`Nameless Deity of Light 1 …gif`) that no rule derives from "Nameless Deity".
 */
export function wikiImg(it) {
  const file = wikiFile(it);
  if (!file) return null;
  const { base } = WIKIS[it.mod];
  if (it.img) return `${base}images/${encodeURIComponent(it.img)}`;
  return it.icon ? `${base}images/${it.icon}/${enc(file)}.png` : wikiImgByName(it);
}

/**
 * The same sprite as a `.gif`. An animated sprite (`Storm Maiden's Retribution`, `Soul of Fright`)
 * is filed under that extension, so the `.png` the name rule builds 404s. Tried second — it is a
 * plain file URL, unlike the special page below.
 */
export function wikiImgGif(it) {
  const file = wikiFile(it);
  return file ? `${WIKIS[it.mod].base}images/${enc(file)}.gif` : null;
}

/**
 * The same sprite asked for by name instead of by hash. Slower (a special page), and only some
 * wikis answer it for a `.png` name that is really a `.gif`, so it is the last thing tried.
 */
export function wikiImgByName(it) {
  const file = wikiFile(it);
  return file ? `${WIKIS[it.mod].base}wiki/Special:Redirect/file/${enc(file)}.png` : null;
}

export const wikiHost = (url) => url?.split('/')[2] ?? '';
