// Parse metadata tables only; never evaluate downloaded Lua.
const unquote = (value) => value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
function extractReturnTable(source) {
  const match = /\breturn\s*\{/.exec(source);
  if (!match) throw new Error('Lua module has no return table');
  const open = source.indexOf('{', match.index);
  const close = findMatchingBrace(source, open);
  return source.slice(open, close + 1);
}

function parseImmediateTableEntries(tableText) {
  const entries = [];
  let index = 1;
  let depth = 1;

  while (index < tableText.length - 1) {
    const skipped = skipTrivia(tableText, index);
    index = skipped.index;
    if (index >= tableText.length - 1) break;

    const char = tableText[index];
    if (char === '"' || char === "'") {
      index = skipString(tableText, index);
      continue;
    }
    if (char === '{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      index += 1;
      continue;
    }

    if (depth === 1 && tableText.startsWith('["', index)) {
      const keyEnd = findStringEnd(tableText, index + 1);
      if (keyEnd > index) {
        const rawKey = tableText.slice(index + 2, keyEnd);
        let cursor = keyEnd + 1;
        cursor = skipWhitespace(tableText, cursor);
        if (tableText[cursor] === ']') cursor += 1;
        cursor = skipWhitespace(tableText, cursor);
        if (tableText[cursor] === '=') cursor += 1;
        cursor = skipWhitespace(tableText, cursor);
        if (tableText[cursor] === '{') {
          const close = findMatchingBrace(tableText, cursor);
          entries.push({ key: rawKey.replace(/\\"/g, '"').replace(/\\\\/g, '\\'), block: tableText.slice(cursor, close + 1) });
          index = close + 1;
          continue;
        }
      }
    }

    index += 1;
  }
  return entries;
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const skipped = skipTrivia(text, index);
    if (skipped.index !== index) {
      index = skipped.index - 1;
      continue;
    }
    const char = text[index];
    if (char === '"' || char === "'") {
      index = skipString(text, index) - 1;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unbalanced Lua table near index ${openIndex}`);
}

function skipTrivia(text, index) {
  let cursor = index;
  while (cursor < text.length) {
    if (/\s/.test(text[cursor])) {
      cursor += 1;
      continue;
    }
    if (text.startsWith('--[[', cursor)) {
      const end = text.indexOf(']]', cursor + 4);
      cursor = end >= 0 ? end + 2 : text.length;
      continue;
    }
    if (text.startsWith('--', cursor)) {
      const end = text.indexOf('\n', cursor + 2);
      cursor = end >= 0 ? end + 1 : text.length;
      continue;
    }
    break;
  }
  return { index: cursor };
}

function skipString(text, quoteIndex) {
  const end = findStringEnd(text, quoteIndex);
  return end >= quoteIndex ? end + 1 : text.length;
}

function findStringEnd(text, quoteIndex) {
  const quote = text[quoteIndex];
  for (let index = quoteIndex + 1; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
      continue;
    }
    if (text[index] === quote) return index;
  }
  return -1;
}

function skipWhitespace(text, index) {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

// Read only immediate properties so missing parent metadata cannot inherit a chroma's date.
function fields(block) {
  const values = {};
  let i = 1;
  while (i < block.length - 1) {
    i = skipTrivia(block, i).index;
    if (block.startsWith('["', i)) {
      const keyEnd = findStringEnd(block, i + 1);
      const key = unquote(block.slice(i + 2, keyEnd));
      let cursor = block.indexOf('=', keyEnd) + 1;
      cursor = skipTrivia(block, cursor).index;
      if (block[cursor] === '{') {
        const end = findMatchingBrace(block, cursor);
        values[key] = { table: block.slice(cursor, end + 1) };
        i = end + 1;
      } else if (block[cursor] === '"' || block[cursor] === "'") {
        const end = findStringEnd(block, cursor);
        values[key] = unquote(block.slice(cursor + 1, end));
        i = end + 1;
      } else {
        const end = block.slice(cursor).search(/[,\n}]/);
        values[key] = block.slice(cursor, cursor + end).trim();
        i = cursor + Math.max(end, 1);
      }
    } else if (block[i] === '{') i = findMatchingBrace(block, i) + 1;
    else if (block[i] === '"' || block[i] === "'") i = skipString(block, i);
    else i++;
  }
  return values;
}

function strings(table) {
  if (!table) return [];
  const result = [];
  let i = 1;
  while (i < table.length - 1) {
    i = skipTrivia(table, i).index;
    if (table[i] === '"' || table[i] === "'") {
      const end = findStringEnd(table, i);
      result.push(unquote(table.slice(i + 1, end)));
      i = end + 1;
    } else i++;
  }
  return result;
}


export { extractReturnTable, parseImmediateTableEntries, fields, strings };
