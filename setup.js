// Shared incremental setup for run.sh and genAll.sh.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {spawnSync} = require('node:child_process')

const root = __dirname
const state = path.join(root, 'node_modules', '.genreport-setup.json')

const digest = values =>
    crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex')

const readState = () => {
    try {
        return JSON.parse(fs.readFileSync(state, 'utf8'))
    } catch {
        return {}
    }
}

function command(name, args, extraEnv = {}) {
    const result = spawnSync(name, args, {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: {...process.env, ...extraEnv}
    })

    if (result.error) throw result.error

    if (result.status !== 0) {
        throw new Error(
            `${name} ${args.join(' ')} failed (${result.status ?? result.signal}).`
        )
    }
}

function sourceFingerprint() {
    const entries = []

    function walk(directory) {
        const items = fs.readdirSync(directory, {withFileTypes: true})
            .sort((a, b) => a.name.localeCompare(b.name))

        for (const item of items) {
            const file = path.join(directory, item.name)

            if (item.isDirectory()) {
                walk(file)
            } else if (item.isFile()) {
                entries.push([
                    path.relative(root, file),
                    fs.readFileSync(file).toString('base64')
                ])
            }
        }
    }

    const items = fs.readdirSync(root, {withFileTypes: true})
        .sort((a, b) => a.name.localeCompare(b.name))

    for (const item of items) {
        if (item.isFile() && /\.(js|json|sh)$/.test(item.name)) {
            entries.push([
                item.name,
                fs.readFileSync(path.join(root, item.name)).toString('base64')
            ])
        }
    }

    for (const directory of ['test', 'tpl']) {
        walk(path.join(root, directory))
    }

    return digest(entries)
}

async function main() {
    process.chdir(root)

    const fingerprint = digest([
        process.version,
        process.platform,
        process.arch,
        ...['package.json', 'package-lock.json'].map(file =>
            fs.readFileSync(file, 'utf8')
        )
    ])

    let cached = readState()

    // Warm starts only check a few files; they do not load dependency trees.
    const healthy =
        Array.isArray(cached.moduleFiles) &&
        cached.moduleFiles.length === 6 &&
        cached.moduleFiles.every(file => fs.existsSync(file))

    if (!healthy || cached.dependencies !== fingerprint) {
        fs.rmSync(state, {force: true})

        console.log(
            !healthy
                ? 'Préparation absente ou dépendances manquantes : installation npm ci...'
                : 'Configuration Node.js ou dépendances modifiées : mise à jour npm ci...'
        )

        command('npm', ['ci'])
        cached = {dependencies: fingerprint}

        // Do not reuse modules loaded before node_modules was replaced.
        for (const file of Object.keys(require.cache)) {
            if (file.includes(`${path.sep}node_modules${path.sep}`)) {
                delete require.cache[file]
            }
        }

        cached.moduleFiles = [
            'ajv/dist/2020',
            'ajv-formats',
            'ejs',
            'markdown-it',
            'markdown-it-attrs',
            'playwright'
        ].map(name => require.resolve(name))
    } else {
        console.log('Dépendances déjà préparées : aucune réinstallation.')
    }

    if (process.argv.includes('--pdf')) {
        const {chromium} = require('playwright')

        async function checkBrowser() {
            const browser = await chromium.launch({headless: true})
            await browser.close()
        }

        if (
            cached.browserExecutable &&
            fs.existsSync(cached.browserExecutable)
        ) {
            console.log(
                'Chromium déjà préparé : aucun lancement de vérification.'
            )
        } else {
            console.log(
                'Chromium non encore validé : vérification initiale...'
            )

            try {
                await checkBrowser()
            } catch (error) {
                console.log(
                    'Chromium absent ou inutilisable : tentative d’installation...'
                )
                console.error('Motif : ' + error.message)

                command('npx', [
                    '--no-install',
                    'playwright',
                    'install',
                    'chromium'
                ])

                await checkBrowser()
            }

            cached.browserExecutable = chromium.executablePath()
            console.log('Chromium prêt.')
        }
    } else {
        console.log('Mode sans PDF : préparation Chromium ignorée.')
    }

    const tests = digest([fingerprint, sourceFingerprint()])

    if (cached.tests !== tests) {
        console.log('Projet nouveau ou modifié : exécution des tests...')
        command('npm', ['test'], {GENREPORT_TEST_RUN: '1'})
        cached.tests = tests
    } else {
        console.log(
            'Tests déjà réussis pour cette version : aucun nouveau test.'
        )
    }

    fs.mkdirSync(path.dirname(state), {recursive: true})
    fs.writeFileSync(state, JSON.stringify(cached))
}

main().catch(error => {
    console.error(`Setup failed: ${error.message}`)
    process.exitCode = 1
})