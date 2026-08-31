'use strict';

const fs = require('node:fs');
const path = require('node:path');

function stylesheetReferences(root) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const references = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1] || '';
    if (!rel.split(/\s+/).some((value) => value.toLowerCase() === 'stylesheet')) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1] || '';
    if (!href || /^(?:https?:|data:|\/)/i.test(href)) continue;
    references.push(href.split(/[?#]/, 1)[0]);
  }
  return references;
}

function firstPartyStylesheetPaths(root) {
  const references = stylesheetReferences(root)
    .filter((reference) => !reference.startsWith('assets/vendor/'));
  const duplicates = references.filter((reference, index) => references.indexOf(reference) !== index);
  if (duplicates.length) {
    throw new Error(`Duplicate first-party stylesheet links: ${[...new Set(duplicates)].join(', ')}`);
  }
  for (const reference of references) {
    if (!reference.endsWith('.css')) {
      throw new Error(`Unexpected first-party stylesheet reference: ${reference}`);
    }
    if (!fs.existsSync(path.join(root, ...reference.split('/')))) {
      throw new Error(`Missing first-party stylesheet: ${reference}`);
    }
  }
  return references;
}

function readFirstPartyStylesheets(root) {
  return firstPartyStylesheetPaths(root).map((relative) => ({
    relative,
    source: fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8'),
  }));
}

module.exports = {
  firstPartyStylesheetPaths,
  readFirstPartyStylesheets,
  stylesheetReferences,
};
