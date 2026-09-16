import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateSkins, metadataKey, organizeSkins } from "../catalog-order.js";

const skin = (id, name, releaseDate, extra = {}) => ({
  _id: id, champ: "Ahri", skin: name, releaseDate,
  image: `https://images.example/${id}.jpg`, ...extra,
});
const wr = (id, name, releaseDate, extra = {}) => skin(id, name, releaseDate, { type: "Wild Rift", ...extra });
const ids = (skins) => skins.map((item) => item._id);

test("sorts the PC spine by release date, with original first and unknown dates last", () => {
  const input = [
    skin("unknown", "Unreleased Ahri", null),
    skin("latest", "Coven Ahri", "2021-08-12"),
    skin("classic", "Classic Ahri", null),
    skin("early", "Dynasty Ahri", "2011-12-14"),
    skin("middle", "Popstar Ahri", "2013-11-19"),
  ];
  const before = structuredClone(input);
  assert.deepEqual(ids(organizeSkins(input)), ["classic", "early", "middle", "latest", "unknown"]);
  assert.deepEqual(input, before, "sorting must not mutate the source catalog");
});

test("anchors cross-game skins by exact counterpart, then skin line, then universe", () => {
  const input = [
    skin("coven", "Coven Ahri", "2019-01-01", { skinLines: ["Coven"], universes: ["Eclipse"] }),
    wr("unrelated", "Arcade Ahri", "2017-01-01", { skinLines: ["Arcade"], universes: ["Arcade"] }),
    wr("line", "Dark Coven Ahri", "2024-01-01", { skinLines: ["Coven"], universes: ["Eclipse"] }),
    wr("exact", "Solar Eclipse Ahri", "2025-01-01", { skinLines: ["Coven"], universes: ["Eclipse"] }),
    skin("elderwood", "Elderwood Ahri", "2015-01-01", { skinLines: ["Elderwood"], universes: ["Eclipse"] }),
    wr("universe", "Omen of the Dark Ahri", "2023-01-01", { skinLines: ["Omen of the Dark"], universes: ["Eclipse"] }),
    skin("solar", "Solar Eclipse Ahri", "2020-01-01", { skinLines: ["Eclipse"], universes: ["Eclipse"] }),
  ];
  const result = organizeSkins(input);
  assert.deepEqual(ids(result), ["elderwood", "universe", "unrelated", "coven", "line", "solar", "exact"]);
  assert.deepEqual(Object.fromEntries(result.map((item) => [item._id, item._chronologyParentId])), {
    elderwood: null, universe: "elderwood", unrelated: null,
    coven: null, line: "coven", solar: null, exact: "solar",
  });
});

test("a skin line uses the earliest standard PC skin instead of a prestige edition", () => {
  const result = organizeSkins([
    skin("prestige", "Prestige K/DA Ahri", "2018-01-01", { skinLines: ["K/DA"] }),
    wr("child", "K/DA ALL OUT Ahri", "2020-01-01", { skinLines: ["K/DA"] }),
    skin("standard", "K/DA Ahri", "2019-01-01", { skinLines: ["K/DA"] }),
  ]);
  assert.deepEqual(ids(result), ["prestige", "standard", "child"]);
  assert.equal(result[2]._chronologyParentId, "standard");
});

test("chromas follow their longest matching parent within the same game", () => {
  const result = organizeSkins([
    wr("chroma", "Spirit Blossom Ahri Chroma Pearl", null),
    skin("pc", "Spirit Blossom Ahri", "2020-07-22"),
    wr("wr", "Spirit Blossom Ahri", "2022-12-15"),
    wr("short", "Spirit Ahri", "2021-01-01"),
    skin("other", "Arcade Ahri", "2021-06-01"),
  ]);
  assert.deepEqual(ids(result), ["pc", "wr", "chroma", "short", "other"]);
  assert.equal(result[2]._chronologyParentId, "wr");
  assert.equal(result[2].releaseDate, null, "an unknown chroma date must not become a claimed release date");
});

test("manual illustrations remain immediately after their named parent", () => {
  const result = organizeSkins([
    skin("extra", "Custom Ahri Illustration", "2010-01-01", { _orderAfterSkin: "Coven Ahri" }),
    skin("after", "Arcana Ahri", "2022-01-01"),
    skin("parent", "Coven Ahri", "2021-01-01"),
    skin("before", "Dynasty Ahri", "2011-01-01"),
  ]);
  assert.deepEqual(ids(result), ["before", "parent", "extra", "after"]);
  assert.equal(result[2]._chronologyParentId, "parent");
});

test("a manual cross-game anchor cannot form a cycle that drops both illustrations", () => {
  const result = organizeSkins([
    skin("pc", "Coven Ahri", "2021-01-01", { _orderAfterSkin: "Elderwood Ahri", universes: ["Eclipse"] }),
    wr("wr", "Elderwood Ahri", "2022-01-01", { universes: ["Eclipse"] }),
  ]);
  assert.deepEqual(ids(result), ["wr", "pc"]);
  assert.equal(result[0]._chronologyParentId, null);
  assert.equal(result[1]._chronologyParentId, "wr");
});

test("metadata dates and universes apply without requiring changes to original records", () => {
  const pc = skin("pc", "Elderwood Ahri", null);
  const child = wr("wr", "Coven Ahri", "2025-01-01");
  const result = organizeSkins([child, pc], { entries: {
    [metadataKey(pc)]: { releaseDate: "2019-08-29", universes: ["Eclipse"] },
    [metadataKey(child)]: { universes: ["Eclipse"] },
  } });
  assert.deepEqual(ids(result), ["pc", "wr"]);
  assert.equal(result[0].releaseDate, "2019-08-29");
  assert.equal(result[1]._chronologyParentId, "pc");
  assert.equal(pc.releaseDate, null);
});

test("identical art keeps the PC record and every favorite alias, regardless of input order", () => {
  const original = "https://wiki.leagueoflegends.com/en-us/images/Ahri_CovenSkin.jpg";
  const thumbnail = "https://wiki.leagueoflegends.com/en-us/images/thumb/Ahri_CovenSkin_HD.jpg/600px-Ahri_CovenSkin_HD.jpg?download=1";
  const input = [
    wr("wr", "Coven Ahri (Wild Rift)", "2023-01-01", { image: thumbnail, _duplicateIds: ["older-wr"] }),
    skin("pc", "Coven Ahri", "2021-01-01", { image: original, _duplicateIds: ["older-pc"] }),
    wr("alias", "Coven Ahri", "2023-01-01", { image: original }),
  ];
  const before = structuredClone(input);
  const [result] = deduplicateSkins(input);
  assert.equal(deduplicateSkins(input).length, 1);
  assert.equal(result._id, "pc");
  assert.deepEqual(new Set(result.platforms), new Set(["PC", "Wild Rift"]));
  assert.deepEqual(new Set(result._duplicateIds), new Set(["wr", "alias", "older-wr", "older-pc"]));
  assert.deepEqual(input, before);
});

test("renamed aliases collapse only when their canonical identity and illustration match", () => {
  const shared = "https://images.example/shared.jpg";
  const result = deduplicateSkins([
    wr("old", "Old Name Ahri", "2020-01-01", { image: shared, canonicalSkin: "New Name", isAlias: true }),
    wr("new", "New Name Ahri", "2020-01-01", { image: shared, canonicalSkin: "New Name" }),
    wr("different", "New Name Ahri", "2020-01-01", { canonicalSkin: "New Name" }),
  ]);
  assert.deepEqual(ids(result), ["new", "different"]);
  assert.deepEqual(result[0]._duplicateIds, ["old"]);
});

test("shared HD and fallback images do not collapse distinct primary illustrations", () => {
  const common = "https://images.example/incorrect-common-hd.jpg";
  const result = deduplicateSkins([
    skin("a", "Coven Ahri", "2021-01-01", { imageCandidates: ["https://images.example/a.jpg", common], highResImageCandidates: [common] }),
    wr("b", "Coven Ahri", "2023-01-01", { imageCandidates: ["https://images.example/b.jpg", common], highResImageCandidates: [common] }),
  ]);
  assert.deepEqual(ids(result), ["a", "b"]);
});

test("distinct LoR levels and chroma illustrations survive and stay with their parent", () => {
  const result = organizeSkins([
    skin("level2", "Coven Ahri — Level 2", "2022-01-01", { type: "Legends of Runeterra", lorCardCode: "05IO004T1", lorLevelNumber: 2 }),
    skin("pearl", "Coven Ahri Chroma Pearl", "2021-02-01"),
    skin("pc", "Coven Ahri", "2021-01-01"),
    skin("level1", "Coven Ahri — Level 1", "2022-01-01", { type: "Legends of Runeterra", lorCardCode: "05IO004", lorLevelNumber: 1 }),
    skin("ruby", "Coven Ahri Chroma Ruby", "2021-02-01"),
  ]);
  assert.deepEqual(ids(result), ["pc", "pearl", "ruby", "level1", "level2"]);
  assert.ok(result.slice(1).every((item) => item._chronologyParentId === "pc"));
});

test("duplicate IDs appear once, while records without usable art are retained", () => {
  const result = deduplicateSkins([
    skin("same", "Coven Ahri", "2021-01-01"),
    skin("same", "Coven Ahri", "2021-01-01", { image: "https://images.example/updated.jpg" }),
    skin("missing-a", "Arcana Ahri", null, { image: null }),
    skin("missing-b", "Arcana Ahri", null, { image: null }),
  ]);
  assert.deepEqual(ids(result), ["same", "missing-a", "missing-b"]);
});
