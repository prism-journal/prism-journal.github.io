// Generates a static HTML page for every accepted article, plus the issue
// listing that links them.
//
//   node tools/build-articles.mjs              build from the live database
//   node tools/build-articles.mjs --sample     render one fixture to preview.html
//
// Why static rather than fetching in the browser: Google Scholar's crawler does
// not run JavaScript. Meta tags injected at runtime are invisible to it, and an
// article Scholar cannot see is an article students cannot find. So the
// citation_* tags have to be in the served HTML, which on a static host means
// generating the file.
//
// Run it after accepting an article, then commit the result.

import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "articles");

const SITE = "https://prism-journal.github.io";
const JOURNAL = "PRISM";
const SUPABASE_URL = "https://pmlicwkwdeneosijrggu.supabase.co";
const SUPABASE_KEY = "sb_publishable_eJW3TwTx6h7LywJLk30jfw_PIKnJdw0";

const SECTIONS = {
  physics_astronomy: "Physics & Astronomy", chemistry_materials: "Chemistry & Materials",
  biology_health: "Biology & Health", earth_environment: "Earth & Environment",
  computation_math: "Computation & Mathematics", quantitative_social: "Quantitative Social Science",
};
const TYPES = {
  research_article: "Research Article", short_report: "Short Report", replication: "Replication",
  registered_report: "Registered Report", review: "Review", comment: "Comment",
};
const RECS = {
  accept: "Accept", minor_revision: "Minor revision",
  major_revision: "Major revision", decline: "Decline",
};
const CRITERIA = [["sound", "Sound"], ["honest", "Honest"],
                  ["checkable", "Checkable"], ["legible", "Legible"]];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const para = (t) => String(t ?? "").trim().split(/\n{2,}/)
  .filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n");
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const human = (d) => new Date(d).toLocaleDateString("en-GB",
  { year: "numeric", month: "long", day: "numeric" });

async function api(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/* ---------------------------------------------------------------- metadata */
// Google Scholar reads these; without them the article is not indexed and no
// student searching the literature will ever reach it.
function scholarTags(a, url) {
  const authors = [a.author_name, ...String(a.coauthors || "").split("\n")]
    .map((x) => String(x || "").split(",")[0].trim()).filter(Boolean);
  const t = [
    ["citation_journal_title", JOURNAL],
    ["citation_publisher", JOURNAL],
    ["citation_title", a.title],
    ["citation_publication_date", iso(a.updated_at).replace(/-/g, "/")],
    ["citation_online_date", iso(a.updated_at).replace(/-/g, "/")],
    ["citation_abstract_html_url", url],
    // Scholar indexes the abstract page and the file separately; giving it both
    // is what makes the full text discoverable rather than just the title.
    ["citation_pdf_url", url.replace(/\.html$/, ".pdf")],
    ["citation_language", "en"],
    ["citation_id", a.ms_number],
  ];
  authors.forEach((n) => t.push(["citation_author", n]));
  if (a.author_school) t.push(["citation_author_institution", a.author_school]);
  // Deliberately no citation_doi. The data DOI identifies the dataset, not the
  // paper; publishing it here would tell Scholar the article and the dataset
  // are the same object. Omitting the tag is correct until PRISM registers its
  // own article DOIs (Zenodo issues them free).
  return t.map(([n, c]) => `<meta name="${n}" content="${esc(c)}">`).join("\n");
}

function jsonLd(a, url) {
  const authors = [a.author_name, ...String(a.coauthors || "").split("\n")]
    .map((x) => String(x || "").split(",")[0].trim()).filter(Boolean)
    .map((name) => ({ "@type": "Person", name }));
  return JSON.stringify({
    "@context": "https://schema.org", "@type": "ScholarlyArticle",
    headline: a.title, abstract: a.abstract, author: authors,
    datePublished: iso(a.updated_at), inLanguage: "en",
    license: "https://creativecommons.org/licenses/by/4.0/",
    isAccessibleForFree: true, url,
    publisher: { "@type": "Organization", name: JOURNAL },
    isPartOf: { "@type": "Periodical", name: JOURNAL },
  }, null, 2);
}

/* ------------------------------------------------------------------- page */
function reviewBlock(r, n) {
  return `<article class="rev">
    <h3>Referee report ${n}${r.reviewer_name ? ` — ${esc(r.reviewer_name)}` : " — anonymous"}</h3>
    <p class="rec">Recommendation: <b>${esc(RECS[r.recommendation] || r.recommendation)}</b></p>
    <ul class="scores">
      ${CRITERIA.map(([k, l]) => `<li><span>${l}</span><b>${r[k]}<i>/5</i></b></li>`).join("")}
    </ul>
    <h4>Summary</h4>${para(r.summary)}
    ${r.major_points ? `<h4>Major points</h4>${para(r.major_points)}` : ""}
    ${r.minor_points ? `<h4>Minor points</h4>${para(r.minor_points)}` : ""}
  </article>`;
}

function page(a, reviews, decisions) {
  const url = `${SITE}/articles/${a.ms_number}.html`;
  const cite = `${[a.author_name, ...String(a.coauthors || "").split("\n")
    .map((x) => x.split(",")[0].trim()).filter(Boolean)].join(", ")}. ` +
    `${a.title}. ${JOURNAL} ${new Date(a.updated_at).getFullYear()}; ${a.ms_number}.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(a.title)} — ${JOURNAL}</title>
<meta name="description" content="${esc(String(a.abstract).slice(0, 180))}">
<meta name="color-scheme" content="light dark">
<link rel="canonical" href="${url}">

${scholarTags(a, url)}

<meta name="dc.title" content="${esc(a.title)}">
<meta name="dc.creator" content="${esc(a.author_name)}">
<meta name="dc.date" content="${iso(a.updated_at)}">
<meta name="dc.rights" content="CC BY 4.0">

<meta property="og:type" content="article">
<meta property="og:title" content="${esc(a.title)}">
<meta property="og:description" content="${esc(String(a.abstract).slice(0, 180))}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">

<script type="application/ld+json">
${jsonLd(a, url)}
</script>

<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230B090A'/%3E%3Cpath d='M16 6 L27 25 L5 25 Z' fill='none' stroke='%23F6F2F3' stroke-width='1.6'/%3E%3Cpath d='M2 15 L11.5 15' stroke='%23FFFDFA' stroke-width='1.6'/%3E%3Cpath d='M20 20 L31 22' stroke='%23C4213D' stroke-width='1.4'/%3E%3Cpath d='M20 20 L31 16' stroke='%232E9B4F' stroke-width='1.4'/%3E%3C/svg%3E">

<style>
  :root{--issue:#C4213D;--issue-ink:#A3132E;--issue-wash:#FBEDEF;--paper:#FBFAF9;
    --surface:#fff;--ink:#1A1416;--ink-2:#574D52;--ink-3:#8A7E83;--rule:#E5DFE0;
    --rule-2:#F1ECED;--plate:#0B090A;
    --serif:"Hoefler Text","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
    --sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,system-ui,sans-serif;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;}
  @media (prefers-color-scheme:dark){:root{--issue:#FF5F73;--issue-ink:#FF7385;
    --issue-wash:#2A1418;--paper:#0F0C0E;--surface:#171316;--ink:#F2ECEE;
    --ink-2:#A79BA0;--ink-3:#7B6F74;--rule:#2B2428;--rule-2:#201A1D;}}
  :root[data-theme="dark"]{--issue:#FF5F73;--issue-ink:#FF7385;--issue-wash:#2A1418;
    --paper:#0F0C0E;--surface:#171316;--ink:#F2ECEE;--ink-2:#A79BA0;--ink-3:#7B6F74;
    --rule:#2B2428;--rule-2:#201A1D;}
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);
    font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased}
  a{color:var(--issue-ink)}
  :focus-visible{outline:2px solid var(--issue);outline-offset:2px}

  .bar{background:var(--plate);color:#F6F2F3;border-bottom:2px solid var(--issue)}
  .bar-in{max-width:52rem;margin:0 auto;padding:.75rem 1.25rem;display:flex;
    align-items:center;gap:1rem;flex-wrap:wrap}
  .mark{font-family:var(--serif);font-size:1.25rem;letter-spacing:.14em;
    text-decoration:none;color:inherit}
  .bar a.back{margin-left:auto;font-size:.75rem;font-weight:550;text-decoration:none;
    color:rgba(246,242,243,.72);border:1px solid rgba(246,242,243,.28);
    padding:.3125rem .6875rem;border-radius:2px}
  .bar a.back:hover{color:#F6F2F3;border-color:#F6F2F3}

  main{max-width:52rem;margin:0 auto;padding:2.5rem 1.25rem 6rem}

  .kicker{font-family:var(--mono);font-size:.6875rem;letter-spacing:.12em;
    text-transform:uppercase;color:var(--issue-ink);margin:0 0 .875rem}
  .kicker .sec{color:var(--ink-3)}
  h1{font-family:var(--serif);font-weight:400;font-size:clamp(1.75rem,4.4vw,2.75rem);
    line-height:1.15;letter-spacing:-.008em;margin:0 0 1.25rem;text-wrap:balance}
  .authors{font-size:1.0625rem;margin:0 0 .375rem}
  .affil{font-size:.875rem;color:var(--ink-2);margin:0 0 1.75rem}

  .meta{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;font-family:var(--mono);
    font-size:.6875rem;letter-spacing:.04em;color:var(--ink-3);
    padding:.875rem 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);
    margin:0 0 2.5rem}
  .meta b{color:var(--ink);font-weight:600}
  .pdf-btn{font:inherit;font-family:var(--sans);font-size:.6875rem;font-weight:600;
    text-decoration:none;display:inline-block;
    letter-spacing:.04em;margin-left:auto;cursor:pointer;color:var(--ink);
    background:transparent;border:1px solid var(--rule);border-radius:2px;
    padding:.3125rem .75rem}
  .pdf-btn:hover{border-color:var(--issue);color:var(--issue-ink)}

  h2{font-family:var(--serif);font-weight:400;font-size:1.5rem;margin:2.75rem 0 .875rem}
  h3{font-size:1rem;font-weight:600;margin:1.75rem 0 .5rem}
  h4{font-family:var(--mono);font-size:.6875rem;letter-spacing:.09em;
    text-transform:uppercase;color:var(--ink-3);margin:1.25rem 0 .375rem}
  p{margin:0 0 1rem;max-width:68ch}
  .abstract{font-size:1.0625rem}

  .facts{border:1px solid var(--rule);border-radius:3px;background:var(--surface);
    padding:1.25rem 1.5rem;margin:2rem 0}
  .facts dl{display:grid;grid-template-columns:minmax(0,11rem) 1fr;gap:.625rem 1.25rem;margin:0}
  .facts dt{font-family:var(--mono);font-size:.6875rem;letter-spacing:.06em;
    text-transform:uppercase;color:var(--ink-3)}
  .facts dd{margin:0;font-size:.9375rem}
  @media (max-width:34rem){.facts dl{grid-template-columns:1fr;gap:.25rem}
    .facts dd{margin-bottom:.75rem}}

  .record{margin-top:3.5rem;padding-top:2rem;border-top:3px solid var(--issue)}
  .record>p.why{color:var(--ink-2);font-size:.9375rem;max-width:60ch}
  .rev,.dec{border:1px solid var(--rule);border-radius:3px;background:var(--surface);
    padding:1.5rem;margin:1.25rem 0}
  .dec{border-left:3px solid var(--issue)}
  .rev h3,.dec h3{margin-top:0}
  .rec{font-family:var(--mono);font-size:.75rem;color:var(--ink-2)}
  ul.scores{list-style:none;display:flex;flex-wrap:wrap;gap:.5rem;padding:0;margin:.75rem 0 1rem}
  ul.scores li{border:1px solid var(--rule);border-radius:2px;padding:.375rem .75rem;
    font-family:var(--mono);font-size:.75rem;display:flex;gap:.5rem;align-items:baseline}
  ul.scores span{color:var(--ink-3)}
  ul.scores b{color:var(--ink)}
  ul.scores i{font-style:normal;color:var(--ink-3)}
  .signed{font-family:var(--mono);font-size:.75rem;color:var(--ink-3);margin:0}

  .cite{background:var(--rule-2);border:1px solid var(--rule);border-radius:3px;
    padding:1rem 1.25rem;font-family:var(--mono);font-size:.8125rem;line-height:1.6;
    overflow-wrap:anywhere;margin:.75rem 0 0}

  /* ===================== PRINT / PDF =====================
     Also what Puppeteer renders, so this is the PDF's typography, not a
     degraded copy of the screen design. Measurements are in pt and mm
     because that is what a page is actually made of. */
  @page { size: A4; margin: 22mm 20mm 20mm; }

  @media print {
    :root {
      --paper:#fff; --surface:#fff; --ink:#000; --ink-2:#333; --ink-3:#555;
      --rule:#bbb; --rule-2:#e6e6e6; --issue:#A3132E; --issue-ink:#A3132E;
    }
    body { background:#fff; font-family:var(--serif); font-size:10.5pt; line-height:1.5; }
    .bar, .back, .noprint { display:none !important; }
    main { max-width:none; padding:0; margin:0; }

    .print-head { display:block !important; }

    h1 { font-size:19pt; line-height:1.18; margin:0 0 10pt; }
    h2 { font-size:12.5pt; margin:16pt 0 5pt; break-after:avoid; }
    h3 { font-size:10.5pt; margin:10pt 0 3pt; break-after:avoid; }
    h4 { font-size:7.5pt; margin:8pt 0 2pt; break-after:avoid; }
    p  { margin:0 0 7pt; max-width:none; orphans:3; widows:3; }
    .authors { font-size:11pt; margin-bottom:2pt; }
    .affil { font-size:9pt; margin-bottom:10pt; }
    .kicker { font-size:7.5pt; margin-bottom:6pt; }
    .abstract { font-size:10.5pt; }

    .meta { font-size:7.5pt; padding:5pt 0; margin-bottom:14pt; gap:4pt 14pt; }

    /* A referee report split across a page break is unreadable; keep each
       whole where it fits on one page. */
    .facts, .rev, .dec, .cite { break-inside:avoid; }
    .record { break-before:page; border-top:none; padding-top:0; margin-top:0; }
    .record > h2 { margin-top:0; }
    .rev, .dec, .facts, .cite { border:1px solid #ccc; padding:9pt 11pt; margin:8pt 0; }
    .dec { border-left:2.5pt solid var(--issue); }
    ul.scores li { border-color:#ccc; font-size:8pt; padding:2pt 5pt; }
    .facts dl { gap:3pt 10pt; }
    .facts dt, .facts dd { font-size:9pt; }

    footer { border-top:1px solid #ccc; padding:8pt 0 0; margin-top:14pt; font-size:8pt; }
    a { color:#000; text-decoration:none; }
  }

  /* Masthead block that exists only on paper: a printed page has to say what
     journal it came from, because it travels without the site around it. */
  .print-head { display:none; border-bottom:1.5pt solid var(--issue);
    padding-bottom:6pt; margin-bottom:14pt; }
  .print-head .j { font-family:var(--serif); font-size:13pt; letter-spacing:.14em; }
  .print-head .d { font-family:var(--mono); font-size:7.5pt; color:#444; float:right;
    padding-top:4pt; }

  footer{max-width:52rem;margin:0 auto;padding:2rem 1.25rem 4rem;border-top:1px solid var(--rule);
    font-size:.8125rem;color:var(--ink-3)}
</style>
</head>
<body>

<div class="bar"><div class="bar-in">
  <a class="mark" href="../">PRISM</a>
  <a class="back" href="../#issues">&larr; All articles</a>
</div></div>

<main>
  <div class="print-head">
    <span class="d">${esc(a.ms_number)} · ${human(a.updated_at)} · CC BY 4.0</span>
    <span class="j">PRISM</span>
  </div>

  <p class="kicker">${esc(TYPES[a.article_type] || a.article_type)}
    <span class="sec">· ${esc(SECTIONS[a.section] || a.section)}</span></p>

  <h1>${esc(a.title)}</h1>

  <p class="authors"><b>${esc(a.author_name)}</b>${
    a.coauthors ? ", " + esc(String(a.coauthors).split("\n").map((l) => l.split(",")[0].trim())
      .filter(Boolean).join(", ")) : ""}</p>
  <p class="affil">${esc([a.author_school, a.author_country].filter(Boolean).join(" · "))}</p>

  <div class="meta">
    <span><b>${esc(a.ms_number)}</b></span>
    <span>Published <b>${human(a.updated_at)}</b></span>
    <span>Licence <b>CC BY 4.0</b></span>
    <span>Peer review <b>published below</b></span>
    <a class="pdf-btn noprint" href="${esc(a.ms_number)}.pdf" download>Download PDF</a>
  </div>

  <h2>Abstract</h2>
  <div class="abstract">${para(a.abstract)}</div>

  ${a.limitations ? `<h2>Limitations</h2>${para(a.limitations)}` : ""}

  <div class="facts">
    <dl>
      <dt>Data</dt><dd>${a.data_doi ? esc(a.data_doi) : "—"}</dd>
      <dt>Code</dt><dd>${a.code_doi ? esc(a.code_doi) : "—"}</dd>
      <dt>Ethics</dt><dd>${a.ethics_ref ? esc(a.ethics_ref) : "Not applicable"}</dd>
      <dt>AI tools</dt><dd>${a.ai_disclosure ? esc(a.ai_disclosure) : "None declared"}</dd>
      <dt>Mentor contribution</dt><dd>${esc(a.mentor_statement)}</dd>
    </dl>
  </div>

  <section class="record">
    <h2>Peer review record</h2>
    <p class="why">PRISM publishes the evidence behind every acceptance. Below are the
      referee reports as written and the editor's signed decision. A reader who can see
      what the referees objected to, and how the authors answered, can judge this paper
      for themselves rather than taking our word for it.</p>

    ${decisions.map((d) => `<div class="dec">
      <h3>Editor's decision — ${esc(RECS[d.decision] || d.decision)}</h3>
      ${para(d.letter)}
      <p class="signed">Signed ${esc(d.signed_name)} · ${human(d.created_at)}</p>
    </div>`).join("")}

    ${reviews.length ? reviews.map((r, i) => reviewBlock(r, i + 1)).join("")
      : `<p class="why">No referee reports are attached to this record.</p>`}
  </section>

  <h2>How to cite</h2>
  <p class="cite">${esc(cite)}</p>
</main>

<footer>
  <p>© ${new Date(a.updated_at).getFullYear()} the authors. Published by ${JOURNAL} under a
  <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> licence: you may reuse
  this work for any purpose provided you credit the authors.</p>
</footer>

</body>
</html>
`;
}


/* --------------------------------------------------- homepage article list */
// Written between markers in index.html rather than fetched in the browser:
// the homepage is the page crawlers hit first, and a list that only exists
// after JavaScript runs is a list search engines never see.
function homepageList(articles) {
  return articles.map((a) => {
    const names = [a.author_name, ...String(a.coauthors || "").split("\n")
      .map((x) => x.split(",")[0].trim()).filter(Boolean)].join(", ");
    const href = `articles/${a.ms_number}.html`;
    return `        <li>
          <p class="paper-kicker">${esc(TYPES[a.article_type] || a.article_type)}
            <span class="sec">· ${esc(SECTIONS[a.section] || a.section)}</span></p>
          <h3 class="paper-title"><a href="${href}">${esc(a.title)}</a></h3>
          <p class="paper-authors">${esc(names)}${a.author_school ? " · " + esc(a.author_school) : ""}</p>
          <p class="paper-abs">${esc(a.abstract)}</p>
          <p class="paper-links">
            <a href="${href}">Read</a>
            <a href="articles/${a.ms_number}.pdf" download>PDF</a>
            <span class="rr">${esc(a.ms_number)} · ${human(a.updated_at)} · CC BY 4.0</span>
          </p>
        </li>`;
  }).join("\n");
}

function writeHomepage(articles) {
  const file = join(ROOT, "index.html");
  let html = readFileSync(file, "utf8");
  const body = articles.length
    ? `      <ol class="papers">\n${homepageList(articles)}\n      </ol>`
    : null;
  if (!body) { console.log("  homepage: no articles, empty state left in place"); return; }

  html = html.replace(/(<!--ARTICLES:START-->)[\s\S]*?(<!--ARTICLES:END-->)/,
    `$1\n${body}\n      $2`);
  html = html.replace(/(<!--ARTICLES:COUNT-->)[\s\S]*?(<!--\/ARTICLES:COUNT-->)/,
    `$1${articles.length} article${articles.length === 1 ? "" : "s"}$2`);
  writeFileSync(file, html);
  console.log(`  homepage: ${articles.length} article(s) listed`);
}

/* ------------------------------------------------------------------- run */
const SAMPLE = process.argv.includes("--sample");

if (SAMPLE) {
  const a = {
    id: "sample", ms_number: "PRISM-2026-0001",
    title: "Urban tree canopy predicts summer surface temperature better than building density in three mid-sized cities",
    abstract: "Cities are hotter than the countryside around them, and the usual explanation is that buildings store heat. Whether tree cover or building density matters more at neighbourhood scale is less settled.\n\nWe paired Landsat 8 surface temperature with municipal tree inventories and building footprints for three cities, dividing each into 500 m cells. Canopy cover explained more variance in summer surface temperature than building density in all three.\n\nThe association is cross-sectional and cannot establish that planting trees would cool a given block.",
    section: "earth_environment", article_type: "research_article",
    coauthors: "Wei Zhang, Northside High School\nPriya Nair, Northside High School",
    mentor_statement: "Dr Elena Farrow (Geography, City University) suggested Landsat 8 rather than MODIS and checked our atmospheric correction. She did not select the cities, run the regressions or write any part of the manuscript.",
    data_doi: "10.5281/zenodo.10998877", code_doi: "10.5281/zenodo.10998878",
    ethics_ref: "Not applicable — no human or animal subjects.",
    ai_disclosure: "ChatGPT was used to check grammar in the discussion. No text, analysis or figure was generated by it.",
    limitations: "Three cities in one climate zone cannot support a general claim. Surface temperature is not air temperature, and the two diverge over dry surfaces. Cells were drawn on a fixed grid rather than by neighbourhood boundaries, so the unit of analysis is arbitrary.",
    updated_at: new Date("2026-08-06").toISOString(),
    author_name: "Amara Okonkwo", author_school: "Northside High School", author_country: "Canada",
  };
  const reviews = [
    { id: "r1", sound: 4, honest: 5, checkable: 5, legible: 4, recommendation: "minor_revision",
      signed: true, reviewer_name: "Jake Lindqvist", submitted_at: a.updated_at,
      summary: "A careful piece of work that does what it says. The authors ask whether canopy or built density better predicts surface temperature, and they answer it with a defensible design and data anyone can re-run.",
      major_points: "The regression treats the 500 m cells as independent, but neighbouring cells are plainly correlated. A spatial error term would change the confidence intervals, probably widening them. I do not think it changes the direction of the result, but the paper should say so.",
      minor_points: "Figure 2 has no colour-blind-safe palette. The Landsat scene dates should be in the methods, not the supplement." },
    { id: "r2", sound: 4, honest: 4, checkable: 5, legible: 5, recommendation: "minor_revision",
      signed: false, reviewer_name: null, submitted_at: a.updated_at,
      summary: "The deposited data and code let me reproduce all three regressions in about twenty minutes, which is more than I can say for most manuscripts I review. The claim is appropriately narrow.",
      major_points: "Surface temperature and air temperature are used almost interchangeably in the discussion. They are not the same quantity and the difference matters for the cooling argument.",
      minor_points: "" },
  ];
  const decisions = [{ id: "d1", decision: "accept", signed_name: "Dr Elena Farrow",
    created_at: a.updated_at,
    letter: "Both referees judge the work sound and reproducible, and both ask for the same two clarifications. I agree with them.\n\nBinding: address the spatial autocorrelation point explicitly, and separate surface temperature from air temperature wherever the discussion slides between them. Neither requires new analysis.\n\nOptional: the figure palette and the scene dates.\n\nI am accepting on the strength of the deposited data. Referee 2 reproduced your regressions from it, which is the standard this journal is trying to hold." }];

  writeFileSync(join(ROOT, "preview-article.html"), page(a, reviews, decisions));
  console.log("preview-article.html written (fixture — not published)");
} else {
  let articles;
  try {
    articles = await api("published_articles?select=*&order=updated_at.desc");
  } catch (err) {
    if (/PGRST205|schema cache/.test(err.message)) {
      console.error("The published_articles view does not exist yet.\n" +
        "Run supabase/schema.sql in the Supabase SQL editor, then try again.");
      process.exit(1);
    }
    throw err;
  }
  if (!articles.length) {
    console.log("No accepted articles yet — nothing to generate.");
    process.exit(0);
  }
  const [reviews, decisions] = await Promise.all([
    api("published_reviews?select=*"), api("published_decisions?select=*"),
  ]);
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  for (const a of articles) {
    writeFileSync(join(OUT, `${a.ms_number}.html`),
      page(a, reviews.filter((r) => r.manuscript_id === a.id),
              decisions.filter((d) => d.manuscript_id === a.id)));
  }
  writeFileSync(join(ROOT, "sitemap.txt"),
    [`${SITE}/`, ...articles.map((a) => `${SITE}/articles/${a.ms_number}.html`)].join("\n"));
  writeHomepage(articles);
  console.log(`${articles.length} article page(s) written to articles/`);
  console.log(readdirSync(OUT).map((f) => "  " + f).join("\n"));
}
