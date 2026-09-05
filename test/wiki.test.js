import { expect, test } from 'bun:test';
import { wikiImg, wikiImgByName, wikiImgGif, wikiUrl } from '../src/lib/wiki.js';

test('wiki links', () => {
  expect(wikiUrl({ mod: 'v', name: 'Zenith' })).toBe('https://terraria.wiki.gg/wiki/Zenith');
  expect(wikiUrl({ mod: 'CalamityMod', name: 'Abyssal Warhammer' })).toBe('https://calamitymod.wiki.gg/wiki/Abyssal_Warhammer');
  // md5('Murasama.png') starts 03… — MediaWiki's static file layout, verified against the live wiki
  expect(wikiImg({ mod: 'CalamityMod', name: 'Murasama', icon: '0/03' })).toBe('https://calamitymod.wiki.gg/images/0/03/Murasama.png');
  expect(wikiImg({ mod: 'v', name: 'Cobalt Sword', icon: 'd/d6' })).toBe('https://terraria.wiki.gg/images/d/d6/Cobalt_Sword.png');
  // no precomputed hash (an older dataset): the special page still answers
  expect(wikiImg({ mod: 'CalamityMod', name: 'Abyssal Warhammer' })).toBe('https://calamitymod.wiki.gg/wiki/Special:Redirect/file/Abyssal_Warhammer.png');
  // mods without their own wiki live on the shared one: subpage article, bracketed file name
  expect(wikiUrl({ mod: 'SOTS', name: 'Elemental Helmet' })).toBe('https://terrariamods.wiki.gg/wiki/Secrets_Of_The_Shadows/Elemental_Helmet');
  expect(wikiImg({ mod: 'SOTS', name: 'Elemental Helmet', icon: 'c/cb' })).toBe('https://terrariamods.wiki.gg/images/c/cb/Elemental_Helmet_(Secrets_Of_The_Shadows).png');
  // mods whose wiki article is named after the mod's title, not its internal name
  expect(wikiUrl({ mod: 'CalamityHunt', name: 'Trailblazed Goggles' })).toBe('https://terrariamods.wiki.gg/wiki/Hunt_of_the_Old_God/Trailblazed_Goggles');
  expect(wikiUrl({ mod: 'CatalystMod', name: 'Catharsis' })).toBe('https://terrariamods.wiki.gg/wiki/Catalyst/Catharsis');
  expect(wikiUrl({ mod: 'NoxusBoss', name: 'Divine Wings' })).toBe('https://terrariamods.wiki.gg/wiki/Wrath_of_the_Gods/Divine_Wings');
  expect(wikiImg({ mod: 'CatalystMod', name: 'Catharsis', icon: '4/45' })).toBe('https://terrariamods.wiki.gg/images/4/45/Catharsis_(Catalyst).png');
  // an apostrophe in the mod title survives: encodeURIComponent leaves it alone, and so does the wiki
  expect(wikiImg({ mod: 'CalValEX', name: 'Exodium Orbiter', icon: 'f/f2' })).toBe("https://terrariamods.wiki.gg/images/f/f2/Exodium_Orbiter_(Calamity's_Vanities).png");
  expect(wikiUrl({ mod: 'InfernumMode', name: 'Arid Battlecry' })).toBe('https://infernummod.wiki.gg/wiki/Arid_Battlecry');
  expect(wikiUrl({ mod: 'HypnosMod', name: 'Whatever' })).toBeNull();
  expect(wikiImg({ mod: 'HypnosMod', name: 'Whatever' })).toBeNull();
});

test('looked-up sprite file wins over the guessed one', () => {
  // the boss article files its sprite under a phase name, so no rule over "Nameless Deity" finds it;
  // tools/wiki-icons.mjs looks it up and the hashed guess is skipped (see data/wiki-icons.json)
  expect(wikiImg({ mod: 'NoxusBoss', name: 'Nameless Deity', icon: '1/11', img: 'Nameless_Deity_of_Light_4_(Wrath_of_the_Gods).gif' }))
    .toBe('https://terrariamods.wiki.gg/images/Nameless_Deity_of_Light_4_(Wrath_of_the_Gods).gif');
  // a comma survives the round trip; wiki.gg serves /images/<file> unhashed
  expect(wikiImg({ mod: 'StarsAbove', name: 'Thespian, the Act of Alchemy', img: 'Thespian,_the_Act_of_Alchemy_Delight.png' }))
    .toBe('https://starsabovemod.wiki.gg/images/Thespian%2C_the_Act_of_Alchemy_Delight.png');
});

test('gif sprite fallback', () => {
  // Infernum files this one as a .gif, so the .png the name rule builds 404s and this is tried next
  expect(wikiImgGif({ mod: 'InfernumMode', name: "Storm Maiden's Retribution" }))
    .toBe("https://infernummod.wiki.gg/images/Storm_Maiden's_Retribution.gif");
  expect(wikiImgGif({ mod: 'SOTS', name: 'Elemental Helmet' }))
    .toBe('https://terrariamods.wiki.gg/images/Elemental_Helmet_(Secrets_Of_The_Shadows).gif');
  expect(wikiImgGif({ mod: 'HypnosMod', name: 'Whatever' })).toBeNull();
});

test('by-name sprite fallback', () => {
  // Soul of Fright is animated, so the wiki stores a .gif and the hashed .png URL 404s; asking by
  // name resolves whatever extension is actually there
  expect(wikiImgByName({ mod: 'v', name: 'Soul of Fright', icon: '8/80' }))
    .toBe('https://terraria.wiki.gg/wiki/Special:Redirect/file/Soul_of_Fright.png');
  // the shared wiki's bracketed file name survives the fallback
  expect(wikiImgByName({ mod: 'SOTS', name: 'Elemental Helmet', icon: 'c/cb' }))
    .toBe('https://terrariamods.wiki.gg/wiki/Special:Redirect/file/Elemental_Helmet_(Secrets_Of_The_Shadows).png');
  expect(wikiImgByName({ mod: 'HypnosMod', name: 'Whatever' })).toBeNull();
});
