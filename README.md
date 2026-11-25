# simplA11yGenReport

Generate French HTML and PDF accessibility reports from completed Observatory
JSON audits.

Supports **RAWeb 1.1 simplified Web audits with 1–3 pages**.
Excel, RAAM and complete audits are not supported.

## Requirements

- Node.js 22 or newer, including npm
- Bash — use Git Bash on Windows

The start scripts prepare dependencies and tests when needed.
Chromium is required only for PDF generation and is prepared automatically.

## Input

Place audit JSON files in `in/`.

Create `data/accessibility-statements.json` with one entry per audited domain:

```json
{
  "example.lu": {
    "available": true,
    "conform": true,
    "missing": ""
  }
}
```

Use the actual results of your accessibility declaration check:
`available` indicates whether it exists, `conform` whether it is complete,
and `missing` describes missing information.

Optional document statistics can be supplied in `data/office-files.json`.

Each page must include all 53 simplified-profile criteria.
Complete all `NT` assessments, document non-exempt `NC` findings and justify
exemptions. Criteria `8.1` and `8.2` must be `C`.

Optional `pages[].title` values are preserved exactly.
Missing, empty or unknown titles are derived locally from the URL.

## Usage

```bash
# Generate HTML and PDF for all audits in in/
bash genAll.sh

# Validate inputs and templates without generating reports
bash genAll.sh --check-only

# Generate HTML only
bash genAll.sh --html-only

# Process one audit
bash run.sh "in/audit.json"
bash run.sh --html-only "in/audit.json"
```

Reports are saved in `out/`. Existing reports with the same names are replaced.

All selected audits are checked. Any input or template validation error blocks
generation for the entire selection. Details are printed in the console and
written to `out/error.log`, which is replaced on each preflight check.

## Custom templates

The default template in `tpl/` is neutral. To use TemplateReportSIP or another
template, set its folder path in the current terminal:

```bash
export TPL_PATH="../TemplateReportSIP"
bash genAll.sh
```

The folder must contain `main.ejs`, `intro.ejs`, `topic.ejs`, `styles.css`,
`custom.css`, `print.css` and any included assets.

Return to the default template:

```bash
unset TPL_PATH
```

## Tests

```bash
npm test
npm run checklinks
```

Check the final PDF layout with your installed browser and fonts.

## License

MIT — Information and Press Service, Luxembourg government.