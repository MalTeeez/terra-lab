import { expect, test } from 'bun:test';
import { wikiImg, wikiImgByName, wikiUrl } from '../src/lib/wiki.js';

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
  expect(wikiUrl({ mod: 'HypnosMod', name: 'Whatever' })).toBeNull();
  expect(wikiImg({ mod: 'HypnosMod', name: 'Whatever' })).toBeNull();
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
