// Renders each generated article page to a real PDF.
//
//   node tools/render-pdf.mjs
//
// A print dialog is not a download, and Google Scholar wants citation_pdf_url
// pointing at a file it can fetch. Browsers also cannot draw page numbers —
// the CSS paged-media margin boxes that would do it are unimplemented — so the
// running foot is supplied here instead.
//
// Dev-only: npm i puppeteer

import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// resolve, not join: an absolute path passed in was being appended to ROOT
const SRC = process.argv[2] ? [resolve(process.cwd(), process.argv[2])]
  : (existsSync(join(ROOT, "articles"))
      ? readdirSync(join(ROOT, "articles")).filter((f) => f.endsWith(".html"))
          .map((f) => join(ROOT, "articles", f))
      : []);

if (!SRC.length) { console.log("No article pages to render."); process.exit(0); }

const foot = `<div style="width:100%;font:8pt -apple-system,sans-serif;color:#666;
  padding:0 20mm;display:flex;justify-content:space-between">
  <span>prism-journal.github.io</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;

const browser = await puppeteer.launch();
for (const file of SRC) {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle0" });
  const out = file.replace(/\.html$/, ".pdf");
  await page.pdf({
    path: out, format: "A4", printBackground: true,
    displayHeaderFooter: true, headerTemplate: "<div></div>", footerTemplate: foot,
    margin: { top: "22mm", right: "20mm", bottom: "18mm", left: "20mm" },
  });
  console.log(`  ${basename(out)}`);
  await page.close();
}
await browser.close();
