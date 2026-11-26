/**
 * Inlines the built CSS and JS into one standalone HTML file: `dist/ludo.html`.
 *
 * Why: a normal Vite build points at `/assets/...`, so opening it from the filesystem
 * needs a web server. One file with no external requests opens by double-click and can
 * be sent to anyone. Everything is local; nothing is fetched at runtime.
 *
 *   npm run bundle
 */

import { createHash } from 'node:crypto';
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

// The game is one inline module, so lock it down by content hash rather than a nonce:
// nothing else on the page may run, and nothing may load, connect or frame us.
const scriptBody = `\n${js}\n`;
const scriptHash = createHash('sha256').update(scriptBody, 'utf8').digest('base64');
const cspMeta =
  '<meta http-equiv="Content-Security-Policy" content="' +
  [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ') +
  '">';

const standalone = html
  .replace(styleTag, `<style>\n${css}\n</style>`)
  .replace(scriptTag, `<script type="module">${scriptBody}</script>`)
  .replace(
    '<meta name="color-scheme" content="dark" />',
    `<meta name="color-scheme" content="dark" />\n    ${cspMeta}`,
  );

if (!standalone.includes('Content-Security-Policy')) {
  throw new Error('the CSP meta tag was not injected into the standalone file');
}

const out = join(dist, 'ludo.html');
writeFileSync(out, standalone);

const kb = (Buffer.byteLength(standalone) / 1024).toFixed(1);
console.log(`wrote ${out} (${kb} kB, no external requests)`);
