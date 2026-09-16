import assert from "node:assert/strict";
import test from "node:test";
import { extractReturnTable, fields, parseImmediateTableEntries, strings } from "../scripts/wiki-skin-metadata.mjs";

test("a missing parent release date never inherits a nested chroma's date", () => {
  const data = fields(`{
    ["availability"] = "Upcoming",
    ["chromas"] = {
      ["Ruby"] = { ["release"] = "2024-07-17", ["set"] = { "Nested Set" } },
    },
    ["set"] = { "Coven", "Elderwood" },
  }`);
  assert.equal(data.release, undefined);
  assert.equal(data.availability, "Upcoming");
  assert.deepEqual(strings(data.set.table), ["Coven", "Elderwood"]);
  const [chroma] = parseImmediateTableEntries(data.chromas.table);
  assert.equal(chroma.key, "Ruby");
  assert.equal(fields(chroma.block).release, "2024-07-17");
});

test("extracts complete tables despite braces, escaped quotes and comments inside strings", () => {
  const source = String.raw`
    local unused = "ignored"
    return {
      -- A comment containing } and a fake ["Ignored"] = {
      ["Ahri"] = {
        ["skins"] = {
          ["The \"Quoted\" Skin"] = {
            ["description"] = "A } brace, a { brace, and -- text",
            --[[ ["fake"] = { } } ]]
            ["release"] = "2024-01-02",
          },
        },
      },
      ["Lux"] = { ["release"] = '2020-01-01' },
    }
    local after = "not part of the returned table"
  `;
  const table = extractReturnTable(source);
  const champions = parseImmediateTableEntries(table);
  assert.deepEqual(champions.map((entry) => entry.key), ["Ahri", "Lux"]);
  const [skin] = parseImmediateTableEntries(fields(champions[0].block).skins.table);
  assert.equal(skin.key, 'The "Quoted" Skin');
  assert.equal(fields(skin.block).description, "A } brace, a { brace, and -- text");
  assert.equal(fields(skin.block).release, "2024-01-02");
  assert.equal(fields(champions[1].block).release, "2020-01-01");
  assert.ok(!table.includes("not part of the returned table"));
});

test("reads list strings without treating comment contents as metadata", () => {
  const table = String.raw`{
    "Coven", -- "Not a set"
    --[[ "Also not a set" ]]
    'Elderwood', "A \"quoted\" set", "A \\ path"
  }`;
  assert.deepEqual(strings(table), ["Coven", "Elderwood", 'A "quoted" set', "A \\ path"]);
});

test("rejects missing and truncated source tables instead of accepting incomplete metadata", () => {
  assert.throws(() => extractReturnTable('local data = {}'), /no return table/);
  assert.throws(() => extractReturnTable('return { ["Ahri"] = { ["release"] = "2024-01-01" }'), /Unbalanced Lua table/);
});
