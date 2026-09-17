import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { artworkKey, platformOf, skinTheme } from '../catalog-order.js';

test('the complete catalog keeps every source ID, LoR illustration and chronological PC anchor', async (t) => {
  const read = async (name) => JSON.parse(await fs.readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
  const catalog = await read('image-overrides.json');
  const lor = await read('lor-skins.json');
  const metadata = await read('skin-order.json');
  const visualAudit = await read('skin-visual-duplicates.json');
  assert.equal(visualAudit.pendingReviews, 0, 'visual audit must be complete before publication');
  const manual = await fs.readFile(new URL('../data/manual-skins.txt', import.meta.url), 'utf8');
  t.mock.method(globalThis, 'fetch', async (input) => {
    const name = input.split('?')[0].split('/').pop();
    const body = { 'image-overrides.json': catalog, 'lor-skins.json': lor, 'skin-order.json': metadata }[name];
    assert(body || name === 'manual-skins.txt', `unexpected request ${input}`);
    return { ok: true, json: async () => body, text: async () => manual };
  });
  const { loadSkinData } = await import('../data-loader.js?v=integration');
  const skins = await loadSkinData();
  const byId = new Map(skins.map((skin) => [skin._id, skin]));
  assert.equal(byId.size, skins.length);
  const retained = new Set(skins.flatMap((skin) => [skin._id, ...skin._duplicateIds]));
  for (const item of [...catalog.catalog, ...lor.entries]) assert(retained.has(item.id), `lost source ID ${item.id}`);
  for (const item of lor.entries) assert(byId.has(item.id), `lost distinct LoR art ${item.id}`);
  for (const proof of metadata.artworkEquivalences || []) {
    const pc = byId.get(proof.pcId);
    assert(pc, `lost PC base ${proof.pcId}`);
    assert(!byId.has(proof.wrId), `visual duplicate still visible ${proof.wrId}`);
    assert(pc._duplicateIds.includes(proof.wrId), `lost WR favorite alias ${proof.wrId}`);
    assert(pc.platforms.includes('PC') && pc.platforms.includes('Wild Rift'));
    assert.equal(artworkKey(pc.image), proof.pcArtwork);
  }
  for (const pair of visualAudit.retained) {
    assert(byId.has(pair.pcId), `lost distinct PC illustration ${pair.pcId}`);
    assert(byId.has(pair.wrId), `lost distinct WR illustration ${pair.wrId}`);
  }
  for (const [id, correction] of Object.entries(metadata.artworkOverrides)) {
    if (!byId.has(id) && metadata.artworkEquivalences?.some(proof => proof.wrId === id)) continue;
    assert.equal(artworkKey(byId.get(id).image), artworkKey(correction.image), `wrong art for ${id}`);
  }
  const positions = new Map(skins.map((skin, index) => [skin._id, index]));
  const dates = new Map();
  for (const skin of skins) {
    if (skin._chronologyParentId) {
      const parent = byId.get(skin._chronologyParentId);
      assert(parent, `missing parent for ${skin._id}`);
      assert.equal(parent.champ, skin.champ);
      assert(positions.get(parent._id) < positions.get(skin._id));
    } else if (platformOf(skin) === 'PC' && skinTheme(skin) !== 'original') {
      const date = skin.releaseDate || '9999-12-31';
      assert(date >= (dates.get(skin.champ) || ''), `PC chronology reversed at ${skin._id}`);
      dates.set(skin.champ, date);
    }
  }
  // Descendants stay contiguous even when a WR parent has its own chromas.
  const chain = (skin) => {
    const ancestors = [];
    while (skin._chronologyParentId) {
      assert(!ancestors.includes(skin._chronologyParentId), 'parent cycle');
      ancestors.push(skin._chronologyParentId);
      skin = byId.get(skin._chronologyParentId);
    }
    return ancestors;
  };
  const ended = new Set();
  let active = [];
  for (const skin of skins) {
    const ancestors = chain(skin);
    for (const ancestor of ancestors) assert(!ended.has(ancestor), `split family ${ancestor}`);
    const next = [skin._id, ...ancestors];
    for (const id of active) if (!next.includes(id)) ended.add(id);
    active = next;
  }
});
