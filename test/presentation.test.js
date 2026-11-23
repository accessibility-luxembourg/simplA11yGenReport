process.env.GENREPORT_TEST_RUN = '1'

const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const {readAudit, validateAudit} = require('../index')

function fixture(title) {
    const audit = {
        auditor: 'Test',
        context: 'Test',
        audited_at: '2026-11-19',
        inventory: {name: 'example.lu'},
        platform: {name: 'Web'},
        audit_reference: {name: 'RAWeb', version: '1.1'},
        control_type: {name: 'Simplifié'},
        assessed_level: {name: 'AA'},
        pages: [{
            number: 1,
            uri: 'https://example.lu/mes-services.html?x=1#section',
            assessments: require('../profile-raweb-1.1-simplified.json')
                .criteria.map(number => ({
                    criterion: {number},
                    status: {name: 'C'},
                    exemption: false,
                    exemption_comment: '',
                    changes_to_do: '',
                    patches_follow_up: ''
                }))
        }]
    }

    if (title !== undefined) audit.pages[0].title = title

    return audit
}

function readFixture(audit) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-title-'))

    try {
        const file = path.join(directory, 'audit.json')
        fs.writeFileSync(file, JSON.stringify(audit))

        return readAudit(file)
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
}

test('official JSON title is preserved exactly and source URI is unchanged', () => {
    const title = '  Accueil  — Équipe & <contact>  '
    const audit = fixture(title)
    const info = readFixture(audit).info

    assert.equal(info.pages[0].label, title)
    assert.equal(info.pages[0].value, audit.pages[0].uri)
})

test('missing, empty or unknown titles use a local URL fallback; aliases are ignored', () => {
    for (const title of [
        undefined,
        '',
        '   ',
        'Inconnu',
        'UNKNOWN',
        'Non renseigné'
    ]) {
        const audit = fixture(title)

        audit.pages[0].name = 'Alias à ignorer'
        audit.pages[0].label = 'Autre alias'

        assert.equal(
            readFixture(audit).info.pages[0].label,
            'Mes services'
        )
    }

    const audit = fixture()

    audit.pages[0].uri = 'https://example.lu/'

    assert.equal(
        readFixture(audit).info.pages[0].label,
        'Page d’accueil'
    )

    audit.pages[0].uri = 'https://example.lu/%ZZ'

    assert.equal(readFixture(audit).info.pages[0].label, 'Page 1')
})

test('title remains optional and invalid title types fail validation explicitly', () => {
    for (const title of [undefined, '', 'Accueil']) {
        assert.deepEqual(
            validateAudit(fixture(title), 'audit.json'),
            []
        )
    }

    for (const title of [null, 1, true, [], {}]) {
        assert.ok(
            validateAudit(fixture(title), 'audit.json').some(error =>
                error.path === 'pages[0].title'
            )
        )
    }
})

test('obsolete title sidecars are ignored and titles remain escaped in generated HTML', () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'report-offline-title-')
    )

    const root = path.resolve(__dirname, '..')

    try {
        fs.mkdirSync(path.join(directory, 'data'))
        fs.mkdirSync(path.join(directory, 'out'))

        fs.writeFileSync(
            path.join(directory, 'data/accessibility-statements.json'),
            JSON.stringify({
                'example.lu': {available: true, conform: true, missing: ''}
            })
        )

        for (const folder of ['data', 'out']) {
            fs.writeFileSync(
                path.join(directory, folder, 'page-titles.json'),
                'INVALID OLD SIDECAR'
            )
        }

        fs.writeFileSync(
            path.join(directory, 'audit.json'),
            JSON.stringify(fixture('  Accueil & <contact>  '))
        )

        const result = spawnSync(
            process.execPath,
            [path.join(root, 'index.js'), 'audit.json', '--html-only'],
            {
                cwd: directory,
                encoding: 'utf8',
                env: {...process.env, TPL_PATH: path.join(root, 'tpl')}
            }
        )

        assert.equal(result.status, 0, result.stderr)

        const html = fs.readFileSync(
            path.join(directory, 'out/rapport-example.html'),
            'utf8'
        )

        assert.match(html, />  Accueil &amp; &lt;contact&gt;  <\/a>/)

        assert.equal(
            fs.readFileSync(
                path.join(directory, 'out/page-titles.json'),
                'utf8'
            ),
            'INVALID OLD SIDECAR'
        )
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
})

test('templates keep all findings, reader-friendly headings, glossary links and lowercase score', async () => {
    const ejs = require('ejs')
    const MarkdownIt = require('markdown-it')
    const root = path.resolve(__dirname, '..')

    const md = MarkdownIt({html: true})
        .use(require('markdown-it-attrs'))

    const solutions = structuredClone(require('../solutions.json'))

    for (const list of Object.values(solutions)) {
        for (const solution of list) {
            if (Array.isArray(solution.desc)) {
                solution.desc = solution.desc.join('\n')
            }
        }
    }

    const issues = [
        {
            topic: 1,
            criteria: '1.1',
            page: 3,
            comment: 'Première constatation'
        },
        {
            topic: 1,
            criteria: '1.1',
            page: 7,
            comment: 'Seconde constatation'
        },
        {
            topic: 1,
            criteria: '1.99',
            page: 7,
            comment: 'Constat sans recommandation'
        }
    ]

    const info = {
        site: 'Exemple',
        date: '2026-07-29',
        score: 'Moyen',
        auditor: 'Auditeur',
        pages: [
            {
                id: 3,
                label: 'Accueil - Exemple',
                value: 'https://example.lu/'
            },
            {
                id: 7,
                label: 'Contact - Exemple',
                value: 'https://example.lu/contact'
            }
        ]
    }

    const html = await ejs.renderFile(
        path.join(root, 'tpl/main.ejs'),
        {
            info,
            issues,
            solutions,
            topics: require('../topics.json').filter(topic => topic.num === 1),
            md,
            mdForFindings: MarkdownIt({html: false}),
            formatKeys: value => value,
            declaration: {available: false, conform: false, missing: ''},
            docs: undefined
        }
    )

    assert.match(html, /Date : 29 juillet 2026/)
    assert.match(html, /<strong>moyen<\/strong>/)
    assert.match(html, />Accueil - Exemple<\/a>/)
    assert.match(html, /Exemples de problèmes détectés sur la/)
    assert.match(html, />page 7<\/a>/)
    assert.match(html, /image-porteuse-d-information/)

    for (const issue of issues) {
        assert.ok(html.includes(issue.comment))
    }

    assert.doesNotMatch(
        html,
        /Critère 1\.1 — P|mdForExcel|\/raweb1\//
    )
})