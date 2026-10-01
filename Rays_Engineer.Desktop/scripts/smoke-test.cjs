/**
 * Launches a built app and checks the essentials end to end:
 * window loads, worker answers, SQLite index opens, DuckDB reads a file,
 * network stays blocked.
 *
 *   node scripts/smoke-test.cjs [path-to-executable]
 *
 * Without an argument it runs the unpackaged build (out/) with the dev Electron.
 */
const { _electron } = require('playwright-core')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const root = resolve(__dirname, '..')

async function makeDuckDb(file) {
    const { DuckDBInstance } = await import('@duckdb/node-api')
    const db = await DuckDBInstance.create(file)
    const c = await db.connect()
    await c.run('CREATE TABLE t AS SELECT range::DOUBLE AS v FROM range(100)')
    c.closeSync()
    db.closeSync()
}

async function main() {
    const exe = process.argv[2]
    const work = mkdtempSync(join(tmpdir(), 'rays-smoke-'))
    const duck = join(work, 'smoke.duckdb')
    const report = join(work, 'smoke.inspect.json')
    await makeDuckDb(duck)

    const env = { ...process.env, APPDATA: work, XDG_CONFIG_HOME: work }
    const app = exe
        ? await _electron.launch({ executablePath: resolve(exe), args: [], env })
        : await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env })

    const step = (msg) => console.log(`ok - ${msg}`)
    try {
        await app.evaluate(({ dialog }, paths) => {
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.duck] })
            dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.report })
        }, { duck, report })

        const page = await app.firstWindow()
        await page.waitForSelector('nav >> text=Sessions', { timeout: 30_000 })
        step('window loaded')

        const isolated = await page.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined')
        if (!isolated) throw new Error('renderer has Node access')
        step('renderer isolated')

        const blocked = await page.evaluate(() => fetch('https://example.com').then(() => false, () => true))
        if (!blocked) throw new Error('network request was not blocked')
        step('network blocked')

        await page.click('nav >> text=Settings')
        await page.waitForSelector('text=Telemetry folder', { timeout: 15_000 })
        step('SQLite index opened (settings rendered)')

        await page.click('text=Check worker')
        await page.waitForSelector('text=Trace transfer', { timeout: 15_000 })
        step('worker RPC + binary transfer')

        await page.click('text=Inspect .duckdb…')
        await page.waitForSelector('text=saved to', { timeout: 30_000 })
        const r = require(report)
        if (r.tables.length !== 1 || r.tables[0].rowCount !== 100) throw new Error('unexpected inspect result')
        step(`DuckDB read (${r.duckdbLibraryVersion})`)
    } finally {
        await app.close()
    }
}

main().catch(err => {
    console.error(`not ok - ${err.message}`)
    process.exit(1)
})
