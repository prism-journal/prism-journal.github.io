// Regenerates prism-journal.html (the Claude Artifact copy) from index.html.
//
// index.html is the source of truth: it is the real website, and it is what
// GitHub Pages serves. The artifact copy is the same page with the
// <!doctype>/<html>/<head>/<body> wrapper stripped, because the Artifact host
// supplies its own.
//
//   node build.mjs

import { readFileSync, writeFileSync } from "node:fs";

const SRC = new URL("./index.html", import.meta.url);
const OUT = new URL("./prism-journal.html", import.meta.url);

const html = readFileSync(SRC, "utf8");

const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
if (!title) throw new Error("index.html has no <title> — refusing to build.");

const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1];
if (!body) throw new Error("index.html has no <body> — refusing to build.");

writeFileSync(OUT, `<title>${title}</title>\n${body.trim()}\n`);

console.log(`prism-journal.html rebuilt from index.html (${body.trim().length} bytes)`);
