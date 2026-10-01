/**
 * Phase-0 schema analysis: dumps the structure of real LMU recordings.
 *
 *   npm run inspect-duckdb -- <file.duckdb | folder> [...more] [--out <dir>]
 *
 * Writes one <name>.inspect.json per file (default: ../samples/analysis) and
 * prints a short table overview. Makes no assumptions about LMU's schema.
 */
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { inspectDuckDb } from '../src/worker/inspect.ts'

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    const outIdx = args.indexOf('--out')
    const outDir = resolve(outIdx >= 0 ? args.splice(outIdx, 2)[1]! : join(import.meta.dirname, '..', '..', 'samples', 'analysis'))
    if (args.length === 0) {
        console.error('usage: npm run inspect-duckdb -- <file.duckdb | folder> [...] [--out <dir>]')
        process.exit(2)
    }

    const files: string[] = []
    for (const a of args) {
        const p = resolve(a)
        if ((await stat(p)).isDirectory())
            files.push(...(await readdir(p)).filter(n => n.toLowerCase().endsWith('.duckdb')).map(n => join(p, n)))
        else files.push(p)
    }

    await mkdir(outDir, { recursive: true })
    for (const file of files) {
        const report = await inspectDuckDb(file)
        const out = join(outDir, `${basename(file).replace(/\.duckdb$/i, '')}.inspect.json`)
        await writeFile(out, JSON.stringify(report, null, 2))
        console.log(`\n${basename(file)}  (${(report.fileSize / 1e6).toFixed(1)} MB, ${report.tables.length} tables, DuckDB ${report.duckdbLibraryVersion})`)
        for (const t of report.tables)
            console.log(`  ${t.name.padEnd(32)} ${String(t.rowCount).padStart(9)} rows  ${t.columns.map(c => `${c.name}:${c.type}`).join(', ')}`)
        console.log(`  → ${out}`)
    }
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
