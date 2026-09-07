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
  // A sprite archive more than an article one: 253 files, of which 57 of this pack's 85 Ragnarok
  // records, but only a dozen items have an article — so a name link would be red 8 times out of 9.
  // Search instead: MediaWiki jumps straight to an exact title, and the rest land on the Weapons or
  // Armor table row that names the item. The sprites are filed under the mod's *internal* name
  // (`Victide Sponge Hood` → `VictideHeadHealer.png`), which no rule derives, so they all come from
  // data/wiki-icons.json.
  RagnarokMod: { base: 'https://ragnarokmod.wiki.gg/', search: true },

  SOTS: { base: 'https://terrariamods.wiki.gg/', page: 'Secrets_Of_The_Shadows/', file: ' (Secrets Of The Shadows)' },
  // the mod's in-game name is not its wiki's: CalamityHunt is "Hunt of the Old God", NoxusBoss is
  // "Wrath of the Gods". Article hit rate over this pack's items: 20/23, 31/31, 3/5.
  CalamityHunt: { base: 'https://terrariamods.wiki.gg/', page: 'Hunt_of_the_Old_God/', file: ' (Hunt of the Old God)' },
  CatalystMod: { base: 'https://terrariamods.wiki.gg/', page: 'Catalyst/', file: ' (Catalyst)' },
  NoxusBoss: { base: 'https://terrariamods.wiki.gg/', page: 'Wrath_of_the_Gods/', file: ' (Wrath of the Gods)' },
  CalValEX: { base: 'https://terrariamods.wiki.gg/', page: "Calamity's_Vanities/", file: " (Calamity's Vanities)" }, 
  CalamitySimpleWhipAddon: { base: 'https://terrariamods.wiki.gg/', page: "Calamity_Simple_Whip_Addon/", file: " (Calamity Simple Whip Addon)" }, 
  InfernalEclipseWeaponsDLC: { base: 'https://terrariamods.wiki.gg/', page: "Infernal_Eclipse_of_Ragnarok/", file: " (Infernal Eclipse of Ragnarok)" }, 
};

/**
 * Items the mod renamed after the wiki was written: the article and the sprite file still carry the
 * old name, so both the link and the icon 404 on the in-game name the miner reads. Keyed
 * `<mod>:<name>` like data/wiki-icons.json, since the article follows the name, not the id.
 *
 * The Weapons DLC did most of this at once, giving its Healer and Bard weapons equipment codes
 * (`Neon Ripper` → `C-PMA Ripper`); the rest are a respelling the wiki never picked up. Verified
 * against https://terrariamods.wiki.gg/wiki/Infernal_Eclipse_of_Ragnarok/Weapons_(Weapons_DLC):
 * the four `Gamma Knife`-style names below still have no article, but their sprite is filed under
 * the old name, so the icon resolves even where the link is a red one.
 */
export const WIKI_NAMES = {
  'InfernalEclipseWeaponsDLC:Sulphur Spitter': 'Acid Belcher',
  'InfernalEclipseWeaponsDLC:C-TSL Defibrillator': 'Defibrillanator',
  'InfernalEclipseWeaponsDLC:C-PMA Ripper': 'Neon Ripper',
  'InfernalEclipseWeaponsDLC:I-LSR Infrariff': 'Infrariff',
  'InfernalEclipseWeaponsDLC:I-PLS Ocarina': 'Plasma Ocarina',
  'InfernalEclipseWeaponsDLC:Triggerblade': 'TriggerBlade',
  // sprite only — the wiki lists these but has never written the article
  'InfernalEclipseWeaponsDLC:C-GSS Gamma Knife': 'Gamma Knife',
  'InfernalEclipseWeaponsDLC:I-PMA Mechamatone': 'Mechamatome',
  'InfernalEclipseWeaponsDLC:Tetherblade': 'TetherBlade',
  'InfernalEclipseWeaponsDLC:Thunderbolt-Action Sniper Rifle': 'Thunderbolt Action Sniper Rifle',
};

const enc = (s) => encodeURIComponent(s.replace(/ /g, '_'));
/**
 * The name the wiki files a record under, which is not always the name the game shows.
 * `wikiName` is the mined one: the mod's own DisplayName, where a later mod's localization
 * renamed the item out from under it (Ragnarok's "Rogue 101" is Thorium's Guide to Expert
 * Throwing, and only the latter has an article).
 */
const wikiName = (it) => WIKI_NAMES[`${it.mod}:${it.name}`] ?? it.wikiName ?? it.name;

/** Base name (no extension) of an item's sprite file on its wiki, or null when it has no wiki. */
export const wikiFile = (it) => {
  const w = WIKIS[it?.mod];
  return w && it.name ? wikiName(it) + (w.file ?? '') : null;
};

/** Article URL for an item/material, or null when the mod has no known wiki. */
export function wikiUrl(it) {
  const w = WIKIS[it?.mod];
  if (!w || !it.name) return null;
  if (w.search) return `${w.base}wiki/Special:Search?search=${enc(wikiName(it))}`;
  return `${w.base}wiki/${w.page ?? ''}${enc(wikiName(it))}`;
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
