process.env.GENREPORT_TEST_RUN = '1'

const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {spawnSync} = require('node:child_process')
const {checkBatch, validateAudit} = require('../index')
const criteria = require('../profile-raweb-1.1-simplified.json').criteria

function audit() {
    return {
        auditor: 'SIP',
        context: 'Campaign',
        audited_at: '2026-11-03',
        inventory: {name: 'Example'},
        platform: {name: 'Web'},
        audit_reference: {name: 'RAWeb', version: '1.1'},
        control_type: {name: 'Simplifié'},
        assessed_level: {name: 'AA'},
        pages: [{
            number: 1,
            uri: 'https://www.example.lu/',
            assessments: criteria.map(number => ({
                criterion: {number},
                status: {name: 'C'},
                exemption: false,
                exemption_comment: '',
                changes_to_do: '',
                patches_follow_up: ''
            }))
        }]
    }
}

test('collects all audit issues with exact JSON indexes and criterion labels', () => {
    const value = audit()

    value.pages[0].assessments[0].status.name = 'NT'
    value.pages[0].assessments[1].status.name = 'NC'
    value.pages[0].assessments[2].exemption = true
    value.pages[0].assessments.pop()

    const errors = validateAudit(value, 'in/example.json')

    assert.ok(errors.some(error =>
        error.path === 'pages[0].assessments[0].status.name' &&
        error.message.includes('P01')
    ))

    assert.ok(errors.some(error =>
        error.path === 'pages[0].assessments[1].changes_to_do'
    ))

    assert.ok(errors.some(error =>
        error.path === 'pages[0].assessments[2].exemption_comment'
    ))

    assert.ok(errors.some(error => error.message.includes('is missing')))
})

test('checks both sides, www matching, missing matches and unused entries', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'))

    try {
        const file = path.join(directory, 'audit.json')
        const statements = path.join(directory, 'statements.json')

        fs.writeFileSync(file, JSON.stringify(audit()))

        fs.writeFileSync(statements, JSON.stringify({
            'example.lu': {available: true, missing: null},
            'unused.lu': {available: false, conform: false, missing: ''}
        }))

        let result = checkBatch([file], statements)

        assert.equal(result.valid, false)
        assert.equal(result.rows[0].key, 'example.lu')

        assert.ok(result.rows[0].errors.some(error =>
            error.path === '["example.lu"].missing' &&
            error.message.includes('null')
        ))

        assert.ok(result.rows[0].errors.some(error =>
            error.path === '["example.lu"].conform'
        ))

        assert.equal(result.unused[0].key, 'unused.lu')

        fs.writeFileSync(statements, JSON.stringify({
            'example.lu': {available: true, conform: true, missing: ''}
        }))

        assert.equal(checkBatch([file], statements).valid, true)

        fs.writeFileSync(statements, '{}')

        result = checkBatch([file], statements)

        assert.equal(result.rows[0].status, 'MATCH NOT FOUND')
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
})

test('malformed input does not hide valid files or crash preflight', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'))

    try {
        const bad = path.join(directory, 'bad.json')
        const valid = path.join(directory, 'valid.json')
        const statements = path.join(directory, 'statements.json')

        fs.writeFileSync(bad, '{')
        fs.writeFileSync(valid, JSON.stringify(audit()))

        fs.writeFileSync(statements, JSON.stringify({
            'example.lu': {available: true, conform: true, missing: ''}
        }))

        const result = checkBatch([bad, valid], statements)

        assert.equal(result.rows.length, 2)
        assert.equal(result.failed, 1)
        assert.equal(result.valid, false)
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
})

test('error.log covers malformed, incomplete and valid later audits, then replaces stale errors', () => {
    const root = path.resolve(__dirname, '..')
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'report-log-'))

    try {
        fs.mkdirSync(path.join(directory, 'in'))
        fs.mkdirSync(path.join(directory, 'data'))

        fs.writeFileSync(
            path.join(directory, 'in/01-malformed.json'),
            '{'
        )

        const incomplete = audit()
        incomplete.pages[0].assessments[0].status.name = 'NT'
        incomplete.pages[0].assessments[1].status.name = 'NC'

        fs.writeFileSync(
            path.join(directory, 'in/02-incomplete.json'),
            JSON.stringify(incomplete)
        )

        const valid = audit()
        valid.pages[0].uri = 'https://other.lu/'

        fs.writeFileSync(
            path.join(directory, 'in/03-valid.json'),
            JSON.stringify(valid)
        )

        fs.writeFileSync(
            path.join(directory, 'data/accessibility-statements.json'),
            JSON.stringify({
                'example.lu': {available: true, conform: true, missing: ''},
                'other.lu': {available: true, conform: true, missing: ''}
            })
        )

        const run = () => spawnSync(
            process.execPath,
            [path.join(root, 'index.js'), '--batch', '--check-only'],
            {
                cwd: directory,
                encoding: 'utf8',
                env: {...process.env, TPL_PATH: path.join(root, 'tpl')}
            }
        )

        let result = run()

        assert.equal(result.status, 1, result.stderr)

        const log = path.join(directory, 'out/error.log')
        let text = fs.readFileSync(log, 'utf8')

        for (const expected of [
            '01-malformed.json',
            '02-incomplete.json',
            '03-valid.json',
            'P01 / Critère 1.1',
            'P01 / Critère 1.2',
            'pages[0].assessments[0].status.name',
            'Audits analysés : 3',
            'Bloqués : 2'
        ]) {
            assert.ok(text.includes(expected), expected)
        }

        assert.equal(
            fs.existsSync(path.join(directory, 'out/rapport-other.html')),
            false
        )

        fs.unlinkSync(path.join(directory, 'in/01-malformed.json'))

        fs.writeFileSync(
            path.join(directory, 'in/02-incomplete.json'),
            JSON.stringify(audit())
        )

        result = run()

        assert.equal(result.status, 0, result.stderr)

        text = fs.readFileSync(log, 'utf8')

        assert.match(text, /Erreurs : 0/)
        assert.doesNotMatch(text, /01-malformed.json|NT, finish/)

        fs.unlinkSync(
            path.join(directory, 'data/accessibility-statements.json')
        )

        result = run()

        assert.equal(result.status, 1)

        text = fs.readFileSync(log, 'utf8')

        assert.match(text, /ERREURS COMMUNES AU LOT/)
        assert.match(text, /File not found/)
        assert.match(text, /03-valid.json/)
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
})