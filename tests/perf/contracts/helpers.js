'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { firstPartyStylesheetPaths } = require('../../helpers/runtime-css');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BASELINE_PATH = path.join(__dirname, 'baseline.json');

function relativePath(absolutePath) {
  return path.relative(ROOT, absolutePath).split(path.sep).join('/');
}

function readRepositoryFile(relative) {
  return fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');
}

function walkFiles(start, predicate = () => true) {
  const absoluteStart = path.join(ROOT, ...start.split('/'));
  if (!fs.existsSync(absoluteStart)) return [];
  const found = [];
  const visit = (absolute) => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && predicate(child)) found.push(child);
    }
  };
  visit(absoluteStart);
  return found.sort();
}

function runtimeJavaScriptFiles() {
  const rootFiles = ['main.js', 'mobile.js', 'theme.js']
    .map((file) => path.join(ROOT, file))
    .filter((file) => fs.existsSync(file));
  return rootFiles.concat(
    walkFiles('scripts', (file) => /\.(?:js|mjs)$/i.test(file))
  );
}

function runtimeCssFiles() {
  return firstPartyStylesheetPaths(ROOT).map((relative) => (
    path.join(ROOT, ...relative.split('/'))
  ));
}

function countMatches(source, expression) {
  return Array.from(source.matchAll(expression)).length;
}

function inventoryMatches(files, expression) {
  const inventory = {};
  for (const file of files) {
    const count = countMatches(fs.readFileSync(file, 'utf8'), expression);
    if (count) inventory[relativePath(file)] = count;
  }
  return inventory;
}

function countCallsWithLiteralFalseThirdArgument(source, methodName) {
  const startExpression = new RegExp(`\\.\\s*${methodName}\\s*\\(`, 'g');
  let count = 0;
  let match;
  while ((match = startExpression.exec(source))) {
    const openParen = match.index + match[0].lastIndexOf('(');
    const argumentsFound = [];
    let argumentStart = openParen + 1;
    let parentheses = 1;
    let brackets = 0;
    let braces = 0;
    let quote = '';
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = openParen + 1; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1] || '';
      if (lineComment) {
        if (character === '\n') lineComment = false;
        continue;
      }
      if (blockComment) {
        if (character === '*' && next === '/') {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === '/' && next === '/') {
        lineComment = true;
        index += 1;
        continue;
      }
      if (character === '/' && next === '*') {
        blockComment = true;
        index += 1;
        continue;
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character;
        continue;
      }
      if (character === '(') parentheses += 1;
      else if (character === ')') {
        parentheses -= 1;
        if (parentheses === 0) {
          argumentsFound.push(source.slice(argumentStart, index).trim());
          startExpression.lastIndex = index + 1;
          break;
        }
      } else if (character === '[') brackets += 1;
      else if (character === ']') brackets = Math.max(0, brackets - 1);
      else if (character === '{') braces += 1;
      else if (character === '}') braces = Math.max(0, braces - 1);
      else if (character === ',' && parentheses === 1 && brackets === 0 && braces === 0) {
        argumentsFound.push(source.slice(argumentStart, index).trim());
        argumentStart = index + 1;
      }
    }
    if (argumentsFound.length >= 3 && argumentsFound[2] === 'false') count += 1;
  }
  return count;
}

function inventoryLiteralFalseThirdArgument(files, methodName) {
  const inventory = {};
  for (const file of files) {
    const count = countCallsWithLiteralFalseThirdArgument(
      fs.readFileSync(file, 'utf8'),
      methodName
    );
    if (count) inventory[relativePath(file)] = count;
  }
  return inventory;
}

function assertInventoryDoesNotGrow(assert, label, actual, allowed) {
  const regressions = [];
  for (const [file, count] of Object.entries(actual)) {
    const maximum = Number(allowed[file] || 0);
    if (count > maximum) regressions.push(`${file}: ${count} (allowed ${maximum})`);
  }
  assert.deepEqual(
    regressions,
    [],
    `${label} grew:\n${regressions.join('\n')}\n` +
      `Remove the new risky site, or update ${relativePath(BASELINE_PATH)} with measured justification.`
  );
}

function parseCssBlocks(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const expression = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of withoutComments.matchAll(expression)) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (!selector.startsWith('@')) blocks.push({ selector, body: match[2] });
  }
  return blocks;
}

function declarationsForSelector(blocks, selector) {
  return blocks
    .filter((block) => block.selector.split(',').map((item) => item.trim()).includes(selector))
    .map((block) => block.body)
    .join('\n');
}

function loadBaseline() {
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

module.exports = {
  BASELINE_PATH,
  ROOT,
  assertInventoryDoesNotGrow,
  countCallsWithLiteralFalseThirdArgument,
  countMatches,
  declarationsForSelector,
  inventoryMatches,
  inventoryLiteralFalseThirdArgument,
  loadBaseline,
  parseCssBlocks,
  readRepositoryFile,
  relativePath,
  runtimeCssFiles,
  runtimeJavaScriptFiles,
  walkFiles
};
