/**
 * Inlines the built CSS and JS into one standalone HTML file: `dist/ludo.html`.
 *
 * Why: a normal Vite build points at `/assets/...`, so opening it from the filesystem
 * needs a web server. One file with no external requests opens by double-click and can
 * be sent to anyone. Everything is local; nothing is fetched at runtime.
 *
 *   npm run bundle
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const styleTag = /<link\s+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/;
const scriptTag = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/;

const styleMatch = html.match(styleTag);
const scriptMatch = html.match(scriptTag);
if (!styleMatch || !scriptMatch) {
  throw new Error('dist/index.html does not contain the expected style and script tags');
}

const css = readFileSync(join(dist, styleMatch[1]), 'utf8');
const js = readFileSync(join(dist, scriptMatch[1]), 'utf8').replace(/<\/script/gi, '<\\/script');

const standalone = html
  .replace(styleTag, `<style>\n${css}\n</style>`)
  .replace(scriptTag, `<script type="module">\n${js}\n</script>`);

const out = join(dist, 'ludo.html');
writeFileSync(out, standalone);

const kb = (Buffer.byteLength(standalone) / 1024).toFixed(1);
console.log(`wrote ${out} (${kb} kB, no external requests)`);
