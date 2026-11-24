#!/usr/bin/env node
/**
 * Design-system guardrails for client/src (the StyleX eslint-plugin analog).
 *
 * Enforces the token architecture in index.css:
 *   - no hex literals in .tsx (the export palette lives in lib/exportPalette.ts)
 *   - no text-[Npx] arbitrary sizes — use the --text-* scale (text-2xs floor)
 *   - no inline style={{...}} except custom-property assignments (--*)
 *   - no focus:ring utilities — use the .focus-ring primitive
 *   - no `dark:` variants — theming is data-attribute driven
 *   - no retired animation classes
 *
 * Run: npm run lint:design --workspace=client
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const HEX_ALLOWLIST = new Set(['lib/exportPalette.ts']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Blanks out comments, strings and template literals (backtick … ` with
 *  ${} nesting) so hex/pattern checks only see real code, not generated
 *  CSS/HTML strings or prose in comments. */
function stripTemplates(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      out += q;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += q; i++;
      continue;
    }
    if (c === '`') {
      out += '``';
      i++;
      let depth = 0;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`' && depth === 0) { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; out += '${'; continue; }
        if (src[i] === '}' && depth > 0) { depth--; i++; out += '}'; continue; }
        if (depth > 0) { out += src[i]; i++; continue; } // keep interpolation code visible
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const violations = [];
const report = {};

for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split('\\').join('/');
  const raw = readFileSync(file, 'utf8');
  const src = stripTemplates(raw);
  const lines = src.split('\n');
  lines.forEach((line, idx) => {
    const at = `${rel}:${idx + 1}`;
    if (file.endsWith('.tsx') && /#[0-9a-fA-F]{6}\b/.test(line) && !HEX_ALLOWLIST.has(rel)) {
      violations.push(`${at}  hex literal in .tsx — move it to lib/exportPalette.ts`);
    }
    if (/#[0-9a-fA-F]{6}\b/.test(line) && file.endsWith('.ts') && !HEX_ALLOWLIST.has(rel)) {
      violations.push(`${at}  hex literal in .ts — only lib/exportPalette.ts may hold colors`);
    }
    if (/text-\[\d+(\.\d+)?px\]/.test(line)) {
      violations.push(`${at}  arbitrary text-[Npx] — use the --text-* scale (text-2xs is the floor)`);
    }
    if (/focus(-visible)?:ring/.test(line)) {
      violations.push(`${at}  focus:ring utility — use the .focus-ring primitive`);
    }
    if (/\bdark:/.test(line)) {
      violations.push(`${at}  dark: variant — theming is data-attribute driven (index.css)`);
    }
    if (/cell-softlocked|animate-fadeIn\b/.test(line)) {
      violations.push(`${at}  retired animation class — use animate-softlock-pulse / animate-fade-in`);
    }
    const styleRe = /style=\{\{([\s\S]*?)\}\}/g;
    for (const m of line.matchAll(styleRe)) {
      const keys = [...m[1].matchAll(/(['"]?)([\w-]+)\1\s*:/g)].map((k) => k[2]);
      if (keys.length === 0) continue;
      if (keys.some((k) => !k.startsWith('--'))) {
        violations.push(`${at}  inline style with non-custom-property keys — pass values via CSS vars (--*)`);
      }
    }
    for (const m of line.matchAll(/\b(?:bg|text|border)-slate-\d+/g)) {
      report[m[0]] = (report[m[0]] || 0) + 1;
    }
  });
}

if (violations.length > 0) {
  console.error(`lint:design — ${violations.length} violation(s):\n`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('lint:design — clean.');
const top = Object.entries(report).sort((a, b) => b[1] - a[1]).slice(0, 8);
if (top.length) {
  console.log('  remaining raw slate usages (migrate to surface-*/hairline tokens when touching a file):');
  for (const [k, c] of top) console.log(`    ${String(c).padStart(5)}  ${k}`);
}
