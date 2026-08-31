'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readFirstPartyStylesheets } = require('../helpers/runtime-css');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STYLES_PATH = path.join(REPO_ROOT, 'styles.css');
const TOKEN_START = '/* === THEME TOKENS: START === */';
const TOKEN_END = '/* === THEME TOKENS: END === */';

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function runtimeJavaScriptFiles(directory) {
  const absolute = path.join(REPO_ROOT, directory);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return runtimeJavaScriptFiles(relative);
    return entry.isFile() && entry.name.endsWith('.js') ? [relative] : [];
  });
}

function themeTokenSection(source) {
  const starts = source.split(TOKEN_START).length - 1;
  const ends = source.split(TOKEN_END).length - 1;
  assert.equal(starts, 1, `styles.css must contain exactly one ${TOKEN_START} marker`);
  assert.equal(ends, 1, `styles.css must contain exactly one ${TOKEN_END} marker`);

  const start = source.indexOf(TOKEN_START);
  const end = source.indexOf(TOKEN_END);
  assert.ok(start < end, 'the theme-token START marker must precede the END marker');
  return {
    section: source.slice(start + TOKEN_START.length, end),
    withoutSection: source.slice(0, start) + source.slice(end + TOKEN_END.length),
  };
}

function declarations(source) {
  const results = [];
  const declaration = /(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)(?=;|})/gm;
  for (const match of source.matchAll(declaration)) {
    results.push({
      property: match[1],
      value: match[2].trim(),
      index: match.index,
    });
  }
  return results;
}

function themeBlocks(section) {
  const themes = new Map();
  const block = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of stripComments(section).matchAll(block)) {
    const names = Array.from(match[1].matchAll(
      /(?:html|:root)\s*\[\s*data-theme\s*=\s*["']([^"']+)["']\s*\]/g,
    ), (theme) => theme[1]);
    if (!names.length) continue;

    const properties = declarations(`{${match[2]}}`)
      .map((item) => item.property)
      .filter((property) => property.startsWith('--'))
      .sort();
    for (const name of names) {
      assert.ok(!themes.has(name), `theme ${name} must have exactly one token block`);
      themes.set(name, properties);
    }
  }
  return themes;
}

function baseThemeProperties(section) {
  const block = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of stripComments(section).matchAll(block)) {
    const selector = match[1].trim();
    if (selector !== ':root') continue;
    return declarations(`{${match[2]}}`)
      .map((item) => item.property)
      .filter((property) => property.startsWith('--'))
      .sort();
  }
  return [];
}

function runtimeThemeRegistry() {
  const window = {};
  const document = {
    readyState: 'loading',
    addEventListener() {},
  };
  vm.runInNewContext(read('theme.js'), { window, document }, { filename: 'theme.js' });
  return window.SURRICULUM_THEMES;
}

const COLOR_FUNCTION_OR_HEX = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/gi;
const SCRIPT_COLOR_FUNCTION_OR_HEX = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/gi;
const CSS_NAMED_COLORS = new Set(`
  aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond
  blue blueviolet brown burlywood cadetblue chartreuse chocolate coral
  cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
  darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid
  darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
  darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
  firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod
  gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
  lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon
  lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue
  lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
  mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
  mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
  navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod
  palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
  powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon
  sandybrown seagreen seashell sienna silver skyblue slateblue slategray
  slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet
  wheat white whitesmoke yellow yellowgreen
`.trim().split(/\s+/));

function hasColorFunctionOrHex(value) {
  COLOR_FUNCTION_OR_HEX.lastIndex = 0;
  return COLOR_FUNCTION_OR_HEX.test(value);
}

function namedColorMatches(value) {
  const normalized = value.toLowerCase();
  return Array.from(normalized.matchAll(/[a-z]+/g)).filter((match) => {
    if (!CSS_NAMED_COLORS.has(match[0])) return false;
    const before = match.index > 0 ? normalized[match.index - 1] : '';
    const after = normalized[match.index + match[0].length] || '';
    return !/[-\w]/.test(before) && !/[-\w]/.test(after);
  });
}

function literalFindings(relativePath, source, options = {}) {
  const findings = [];
  const stripped = stripComments(source);
  const literalPattern = options.css ? COLOR_FUNCTION_OR_HEX : SCRIPT_COLOR_FUNCTION_OR_HEX;
  literalPattern.lastIndex = 0;
  for (const match of stripped.matchAll(literalPattern)) {
    const lineStart = stripped.lastIndexOf('\n', match.index) + 1;
    const lineEnd = stripped.indexOf('\n', match.index);
    const line = stripped.slice(lineStart, lineEnd < 0 ? stripped.length : lineEnd);
    const isSchedulerCourseVisualization = /^scripts\/scheduler(?:\.js|\/[^/]+\.js)$/.test(relativePath)
      && /^hsl/i.test(match[0])
      && /var\(--scheduler-course-[^)]+\)/.test(line);
    if (isSchedulerCourseVisualization) continue;
    findings.push(`${relativePath}:${lineNumber(stripped, match.index)} (${match[0]})`);
  }

  if (options.css) {
    for (const item of declarations(stripped)) {
      const named = namedColorMatches(item.value)[0]?.[0];
      if (named) {
        findings.push(`${relativePath}:${lineNumber(stripped, item.index)} (${named})`);
      }
    }
  } else {
    const fragments = [
      /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi,
    ];
    if (relativePath.endsWith('.js')) {
      fragments.push(
        /\.style(?:\.[A-Za-z_$][\w$]*|\[\s*["'][^"']+["']\s*\])\s*=\s*(["'`])([^"'`\r\n]*)\1/g,
        /\.style\.setProperty\(\s*["'][^"']+["']\s*,\s*(["'`])([^"'`\r\n]*)\1/g,
        /\.setAttribute\(\s*["']style["']\s*,\s*(["'`])([^"'`\r\n]*)\1/g,
      );
    }
    for (const pattern of fragments) {
      for (const match of stripped.matchAll(pattern)) {
        for (const named of namedColorMatches(match[2])) {
          const fragmentOffset = match[0].indexOf(match[2]);
          findings.push(`${relativePath}:${lineNumber(stripped, match.index + fragmentOffset + named.index)} (${named[0]})`);
        }
      }
    }
  }
  return findings;
}

test('every declared theme implements the same centralized token contract', () => {
  const styles = fs.readFileSync(STYLES_PATH, 'utf8');
  const { section } = themeTokenSection(styles);
  const themes = themeBlocks(section);
  const registry = runtimeThemeRegistry();
  const baseProperties = baseThemeProperties(section);

  assert.ok(registry && typeof registry === 'object', 'theme.js must expose a declarative registry');
  assert.deepEqual(
    [...themes.keys()].sort(),
    Object.keys(registry).sort(),
    'every registry theme must have exactly one html[data-theme] token block',
  );
  assert.ok(baseProperties.length > 0, 'the shared :root block must define the token contract');
  assert.ok(!baseProperties.includes('--test'), 'the old unused --test token must not return');

  for (const [name, properties] of themes) {
    const unknown = properties.filter((property) => !baseProperties.includes(property));
    assert.deepEqual(
      unknown,
      [],
      `${name} may only override tokens declared by the shared :root contract`,
    );
    assert.equal(registry[name].id, name, `registry key ${name} must match its id`);
    assert.ok(registry[registry[name].next], `${name}.next must identify another registered theme`);
  }

  const nonTokenDeclarations = declarations(section).filter((item) => (
    (hasColorFunctionOrHex(item.value) || namedColorMatches(item.value).length > 0)
      && !item.property.startsWith('--')
  ));
  assert.deepEqual(
    nonTokenDeclarations,
    [],
    'literal colors inside the centralized section must belong to custom-property declarations',
  );
});

test('first-party runtime UI has no literal colors outside the centralized token section', () => {
  const stylesheets = readFirstPartyStylesheets(REPO_ROOT);
  const sources = new Map([
    ...stylesheets.map(({ relative, source }) => [
      relative,
      relative === 'styles.css' ? themeTokenSection(source).withoutSection : source,
    ]),
    ['index.html', read('index.html')],
    ['main.js', read('main.js')],
    ['mobile.js', read('mobile.js')],
    ['theme.js', read('theme.js')],
    ['sw.js', read('sw.js')],
    ...runtimeJavaScriptFiles('scripts').map((file) => [file, read(file)]),
  ]);

  const findings = [];
  for (const [file, source] of sources) {
    findings.push(...literalFindings(file, source, {
      css: file.endsWith('.css'),
    }));
  }
  assert.deepEqual(
    findings,
    [],
    `move first-party runtime colors into the centralized theme tokens:\n${findings.join('\n')}`,
  );
});

test('component code does not branch on a particular theme', () => {
  const componentCss = stripComments(readFirstPartyStylesheets(REPO_ROOT)
    .map(({ relative, source }) => (
      relative === 'styles.css' ? themeTokenSection(source).withoutSection : source
    ))
    .join('\n'));
  assert.doesNotMatch(
    componentCss,
    /(?:html|:root)\s*\[\s*data-theme\s*=/,
    'theme-specific selectors belong only in the centralized token section',
  );
  assert.doesNotMatch(
    componentCss,
    /\.(?:dark|light)-theme\b/,
    'legacy theme-specific component selectors make additional themes unsafe',
  );

  const nonThemeRuntime = [
    ['main.js', read('main.js')],
    ['mobile.js', read('mobile.js')],
    ...runtimeJavaScriptFiles('scripts').map((file) => [file, read(file)]),
  ];
  const branches = nonThemeRuntime.flatMap(([file, source]) => (
    /(?:dark|light)-theme|dataset\.theme\b|(?:get|set|has|remove)Attribute\(\s*["']data-theme["']/.test(stripComments(source))
      ? [file]
      : []
  ));
  assert.deepEqual(
    branches,
    [],
    `only theme.js may know concrete theme identities; found ${branches.join(', ')}`,
  );
});
