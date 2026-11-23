process.env.GENREPORT_TEST_RUN = '1'

const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {spawnSync} = require('child_process')
const {readAudit, findSite} = require('../index')
const criteria = require('../profile-raweb-1.1-simplified.json').criteria

function audit() {
    return {
        auditor: 'SIP',
        context: 'Campaign',
        audited_at: '2026-11-03',
        inventory: {name: 'Test'},
        platform: {name: 'Web'},
        audit_reference: {name: 'RAWeb', version: '1.1'},
        control_type: {name: 'Simplifié'},
        assessed_level: {name: 'AA'},
        pages: [1, 2, 3].map(number => ({
            number,
            uri: `https://example.lu/${number}`,
            assessments: criteria.map(number => ({
                criterion: {number},
                status: {name: 'C'},
                exemption: false,
                exemption_comment: '',
                changes_to_do: '',
                patches_follow_up: ''
            }))
        }))
    }
}

function read(value) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'report-'))

    try {
        const file = path.join(directory, 'audit.json')
        fs.writeFileSync(file, JSON.stringify(value))
        return readAudit(file)
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
}

test('reads completed audit and calculates ASCA consolidated score', () => {
    const value = audit()
    value.pages[1].assessments[0].status.name = 'NC'
    value.pages[1].assessments[0].changes_to_do = 'Finding'

    const result = read(value)

    assert.equal(result.issues.length, 1)
    assert.equal(result.info.score, 'Très bon')
    assert.equal(result.siteName, 'example')
})

test('rejects NT, missing findings, duplicate and missing criteria', () => {
    const mutations = [
        value => value.pages[0].assessments[0].status.name = 'NT',
        value => value.pages[0].assessments[0].status.name = 'NC',
        value => value.pages[0].assessments.pop(),
        value => value.pages[0].assessments.push(
            value.pages[0].assessments[0]
        )
    ]

    for (const mutate of mutations) {
        const value = audit()
        mutate(value)
        assert.throws(() => read(value))
    }
})

test('requires justification and excludes exempt findings', () => {
    const value = audit()
    const answer = value.pages[0].assessments[0]

    answer.status.name = 'NC'
    answer.exemption = true

    assert.throws(() => read(value))

    answer.exemption_comment = 'Reason'

    assert.equal(read(value).issues.length, 0)
})

test('matches www without merging subdomains', () => {
    assert.equal(
        findSite('https://www.example.lu/', {'example.lu': {}}),
        'example.lu'
    )

    assert.equal(
        findSite('https://sub.example.lu/', {'example.lu': {}}),
        undefined
    )
})

test('HTML renders findings from multiple pages, fallback and declaration text', () => {
    const root = path.resolve(__dirname, '..')
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'report-html-'))

    try {
        fs.mkdirSync(path.join(directory, 'data'))

        fs.writeFileSync(
            path.join(directory, 'data/accessibility-statements.json'),
            JSON.stringify({
                'example.lu': {
                    available: true,
                    conform: false,
                    missing: 'Contact <test>'
                }
            })
        )

        const value = audit()

        for (const page of value.pages.slice(0, 2)) {
            page.assessments[0].status.name = 'NC'
            page.assessments[0].changes_to_do = 'Finding page ' + page.number
        }

        fs.writeFileSync(
            path.join(directory, 'audit.json'),
            JSON.stringify(value)
        )

        const result = spawnSync(
            process.execPath,
            [path.join(root, 'index.js'), 'audit.json'],
            {
                cwd: directory,
                env: {...process.env, TPL_PATH: path.join(root, 'tpl')},
                encoding: 'utf8'
            }
        )

        assert.equal(result.status, 0, result.stderr)

        const html = fs.readFileSync(
            path.join(directory, 'out/rapport-example.html'),
            'utf8'
        )

        assert.match(html, /Finding page 1/)
        assert.match(html, /Finding page 2/)
        assert.match(html, /Contact &lt;test&gt;/)

        fs.writeFileSync(
            path.join(directory, 'data/accessibility-statements.json'),
            '{}'
        )

        assert.notEqual(
            spawnSync(
                process.execPath,
                [path.join(root, 'index.js'), 'audit.json'],
                {cwd: directory, encoding: 'utf8'}
            ).status,
            0
        )
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
})

test('rejects complete RAWeb 1 without changing its pages', () => {
    const value = audit()

    value.control_type.name = 'Complet'
    value.audit_reference.version = '1'

    const original = JSON.stringify(value)

    assert.throws(
        () => read(value),
        /Unsupported audit: RAWeb 1 \/ Complet/
    )

    assert.equal(JSON.stringify(value), original)
})

test('accepts UTF-8 BOM in Windows JSON files', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'report-bom-'))

    try {
        const file = path.join(directory, 'audit.json')
        fs.writeFileSync(file, '\uFEFF' + JSON.stringify(audit()))

        assert.equal(readAudit(file).info.site, 'Test')
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
})

test('batch creates directories, preserves spaced paths, blocks the entire batch on invalid input', () => {
    const root = path.resolve(__dirname, '..')
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'report batch '))
    const env = {...process.env, GENREPORT_TEST_RUN: '1'}

    try {
        for (const name of fs.readdirSync(root)) {
            if (!['node_modules', 'in', 'out', 'data', 'test'].includes(name)) {
                fs.cpSync(
                    path.join(root, name),
                    path.join(directory, name),
                    {recursive: true}
                )
            }
        }

        fs.symlinkSync(
            path.join(root, 'node_modules'),
            path.join(directory, 'node_modules'),
            'junction'
        )

        let result = spawnSync(
            'bash',
            [path.join(directory, 'genAll.sh'), '--html-only'],
            {cwd: os.tmpdir(), env, encoding: 'utf8'}
        )

        assert.equal(result.status, 2, result.stderr)
        assert.doesNotMatch(
            result.stdout,
            /Installing dependencies|Installing Chromium|Running tests/
        )

        assert.ok(
            fs.existsSync(path.join(root, 'node_modules/ajv/dist/2020.js'))
        )

        for (const name of ['in', 'out', 'data']) {
            assert.ok(fs.statSync(path.join(directory, name)).isDirectory())
        }

        fs.writeFileSync(
            path.join(directory, 'data/accessibility-statements.json'),
            JSON.stringify({
                'example.lu': {available: true, conform: true, missing: ''}
            })
        )

        fs.writeFileSync(
            path.join(directory, 'in/valid audit.json'),
            JSON.stringify(audit())
        )

        fs.writeFileSync(
            path.join(directory, 'in/invalid audit.json'),
            '{}'
        )

        result = spawnSync(
            'bash',
            [path.join(directory, 'genAll.sh'), '--html-only'],
            {cwd: os.tmpdir(), env, encoding: 'utf8'}
        )

        assert.equal(result.status, 1, result.stderr)
        assert.match(result.stdout, /Generation blocked/)

        assert.equal(
            fs.existsSync(path.join(directory, 'out/rapport-example.html')),
            false
        )

        fs.unlinkSync(path.join(directory, 'in/invalid audit.json'))

        result = spawnSync(
            'bash',
            [path.join(directory, 'genAll.sh'), '--check-only'],
            {cwd: os.tmpdir(), env, encoding: 'utf8'}
        )

        assert.equal(result.status, 0, result.stderr)

        assert.equal(
            fs.existsSync(path.join(directory, 'out/rapport-example.html')),
            false
        )

        result = spawnSync(
            'bash',
            [
                path.join(directory, 'run.sh'),
                '--html-only',
                path.join(directory, 'in/valid audit.json')
            ],
            {cwd: os.tmpdir(), env, encoding: 'utf8'}
        )

        assert.equal(result.status, 0, result.stderr)

        fs.writeFileSync(
            path.join(directory, 'data/accessibility-statements.json'),
            '{"available":true,"conform":true,"missing":""}'
        )

        result = spawnSync(
            'bash',
            [
                path.join(directory, 'run.sh'),
                '--html-only',
                path.join(directory, 'in/valid audit.json')
            ],
            {env, encoding: 'utf8'}
        )

        assert.notEqual(result.status, 0)
        assert.match(result.stdout, /keyed by domain/)
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
})

test('custom templates validate includes without writing and preserve all findings', () => {
    const root = path.resolve(__dirname, '..')
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'custom template ')
    )

    try {
        fs.cpSync(
            path.join(root, 'tpl'),
            path.join(directory, 'model'),
            {recursive: true}
        )

        fs.mkdirSync(path.join(directory, 'data'))

        fs.writeFileSync(
            path.join(directory, 'data/accessibility-statements.json'),
            JSON.stringify({
                'example.lu': {available: true, conform: true, missing: ''}
            })
        )

        fs.writeFileSync(
            path.join(directory, 'audit.json'),
            JSON.stringify(audit())
        )

        const main = path.join(directory, 'model/main.ejs')
        const original = fs.readFileSync(main, 'utf8')
        const env = {...process.env, TPL_PATH: path.join(directory, 'model')}

        let result = spawnSync(
            process.execPath,
            [path.join(root, 'index.js'), 'audit.json', '--check-template'],
            {cwd: directory, env, encoding: 'utf8'}
        )

        assert.equal(result.status, 0, result.stderr)
        assert.equal(
            fs.existsSync(path.join(directory, 'out/rapport-example.html')),
            false
        )
        assert.ok(fs.existsSync(path.join(directory, 'out/error.log')))

        fs.writeFileSync(
            main,
            original + "<%- include('missing-logo.ejs') %>"
        )

        result = spawnSync(
            process.execPath,
            [path.join(root, 'index.js'), 'audit.json', '--check-template'],
            {cwd: directory, env, encoding: 'utf8'}
        )

        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /missing-logo/)
        assert.match(
            fs.readFileSync(path.join(directory, 'out/error.log'), 'utf8'),
            /missing-logo/
        )
        assert.equal(
            fs.existsSync(path.join(directory, 'out/rapport-example.html')),
            false
        )

        fs.unlinkSync(path.join(directory, 'model/print.css'))

        result = spawnSync(
            process.execPath,
            [path.join(root, 'index.js'), 'audit.json', '--check-only'],
            {cwd: directory, env, encoding: 'utf8'}
        )

        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /print.css/)
        assert.match(
            fs.readFileSync(path.join(directory, 'out/error.log'), 'utf8'),
            /print.css/
        )
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
})