#!/usr/bin/env node
/**
 * The one rule ARCHITECTURE.md §4.2 calls out as load-bearing:
 *
 *   "sim/ must never import from render/ or ui/, and must never reference
 *    document, window, Date.now(), or Math.random(). Enforce it with an
 *    ESLint no-restricted-imports / no-restricted-globals rule on that
 *    directory -- that single rule is what keeps the simulation portable
 *    to the server."
 *
 * This was meant to be that ESLint rule, and isn't, for two compounding
 * reasons discovered while trying:
 *
 * 1. typescript-eslint (8.66.0, latest published) unconditionally refuses to
 *    run against TypeScript 7 -- not a peer-dependency warning, a hard throw
 *    at require-time ("typescript-eslint does not support TS 7.0", tracked at
 *    https://github.com/typescript-eslint/typescript-eslint/issues/10940).
 *    `npm install --legacy-peer-deps` doesn't route around it.
 *
 * 2. The fallback plan -- skip typescript-eslint and walk the AST directly
 *    with the `typescript` package's own compiler API -- doesn't work either.
 *    TS 7 restructured the package entirely: `require('typescript')` now
 *    exposes only `{ version, versionMajorMinor }`. The classic
 *    createSourceFile/forEachChild API most tooling (including
 *    typescript-eslint) is built on lives nowhere in the public entry point
 *    anymore; what exists is a set of explicitly `unstable/ast/*` subpath
 *    exports with no stability guarantee -- not something worth building a
 *    permanent guard script against.
 *
 * So: plain text scanning. Cruder than an AST walk, but it has zero
 * dependency surface to break out from under this project again, and for the
 * narrow thing being checked here (an import specifier, a handful of bare
 * global identifiers) it's reliable enough. Revisit switching to real
 * `no-restricted-imports` / `no-restricted-globals` once typescript-eslint
 * ships TS 7 support (issue above).
 *
 * Math.random() is deliberately NOT checked here yet: seeded RNG is still
 * deferred (ARCHITECTURE.md §8), and every existing call site in sim/ already
 * carries a comment saying so.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const simDir = join(repoRoot, 'client/src/sim');

const RESTRICTED_IMPORT_PATTERNS = [
  { test: (spec) => /\/render(\/|$)/.test(spec), message: 'sim/ must not import render/ -- it has to run headless (ARCHITECTURE.md §4.2).' },
  { test: (spec) => /\/ui(\/|$)/.test(spec), message: 'sim/ must not import ui/ -- it has to run headless (ARCHITECTURE.md §4.2).' },
  { test: (spec) => /\/main(\.ts)?$/.test(spec), message: 'sim/ must not import main.ts -- that is the dependency direction reversed.' },
];

// Word-boundary, not preceded by a `.` (so `state.document` or a property
// named `window` doesn't false-positive -- only a bare reference to the
// global itself counts).
const RESTRICTED_GLOBAL_RE = /(?<![.\w])(document|window|localStorage|requestAnimationFrame)\b/g;
const DATE_NOW_RE = /(?<![.\w])Date\s*\.\s*now\s*\(/g;
const IMPORT_SPECIFIER_RE = /^\s*import\s+(?:type\s+)?[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/;

function stripComments(text) {
  // Block comments first (handles /** ... */ doc comments spanning lines),
  // then line comments. Crude -- doesn't understand string/template literals
  // containing `//` or `/*` -- but sim/ is plain game logic, not string
  // manipulation of code, so that's not a real risk here.
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function checkFile(path) {
  const raw = readFileSync(path, 'utf8');
  const text = stripComments(raw);
  const rel = relative(repoRoot, path);
  const violations = [];
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    const importMatch = line.match(IMPORT_SPECIFIER_RE);
    if (importMatch) {
      const spec = importMatch[1];
      for (const { test, message } of RESTRICTED_IMPORT_PATTERNS) {
        if (test(spec)) violations.push({ line: i + 1, text: `import "${spec}"`, message });
      }
    }

    for (const m of line.matchAll(RESTRICTED_GLOBAL_RE)) {
      violations.push({ line: i + 1, text: m[1], message: 'sim/ must not touch the DOM or browser globals.' });
    }
    for (const _m of line.matchAll(DATE_NOW_RE)) {
      violations.push({ line: i + 1, text: 'Date.now()', message: 'sim/ must not read wall-clock time -- use state.gameTime/simClock, passed in.' });
    }
  });

  return violations.map((v) => ({ file: rel, ...v }));
}

const files = walk(simDir);
const allViolations = files.flatMap(checkFile);

if (allViolations.length) {
  console.error(`sim/ boundary check failed -- ${allViolations.length} violation(s):\n`);
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}\n    ${v.message}`);
  }
  process.exit(1);
}

console.log(`sim/ boundary check passed (${files.length} files, no DOM/render/ui reach-ins).`);
