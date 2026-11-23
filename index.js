// Shared, exhaustive input validation. Paths use zero-based JSON array indexes.
const fs = require('fs')
const path = require('path')
const Ajv = require('ajv/dist/2020')
const ajv = new Ajv({allErrors: true})

require('ajv-formats')(ajv)

const schemaCheck = ajv.compile(require('./schema-observatoire.json'))
const criteria = require('./profile-raweb-1.1-simplified.json').criteria

const object = value =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const nonempty = value =>
    typeof value === 'string' && value.trim().length > 0

function jsonPath(pointer) {
    return pointer.split('/').slice(1).map(part => {
        part = part.replace(/~1/g, '/').replace(/~0/g, '~')

        return /^\d+$/.test(part)
            ? `[${part}]`
            : /^[a-zA-Z_]\w*$/.test(part)
                ? `.${part}`
                : `[${JSON.stringify(part)}]`
    }).join('').replace(/^\./, '') || '$'
}

function loadJson(file) {
    try {
        return {
            value: JSON.parse(
                fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
            ),
            errors: []
        }
    } catch (error) {
        return {
            value: null,
            errors: [{
                file,
                path: '$',
                message: error.code === 'ENOENT'
                    ? 'File not found; supply this JSON file.'
                    : 'Cannot read JSON: ' + error.message
            }]
        }
    }
}

function validateAudit(audit, file) {
    const errors = []
    const add = (path, message) => errors.push({file, path, message})

    if (!schemaCheck(audit)) {
        for (const error of schemaCheck.errors) {
            let pointer = error.instancePath

            if (error.keyword === 'required') {
                pointer += '/' + error.params.missingProperty
            }

            const errorPath = jsonPath(pointer)

            const value = pointer.split('/').slice(1).reduce(
                (v, k) => v?.[k.replace(/~1/g, '/').replace(/~0/g, '~')],
                audit
            )

            const expected = error.keyword === 'type'
                ? `Expected ${error.params.type}; received ${JSON.stringify(value)}.`
                : error.keyword === 'required'
                    ? 'Required field is missing.'
                    : `${error.message}${error.keyword === 'enum'
                        ? '; allowed: ' + error.params.allowedValues.join(', ')
                        : ''}.`

            add(errorPath, expected)
        }
    }

    if (!object(audit)) return errors

    if (
        audit.audit_reference?.name !== 'RAWeb' ||
        audit.audit_reference?.version !== '1.1' ||
        audit.control_type?.name !== 'Simplifié'
    ) {
        add(
            'audit_reference / control_type',
            `Unsupported audit: ${audit.audit_reference?.name || '?'} ${audit.audit_reference?.version || '?'} / ${audit.control_type?.name || '?'}. Expected RAWeb 1.1 / Simplifié.`
        )
    }

    for (const key of ['auditor', 'context', 'audited_at']) {
        if (typeof audit[key] === 'string' && !nonempty(audit[key])) {
            add(key, 'Required metadata is empty.')
        }
    }

    if (
        typeof audit.inventory?.name === 'string' &&
        !nonempty(audit.inventory.name)
    ) {
        add('inventory.name', 'Site name is empty.')
    }

    if (!Array.isArray(audit.pages)) return errors

    if (audit.pages.length < 1 || audit.pages.length > 3) {
        add(
            'pages',
            `Received ${audit.pages.length} pages; expected 1 to 3. No pages will be removed automatically.`
        )
    }

    const numbers = new Set()
    const urls = new Set()

    audit.pages.forEach((page, i) => {
        const base = `pages[${i}]`
        const label = `P${String(page?.number ?? '?').padStart(2, '0')}`

        if (!object(page)) return

        if (numbers.has(page.number)) {
            add(
                base + '.number',
                `${label}: duplicate page number ${page.number}.`
            )
        }

        numbers.add(page.number)

        try {
            const url = new URL(page.uri)

            if (!['http:', 'https:'].includes(url.protocol)) throw Error()

            if (urls.has(url.href)) {
                add(base + '.uri', `${label}: duplicate URL ${url.href}.`)
            }

            urls.add(url.href)
        } catch {
            add(
                base + '.uri',
                `${label}: valid HTTP(S) URL required; received ${JSON.stringify(page.uri)}.`
            )
        }

        if (!Array.isArray(page.assessments)) return

        const seen = new Set()

        page.assessments.forEach((answer, j) => {
            if (!object(answer)) return

            const number = answer.criterion?.number
            const status = answer.status?.name
            const answerPath = `${base}.assessments[${j}]`
            const where = `${label} / criterion ${number ?? '?'}`

            if (number !== undefined) {
                if (!criteria.includes(number)) {
                    add(
                        answerPath + '.criterion.number',
                        `${where}: criterion is outside the simplified profile.`
                    )
                }

                if (seen.has(number)) {
                    add(
                        answerPath + '.criterion.number',
                        `${where}: duplicate criterion.`
                    )
                }

                seen.add(number)
            }

            if (status === 'NT') {
                add(
                    answerPath + '.status.name',
                    `${where}: NT, finish this control.`
                )
            }

            if (['8.1', '8.2'].includes(number) && status !== 'C') {
                add(
                    answerPath + '.status.name',
                    `${where}: deprecated criterion must be C.`
                )
            }

            if (
                answer.exemption === true &&
                !nonempty(answer.exemption_comment)
            ) {
                add(
                    answerPath + '.exemption_comment',
                    `${where}: exemption justification is empty or invalid.`
                )
            }

            if (
                status === 'NC' &&
                answer.exemption === false &&
                !nonempty(answer.changes_to_do)
            ) {
                add(
                    answerPath + '.changes_to_do',
                    `${where}: NC without a finding; enter the problem and required change.`
                )
            }
        })

        for (const number of criteria) {
            if (!seen.has(number)) {
                add(
                    base + '.assessments',
                    `${label}: criterion ${number} is missing.`
                )
            }
        }
    })

    return errors
}

function findSite(uri, entries) {
    const host = new URL(uri).hostname.toLowerCase().replace(/\.$/, '')

    if (Object.hasOwn(entries, host)) return host

    const alternate = host.startsWith('www.')
        ? host.slice(4)
        : 'www.' + host

    return Object.hasOwn(entries, alternate) ? alternate : undefined
}

function validateStatement(entry, file, key) {
    const base = `[${JSON.stringify(key)}]`
    const errors = []

    if (!object(entry)) {
        return [{
            file,
            path: base,
            message: `Expected a declaration object; received ${JSON.stringify(entry)}.`
        }]
    }

    for (const [field, type] of [
        ['available', 'boolean'],
        ['conform', 'boolean'],
        ['missing', 'string']
    ]) {
        if (!Object.hasOwn(entry, field)) {
            errors.push({
                file,
                path: base + '.' + field,
                message: `Missing field; expected ${type}.`
            })
        } else if (typeof entry[field] !== type) {
            errors.push({
                file,
                path: base + '.' + field,
                message: `Expected ${type}; received ${JSON.stringify(entry[field])}.`
            })
        }
    }

    return errors
}

const scale = require('./scoring.json').qualitativeScale

function readAudit(filename) {
    const audit = JSON.parse(
        fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')
    )

    const errors = validateAudit(audit, filename)

    if (errors.length) {
        throw new Error(
            errors.map(error => `${error.path}: ${error.message}`).join('\n')
        )
    }

    const issues = []
    const statuses = new Map()

    for (const page of audit.pages) {
        for (const answer of page.assessments) {
            const number = answer.criterion.number
            const status = answer.status.name

            if (!statuses.has(number)) statuses.set(number, [])
            statuses.get(number).push(status)

            if (status === 'NC' && !answer.exemption) {
                issues.push({
                    topic: Number(number.split('.')[0]),
                    criteria: number,
                    comment: answer.changes_to_do,
                    page: page.number
                })
            }
        }
    }

    const consolidated = [...statuses.values()].map(values =>
        ['NC', 'C', 'NT', 'NA'].find(status => values.includes(status))
    )

    const c = consolidated.filter(status => status === 'C').length
    const nc = consolidated.filter(status => status === 'NC').length
    const percent = c + nc ? c / (c + nc) * 100 : null

    const score = percent === null
        ? 'Non calculable (aucun critère applicable)'
        : scale.find(item =>
            percent >= item.min &&
            (item.maxExclusive === undefined
                ? percent <= item.maxInclusive
                : percent < item.maxExclusive)
        ).label

    const host = new URL(audit.pages[0].uri).hostname.toLowerCase()
        .replace(/^www\./, '')
        .replace(/\.$/, '')
        .replace(/\.lu$/, '')

    const siteName = host.replace(/[^a-z0-9._-]/g, '-')

    return {
        siteName,
        issues,
        info: {
            site: audit.inventory.name,
            date: audit.audited_at,
            score,
            auditor: audit.auditor,
            pages: audit.pages.map(page => ({
                id: page.number,
                label: pageLabel(page),
                value: page.uri
            }))
        }
    }
}

// Titles recorded in the audit are authoritative.
// No network requests or title sidecar files.
function pageLabel(page) {
    const title = typeof page.title === 'string' ? page.title : ''

    const normalized = title.trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('fr')

    if (
        normalized &&
        !/^(?:inconnue?|unknown|non renseign[ée]|non fourni|sans titre)$/.test(normalized)
    ) {
        return title
    }

    try {
        const url = new URL(page.uri)
        const last = url.pathname.split('/').filter(Boolean).at(-1)

        if (!last) return 'Page d’accueil'

        const label = decodeURIComponent(last)
            .replace(/\.(?:html?|php|aspx?)$/i, '')
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()

        if (label) {
            return label.charAt(0).toLocaleUpperCase('fr') + label.slice(1)
        }
    } catch {}

    return `Page ${page.number}`
}

function resolveTemplate() {
    const directory = path.resolve(
        process.env.TPL_PATH || path.join(__dirname, 'tpl')
    )

    for (const file of [
        'main.ejs',
        'intro.ejs',
        'topic.ejs',
        'styles.css',
        'custom.css',
        'print.css'
    ]) {
        const target = path.join(directory, file)

        try {
            if (!fs.statSync(target).isFile()) throw new Error('not a file')
            fs.accessSync(target, fs.constants.R_OK)
        } catch {
            throw new Error(
                `Modèle invalide : fichier absent ou illisible : ${target}`
            )
        }
    }

    return directory
}

function checkBatch(files, statementFile = 'data/accessibility-statements.json') {
    const source = loadJson(statementFile)
    const globalErrors = [...source.errors]
    const used = new Set()

    let statements = source.value

    if (
        !source.errors.length &&
        (!object(statements) || typeof statements.available === 'boolean')
    ) {
        globalErrors.push({
            file: statementFile,
            path: '$',
            message: 'Expected an object keyed by domain, e.g. {"bech.lu":{"available":true,"conform":true,"missing":""}}.'
        })
    }

    if (globalErrors.length) statements = {}

    const statementErrors = new Map()

    for (const [key, value] of Object.entries(statements || {})) {
        statementErrors.set(key, validateStatement(value, statementFile, key))
    }

    const docsFile = path.join(path.dirname(statementFile), 'office-files.json')
    let docs = {}

    if (fs.existsSync(docsFile)) {
        const loaded = loadJson(docsFile)
        globalErrors.push(...loaded.errors)

        if (!loaded.errors.length) {
            if (!object(loaded.value)) {
                globalErrors.push({
                    file: docsFile,
                    path: '$',
                    message: 'Expected crawler data keyed by domain.'
                })
            } else {
                docs = loaded.value
            }
        }
    }

    const outputs = new Map()

    const rows = files.map(file => {
        const loaded = loadJson(file)
        const errors = [...loaded.errors]
        const audit = loaded.value

        if (!loaded.errors.length) {
            errors.push(...validateAudit(audit, file))
        }

        let domain = ''
        let key

        try {
            const url = new URL(audit?.pages?.[0]?.uri)
            domain = url.hostname.toLowerCase()

            if (!['http:', 'https:'].includes(url.protocol)) {
                domain = ''
            }
        } catch {}

        if (domain && !globalErrors.length) {
            key = findSite(audit.pages[0].uri, statements)

            if (key) {
                used.add(key)
                errors.push(...statementErrors.get(key))
            } else {
                errors.push({
                    file: statementFile,
                    path: `[${JSON.stringify(domain)}]`,
                    message: `No matching entry for ${domain}, with or without www.`
                })
            }
        }

        if (domain) {
            const output = domain
                .replace(/^www\./, '')
                .replace(/\.$/, '')
                .replace(/\.lu$/, '')
                .replace(/[^a-z0-9._-]/g, '-')

            if (outputs.has(output)) {
                errors.push({
                    file,
                    path: 'pages[0].uri',
                    message: `Output name conflicts with ${outputs.get(output)}: rapport-${output}. Choose one audit per site.`
                })
            }

            outputs.set(output, file)

            const docsKey = findSite(audit.pages[0].uri, docs)

            if (docsKey) {
                for (const field of [
                    'files',
                    'pdf-exempt',
                    'pcent-pdf',
                    'pcent-form',
                    'pcent-pdf-blocking-pb-access'
                ]) {
                    const value = docs[docsKey]?.[field]

                    if (
                        typeof value !== 'number' ||
                        !Number.isFinite(value) ||
                        value < 0 ||
                        (field.startsWith('pcent-') && value > 100)
                    ) {
                        errors.push({
                            file: docsFile,
                            path: `[${JSON.stringify(docsKey)}][${JSON.stringify(field)}]`,
                            message: `Expected a nonnegative number${field.startsWith('pcent-') ? ' between 0 and 100' : ''}; received ${JSON.stringify(value)}.`
                        })
                    }
                }
            }
        }

        const status = globalErrors.length
            ? 'STATEMENTS FILE INVALID'
            : !loaded.errors.length && domain && !key
                ? 'MATCH NOT FOUND'
                : key && statementErrors.get(key).length
                    ? 'STATEMENT INVALID'
                    : errors.length
                        ? 'AUDIT INVALID / INCOMPLETE'
                        : key === domain
                            ? 'OK'
                            : 'OK (www variant)'

        return {file, domain, key, status, errors}
    })

    // Unused entries do not block, but malformed data is still reported.
    const unused = [...statementErrors]
        .filter(([key]) => !used.has(key))
        .map(([key, errors]) => ({key, errors}))

    const failed = rows.filter(row =>
        row.errors.length || globalErrors.length
    ).length

    return {
        rows,
        globalErrors,
        unused,
        valid: failed === 0 && globalErrors.length === 0,
        failed
    }
}

function printBatch(result) {
    console.log(
        '\nAudit / statement preflight (JSON array indexes start at zero)\n'
    )

    const rows = [...result.rows].sort((a, b) =>
        Number(Boolean(b.errors.length)) -
        Number(Boolean(a.errors.length)) ||
        a.file.localeCompare(b.file)
    )

    const headers = [
        'Audit file',
        'Observatory domain',
        'Statement key',
        'Result'
    ]

    const values = rows.map(row => [
        path.basename(row.file),
        row.domain || '—',
        row.key || '—',
        row.status
    ])

    const widths = headers.map((header, i) =>
        Math.max(header.length, ...values.map(value => value[i].length))
    )

    console.log(
        headers.map((header, i) => header.padEnd(widths[i])).join(' | ')
    )

    console.log(widths.map(width => '-'.repeat(width)).join('-+-'))

    for (const value of values) {
        console.log(
            value.map((item, i) => item.padEnd(widths[i])).join(' | ')
        )
    }

    for (const error of result.globalErrors) {
        console.log(`\n${error.file}\n  ${error.path}: ${error.message}`)
    }

    for (const row of rows) {
        if (row.errors.length) {
            console.log('\n' + row.file)

            for (const error of row.errors) {
                console.log(
                    `  ${error.file} :: ${error.path}: ${error.message}`
                )
            }
        }
    }

    if (result.unused.length) {
        console.log('\nUnused statement entries (non-blocking):')

        for (const item of result.unused) {
            console.log('  ' + item.key)

            for (const error of item.errors) {
                console.log(
                    `    ${error.file} :: ${error.path}: ${error.message}`
                )
            }
        }
    }

    console.log(
        `\nPreflight: ${rows.length} audits; ready: ${rows.length - result.failed}; blocked: ${result.failed}.`
    )

    console.log(
        result.valid
            ? 'All inputs validated.'
            : 'Generation blocked: no report created by this run.'
    )
}

function writeErrorLog(result, runtimeErrors = []) {
    const lines = [
        'GENREPORT — JOURNAL DE VÉRIFICATION',
        `Date : ${new Date().toISOString()} (UTC)`,
        `Audits analysés : ${result.rows.length} | Valides à la prévalidation : ${result.rows.length - result.failed} | Bloqués : ${result.failed}`,
        `Erreurs : ${result.globalErrors.length + result.rows.reduce((n, row) => n + row.errors.length, 0) + runtimeErrors.length}`,
        'Les indices JSON commencent à 0 ; les libellés P01, P02… indiquent les numéros de page de l’audit.',
        'Le journal est remplacé à chaque vérification. Les anciens rapports ne sont pas supprimés.',
        ''
    ]

    const detail = error => {
        lines.push(
            `    Source : ${error.file}`,
            `    Chemin JSON : ${error.path || '—'}`
        )

        for (const line of String(error.message).split(/\r?\n/)) {
            lines.push(`    Problème : ${line}`)
        }

        lines.push('')
    }

    if (result.globalErrors.length) {
        lines.push(
            'ERREURS COMMUNES AU LOT',
            'Corriger ces fichiers avant de relancer la génération.',
            ''
        )

        result.globalErrors.forEach(detail)
    }

    for (const [i, row] of result.rows.entries()) {
        lines.push(
            `AUDIT ${i + 1}/${result.rows.length} — ${row.file}`,
            `Domaine : ${row.domain || 'indéterminé'} | Déclaration : ${row.key || 'non associée'}`,
            `Résultat : ${row.status} | Erreurs propres à cet audit : ${row.errors.length}`,
            ''
        )

        if (!row.errors.length) {
            lines.push(
                result.globalErrors.length
                    ? '  Aucune erreur propre détectée ; génération bloquée par les erreurs communes.'
                    : '  Aucune erreur détectée à la prévalidation.',
                ''
            )
        }

        const groups = new Map()

        for (const error of row.errors) {
            const page = error.message.match(/\bP\d+\b/)?.[0]
            const criterion = error.message.match(/criterion (\d+\.\d+)/)?.[1]

            const key = page
                ? `${page}${criterion ? ' / Critère ' + criterion : ''}`
                : 'Métadonnées / structure / données associées'

            if (!groups.has(key)) groups.set(key, [])
            groups.get(key).push(error)
        }

        for (const [label, errors] of groups) {
            lines.push(`  ${label}`)
            errors.forEach(detail)
        }
    }

    const warnings = result.unused.filter(item => item.errors.length)

    if (warnings.length) {
        lines.push(
            'AVERTISSEMENTS NON BLOQUANTS — DÉCLARATIONS INUTILISÉES',
            ''
        )

        for (const item of warnings) {
            lines.push(`  Domaine : ${item.key}`)
            item.errors.forEach(detail)
        }
    }

    if (runtimeErrors.length) {
        lines.push('ERREURS DE MODÈLE / GÉNÉRATION', '')
        runtimeErrors.forEach(detail)
    }

    lines.push(
        !result.valid
            ? 'GÉNÉRATION BLOQUÉE : aucun nouveau rapport créé par cette exécution.'
            : runtimeErrors.length
                ? 'ÉCHEC DE GÉNÉRATION : voir les erreurs ci-dessus ; des sorties partielles peuvent exister.'
                : 'Aucune erreur bloquante détectée.',
        ''
    )

    fs.mkdirSync('out', {recursive: true})

    fs.writeFileSync(
        path.join('out', 'error.log'),
        lines.join('\n'),
        'utf8'
    )
}

async function renderReport(filename) {
    const ejs = require('ejs')
    const MarkdownIt = require('markdown-it')
    const {info, issues, siteName} = readAudit(filename)

    let topics = require('./topics.json')

    if (!fs.existsSync('./data/accessibility-statements.json')) {
        throw new Error(
            'Missing data/accessibility-statements.json. Supply one file containing all sites, keyed by domain.'
        )
    }

    const statements = JSON.parse(
        fs.readFileSync('./data/accessibility-statements.json', 'utf8')
            .replace(/^\uFEFF/, '')
    )

    if (
        !statements ||
        Array.isArray(statements) ||
        typeof statements !== 'object' ||
        typeof statements.available === 'boolean'
    ) {
        throw new Error(
            'accessibility-statements.json must be keyed by domain, e.g. {"dlh.lu":{"available":true,"conform":true,"missing":""}}'
        )
    }

    const docs = fs.existsSync('./data/office-files.json')
        ? JSON.parse(
            fs.readFileSync('./data/office-files.json', 'utf8')
                .replace(/^\uFEFF/, '')
        )
        : {}

    const tplPath = resolveTemplate()

    const md = MarkdownIt({
        html: true,
        linkify: true,
        typographer: true,
        quotes: ['«\xA0', '\xA0»', '‹\xA0', '\xA0›']
    }).use(require('markdown-it-attrs'))

    const mdForFindings = MarkdownIt({
        html: false,
        linkify: true
    })

    function cleanupSolutions(solutions) {
        Object.keys(solutions).forEach(topicIdx => {
            solutions[topicIdx].forEach((solution, solutionIdx) => {
                if (typeof solution.desc !== 'string') {
                    solutions[topicIdx][solutionIdx].desc =
                        solution.desc.join('\r\n')
                }
            })
        })

        return solutions
    }

    const solutions = cleanupSolutions(require('./solutions.json'))

    function formatKeys(str) {
        return str.replaceAll('Echap', '<kbd>Echap</kbd>')
            .replaceAll('Entrée', '<kbd>Entrée</kbd>')
            .replaceAll('Espace', '<kbd>Espace</kbd>')
            .replaceAll('barre d’espace', '<kbd>barre d’espace</kbd>')
            .replaceAll('barre d\'espace', '<kbd>barre d’espace</kbd>')
            .replaceAll('Enter', '<kbd>Entrée</kbd>')
            .replaceAll('Space', '<kbd>Espace</kbd>')
            .replaceAll('Escape', '<kbd>Echap</kbd>')
            .replaceAll('escape', '<kbd>Echap</kbd>')
            .replaceAll('Esc', '<kbd>Echap</kbd>')
    }

    const topicsToDisplay = [...new Set(issues.map(issue => issue.topic))]
    topics = topics.filter(topic => topicsToDisplay.includes(topic.num))

    const statementsUrl = findSite(info.pages[0].value, statements)
    const declaration = statements[statementsUrl]

    if (declaration === undefined) {
        throw new Error(
            'Missing declaration data for ' +
            new URL(info.pages[0].value).hostname
        )
    }

    const docsInfosUrl = findSite(info.pages[0].value, docs)
    const docsInfos = docs[docsInfosUrl]

    for (const [field, expectedType] of [
        ['available', 'boolean'],
        ['conform', 'boolean'],
        ['missing', 'string']
    ]) {
        if (typeof declaration[field] !== expectedType) {
            throw new Error(
                `Error: the ${field} property in accessibility-statements.json should be a ${expectedType}, ${typeof declaration[field]} found.`
            )
        }
    }

    if (docsInfos !== undefined) {
        for (const field of [
            'files',
            'pdf-exempt',
            'pcent-pdf',
            'pcent-form',
            'pcent-pdf-blocking-pb-access'
        ]) {
            if (
                typeof docsInfos[field] !== 'number' ||
                !Number.isFinite(docsInfos[field]) ||
                docsInfos[field] < 0 ||
                (field.startsWith('pcent-') && docsInfos[field] > 100)
            ) {
                throw new Error('Invalid office-files.json field: ' + field)
            }
        }
    }

    return {
        siteName,
        html: await ejs.renderFile(path.join(tplPath, 'main.ejs'), {
            topics,
            md,
            mdForFindings,
            info,
            solutions,
            issues,
            declaration,
            docs: docsInfos,
            formatKeys
        })
    }
}

async function main() {
    const args = process.argv.slice(2)
    const flags = new Set(args.filter(arg => arg.startsWith('--')))

    const allowed = [
        '--batch',
        '--check-only',
        '--check-template',
        '--html-only',
        '--pdf'
    ]

    if ([...flags].some(flag => !allowed.includes(flag))) {
        throw new Error('Unknown option.')
    }

    let files = args.filter(arg => !arg.startsWith('--'))

    if (flags.has('--batch')) {
        if (files.length) {
            throw new Error('Batch mode reads audits from in/.')
        }

        files = fs.readdirSync('in')
            .filter(name => name.endsWith('.json'))
            .sort()
            .map(name => path.join('in', name))
    }

    if (!files.length) {
        console.error('No JSON audits found. Put completed audits in in/.')
        process.exitCode = 2
        return
    }

    const result = checkBatch(files)

    printBatch(result)
    writeErrorLog(result)

    console.log('Diagnostic log: ' + path.resolve('out/error.log'))

    if (!result.valid) {
        process.exitCode = 1
        return
    }

    const reports = []
    const runtimeErrors = []

    try {
        const directory = resolveTemplate()

        console.log(
            `Template: ${process.env.TPL_PATH ? 'custom' : 'neutral'}\nPath: ${directory}`
        )
    } catch (error) {
        runtimeErrors.push({
            file: process.env.TPL_PATH || path.join(__dirname, 'tpl'),
            path: '—',
            message: error.message
        })

        console.error(error.message)
    }

    if (!runtimeErrors.length) {
        for (const file of files) {
            try {
                reports.push(await renderReport(file))
            } catch (error) {
                runtimeErrors.push({
                    file,
                    path: '—',
                    message: error.message
                })

                console.error(
                    `Template/render failed for ${file}: ${error.message}`
                )
            }
        }
    }

    if (runtimeErrors.length) {
        writeErrorLog(result, runtimeErrors)

        console.error(
            'Generation blocked: see out/error.log. No report created by this run.'
        )

        process.exitCode = 1
        return
    }

    if (flags.has('--check-only') || flags.has('--check-template')) return

    fs.mkdirSync('out', {recursive: true})

    let failures = 0

    for (const report of reports) {
        const output = path.join('out', 'rapport-' + report.siteName)

        fs.writeFileSync(output + '.html', report.html)
        console.log('HTML saved: ' + output + '.html')

        if (flags.has('--pdf') && !flags.has('--html-only')) {
            try {
                await require('./pdf').generatePdf(
                    output + '.html',
                    output + '.pdf'
                )
            } catch (error) {
                failures++

                runtimeErrors.push({
                    file: output + '.pdf',
                    path: '—',
                    message: error.message
                })

                console.error(
                    'PDF failed for ' + report.siteName + ': ' + error.message
                )
            }
        }
    }

    writeErrorLog(result, runtimeErrors)

    console.log(
        `Reports attempted: ${reports.length}; failed: ${failures}`
    )

    if (failures) process.exitCode = 1
}

if (require.main === module) {
    main().catch(error => {
        console.error('Report generation failed: ' + error.message)
        process.exitCode = 1
    })
}

module.exports = {
    readAudit,
    findSite,
    validateAudit,
    checkBatch,
    printBatch,
    resolveTemplate,
    writeErrorLog
}