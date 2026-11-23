# simplA11yGenReport

Generate French HTML and PDF reports from completed Observatory JSON audits.

Workflow: ASCA → Observatory JSON → GenReport.

This generator supports RAWeb 1.1 simplified Web audits with one to three pages.
It does not accept Excel, complete audits or RAAM audits.

## Requirements and startup

Node.js 22 or newer, including npm, and Bash are required.
On Windows, use Git Bash.

```bash
bash genAll.sh
bash genAll.sh --check-only
bash genAll.sh --html-only
bash run.sh "in/audit.json"
bash run.sh --html-only "in/audit.json"
```

Both entry scripts create the input/data/output directories and set script
permissions.

The shared setup.js installs dependencies on first use or after package or
Node.js changes, and reruns tests after project changes. Unchanged starts reuse
the successful setup. Only lightweight fingerprints and file-existence checks
run; Chromium is not launched just to check an already validated installation.

Chromium is prepared only for PDF generation. Browser and dependency downloads
require internet access. On Linux, missing browser system libraries may require:

```bash
npx playwright install --with-deps chromium
```

Preparation state is stored in node_modules/.genreport-setup.json.
Delete that file to force preparation again.

`npm test` remains available for an explicit test run.
GENREPORT_TEST_RUN=1 is reserved for integration tests, which must not reinstall
shared dependencies or run nested tests.

## Input files

Put completed Observatory JSON files in in/.

Each page must contain the 53 simplified-profile criteria. Missing criteria,
duplicates, NT statuses, invalid URLs, missing findings for non-exempt NC
assessments and missing exemption justifications block generation.

Criteria 8.1 and 8.2 must be C.

Required: data/accessibility-statements.json, keyed by site domain:

```json
{
  "example.lu": {
    "available": true,
    "conform": true,
    "missing": ""
  }
}
```

These values describe the accessibility declaration, not the site's
accessibility score. Supply the actual results of your declaration check.

A missing entry is an error; it is not interpreted as an absent declaration.
Exact domains are matched first, then variants with or without www.
Other subdomains remain distinct. One shared file may contain all sites.

Optional: data/office-files.json, keyed by domain, containing the existing
crawler fields files, pdf-exempt, pcent-pdf, pcent-form and
pcent-pdf-blocking-pb-access.

Missing site data omits the document section.

UTF-8 JSON with a Windows byte order mark is accepted.
Input paths with spaces and run.sh invocations from another directory are
supported.

## Optional page titles

The official pages[].title field is optional.
When present, it must be a string. Null, numbers, booleans, arrays and objects
are rejected.

```json
{
  "number": 1,
  "uri": "https://example.lu/",
  "title": "Page d’accueil - Exemple",
  "assessments": []
}
```

This snippet illustrates a page record, not a completed audit.

A nonempty title is preserved character for character as the report link label,
including case, punctuation and whitespace. HTML characters are escaped in
HTML/PDF markup. The uri remains the link destination.

If the title is absent, empty, whitespace-only or a placeholder, the generator
derives a readable label locally from the final URL path segment.

Recognized placeholders, ignoring case:

- Inconnu
- Inconnue
- Unknown
- Non renseigné
- Non renseignée
- Non fourni
- Sans titre

Root URLs use “Page d’accueil”; an unreadable path uses “Page N”.
No website request is made to obtain a title.

The nonstandard page properties name and label are not used as title aliases.

The old data/page-titles.json override file, out/page-titles.json cache and
online title retrieval have been removed. Old copies of those files are
ignored and can be deleted when updating. They are never used to replace a
title in the audit.

## Preflight and diagnostic log

Every invocation validates the selected audit or the entire batch before
report generation.

A bad JSON file does not prevent checking the other files.
Any invalid input blocks report generation for the entire selected batch.
Duplicate output names are also rejected.

The console lists audit filenames, domains, declaration keys and results.
Details retain source paths and zero-based JSON indexes.

out/error.log is replaced on every preflight, including --check-only.
It lists the complete batch, shared input errors, per-audit errors grouped by
page and criterion, and non-blocking warnings.

Template/render errors and PDF failures are also recorded.
Successful checks replace stale errors.

Setup/install failures happen before preflight and remain in the console.

--check-only validates data and renders templates in memory.
It writes only diagnostics.

All selected templates must render before reports are written.
Existing reports from earlier runs remain untouched when preflight fails.
PDF or filesystem failures can still leave partial output after successful
preflight.

Reports are written to out/rapport-HOST.html and .pdf.
Leading www. and trailing .lu are removed from output names.
Existing outputs with those names are replaced.

## Scoring and findings

Consolidate each criterion across pages using priority NC, C, NT, NA.
Calculate C / (C + NC), then apply scoring.json.

Exemptions do not change consolidation.
All non-exempt NC findings appear in the report, including criteria without a
predefined recommendation.

The template uses French dates, lowercase qualitative labels and
“Exemples de problèmes détectés sur la page…” headings.

JSON assessment comments are preserved, not rewritten.
Differences in findings may legitimately change report length.

## Neutral and SIP templates

The bundled tpl/ template is neutral.

To use the separately supplied TemplateReportSIP project:

```bash
export TPL_PATH="C:/Users/VUJ787/Projects/a11y/TemplateReportSIP"
./genAll.sh
```

Replace the example path with the actual location of your template folder.

The variable applies to the current terminal.
The selected template path is printed.

To return to the neutral template:

```bash
unset TPL_PATH
```

A template directory must supply:

- main.ejs
- intro.ejs
- topic.ejs
- styles.css
- custom.css
- print.css
- Every included file, such as logo.ejs

EJS executes JavaScript: use trusted templates only.

HTML and PDF share page labels, findings and the main presentation.

The repeated PDF header and footer are provided by optional template elements
with the identifiers pdf-header and pdf-footer in main.ejs.

Their styles must be inline and images embedded.
The template must reserve sufficient @page margins.

Do not mix these elements with old Paged.js running()/element() margin boxes
or CSS-generated footers, which may duplicate content.

The SIP template preserves its Base64 logo and uses a single three-column
footer. The neutral template has no SIP logo or publication attribution.

## Verification

```bash
npm test
npm run checklinks
```

Tests cover input validation, batch blocking, external templates, all findings,
optional title types, exact title preservation, local fallback and ignoring
obsolete sidecars.

checklinks checks generated report links and may use the network.

The final visual PDF layout must be checked with the installed target browser
and fonts. PDF tagging is requested, but a generated PDF is not automatically
certified accessible.

## Source layout

index.js handles validation, page labels, preflight logging, templates and HTML.

pdf.js prints using Playwright Chromium.

setup.js manages incremental preparation shared by run.sh and genAll.sh.

Schema, criterion profile, scoring, topics and recommendations remain JSON
data files.

## License

MIT, Information and Press Service, Luxembourg government.