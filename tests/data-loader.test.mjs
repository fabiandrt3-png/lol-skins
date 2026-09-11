import assert from "node:assert/strict";
import test from "node:test";

let moduleId = 0;
const skin = (name, extra = {}) => ({ champ: "Aatrox", skin: name, image: `https://images.example/${encodeURIComponent(name)}.jpg`, ...extra });
const lor = (id, level, extra = {}) => skin(`Original Aatrox — Level ${level}`, {
  id, type: "Legends of Runeterra", sourceKind: "lor", lorSkinName: "Original",
  lorLevelNumber: level, releaseDate: "2023-01-01", ...extra,
});

async function setup(t, { catalog = [skin("Classic Aatrox")], entries = {}, lorSkins = [], manual = "", failCatalog = false } = {}) {
  const requests = [];
  const payload = { catalog, entries };
  const original = JSON.stringify(payload);
  let failures = Number(failCatalog);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith("data/image-overrides.json")) {
      if (failures-- > 0) return { ok: false, status: 503 };
      return { ok: true, json: async () => payload };
    }
    if (url.startsWith("data/lor-skins.json")) return { ok: true, json: async () => ({ entries: lorSkins }) };
    if (url.startsWith("data/manual-skins.txt")) return { ok: true, text: async () => manual };
    throw new Error(`Unexpected request: ${url}`);
  });
  const loader = await import(`../data-loader.js?v=test-${++moduleId}`);
  return { ...loader, requests, assertUnchanged: () => assert.equal(JSON.stringify(payload), original) };
}

test("merges LoR levels in order, without changing original catalog objects", async (t) => {
  const loader = await setup(t, {
    catalog: [skin("Classic Aatrox"), skin("Mecha Aatrox")],
    lorSkins: [lor("original-2", 2), lor("original-1", 1)],
  });
  const result = await loader.loadSkinData();
  assert.deepEqual(result.map((item) => item._id), ["aatrox::classic-aatrox::pc", "original-1", "original-2", "aatrox::mecha-aatrox::pc"]);
  loader.assertUnchanged();
});

test("updates the first duplicate ID and keeps non-LoR entries authoritative", async (t) => {
  const loader = await setup(t, {
    catalog: [lor("duplicate", 1), lor("duplicate", 2), skin("Mecha Aatrox", { id: "protected" })],
    lorSkins: [lor("duplicate", 1, { image: "https://images.example/updated.jpg" }), lor("protected", 2)],
  });
  const result = await loader.loadSkinData();
  assert.equal(result.length, 3);
  assert.equal(result[0]._legacyImage, "https://images.example/updated.jpg");
  assert.equal(result[1].skin, "Original Aatrox — Level 2");
  assert.equal(result[2].skin, "Mecha Aatrox");
  loader.assertUnchanged();
});

test("new duplicate LoR IDs update the inserted entry rather than adding it twice", async (t) => {
  const loader = await setup(t, { lorSkins: [lor("new", 1), lor("new", 2)] });
  const result = await loader.loadSkinData();
  assert.equal(result.length, 2);
  assert.equal(result[1].skin, "Original Aatrox — Level 2");
});

test("manual overrides and parent anchors retain their images and ordering", async (t) => {
  const loader = await setup(t, {
    catalog: [skin("Classic Aatrox"), skin("Mecha Aatrox")],
    manual: [
      "# comment",
      "Aatrox | Mecha Aatrox | PC | https://images.example/manual.jpg | https://images.example/manual-hd.jpg",
      "Aatrox | Mecha Aatrox Chroma | PC | https://images.example/chroma.jpg | | Mecha Aatrox",
      "Aatrox | Mecha Aatrox Chroma | PC | https://images.example/chroma-update.jpg",
    ].join("\n"),
  });
  const result = await loader.loadSkinData();
  assert.deepEqual(result.map((item) => item.skin), ["Classic Aatrox", "Mecha Aatrox", "Mecha Aatrox Chroma"]);
  assert.equal(result[1].image, "https://images.example/manual.jpg");
  assert.equal(result[1].highResImageCandidates[0], "https://images.example/manual-hd.jpg");
  assert.equal(result[2].image, "https://images.example/chroma-update.jpg");
  assert.equal(loader.requests.find(({ url }) => url.startsWith("data/manual")).options.cache, "no-store");
  loader.assertUnchanged();
});

test("simultaneous consumers share one catalog request", async (t) => {
  const loader = await setup(t);
  const first = loader.loadSkinData();
  const second = loader.loadSkinData();
  assert.equal(first, second);
  assert.equal(await first, await second);
  assert.equal(loader.requests.length, 3);
  assert.match(loader.requests[0].url, /\?v=test-/);
});

test("a failed catalog request can be retried without reloading the module", async (t) => {
  const loader = await setup(t, { failCatalog: true });
  await assert.rejects(loader.loadSkinData(), /Central catalog \(503\)/);
  const result = await loader.loadSkinData();
  assert.equal(result.length, 1);
  assert.equal(loader.requests.filter(({ url }) => url.startsWith("data/image-overrides")).length, 2);
});
