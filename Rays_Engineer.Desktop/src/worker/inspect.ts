/**
 * Generic structural dump of a .duckdb file — makes no assumptions about
 * LMU's schema. Used to derive docs/SCHEMA.md from real recordings and as a
 * diagnostics tool. Imported by the worker and by scripts/inspect-duckdb.ts,
 * so it must only use erasable TypeScript syntax and no relative imports
 * other than type-only ones.
 */
import { DuckDBInstance, version } from '@duckdb/node-api'
import { stat } from 'node:fs/promises'
import type { InspectColumn, InspectReport, InspectTable } from '../shared/types'

const FULL_ROWS_LIMIT = 200
const HEAD_TAIL = 5
const NUMERIC_TYPE = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|DOUBLE|REAL|DECIMAL.*|BOOLEAN|TIMESTAMP.*|DATE)$/i

const q = (ident: string) => `"${ident.replaceAll('"', '""')}"`

export async function inspectDuckDb(path: string): Promise<InspectReport> {
    const fileSize = (await stat(path)).size
    const instance = await DuckDBInstance.create(path, { access_mode: 'READ_ONLY' })
    const conn = await instance.connect()
    try {
        const all = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson() as Record<string, unknown>[]

        const tableRows = await all(
            `SELECT table_schema, table_name FROM information_schema.tables
             WHERE table_type = 'BASE TABLE' ORDER BY table_schema, table_name`)
        const colRows = await all(
            `SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns
             ORDER BY table_schema, table_name, ordinal_position`)

        const tables: InspectTable[] = []
        for (const t of tableRows) {
            const schema = String(t['table_schema'])
            const name = String(t['table_name'])
            const ref = schema === 'main' ? q(name) : `${q(schema)}.${q(name)}`
            const columns: InspectColumn[] = colRows
                .filter(c => c['table_schema'] === schema && c['table_name'] === name)
                .map(c => ({ name: String(c['column_name']), type: String(c['data_type']) }))

            const rowCount = Number((await all(`SELECT COUNT(*) AS n FROM ${ref}`))[0]?.['n'] ?? 0)

            const numeric = columns.filter(c => NUMERIC_TYPE.test(c.type))
            if (numeric.length > 0 && rowCount > 0) {
                const select = numeric.flatMap((c, i) => [
                    `MIN(${q(c.name)}) AS mn${i}`, `MAX(${q(c.name)}) AS mx${i}`, `COUNT(${q(c.name)}) AS nn${i}`,
                ]).join(', ')
                const stats = (await all(`SELECT ${select} FROM ${ref}`))[0] ?? {}
                numeric.forEach((c, i) => {
                    c.min = stats[`mn${i}`]
                    c.max = stats[`mx${i}`]
                    c.nonNull = Number(stats[`nn${i}`])
                })
            }

            const small = rowCount <= FULL_ROWS_LIMIT
            // rowid keeps insertion order for head/tail without assuming any column exists.
            tables.push({
                name: schema === 'main' ? name : `${schema}.${name}`,
                rowCount,
                columns,
                rows: small ? await all(`SELECT * FROM ${ref} ORDER BY rowid`) : null,
                head: small ? [] : await all(`SELECT * FROM ${ref} ORDER BY rowid LIMIT ${HEAD_TAIL}`),
                tail: small ? [] : (await all(`SELECT * FROM ${ref} ORDER BY rowid DESC LIMIT ${HEAD_TAIL}`)).reverse(),
            })
        }

        return { file: path, fileSize, duckdbLibraryVersion: version(), generatedAt: new Date().toISOString(), tables }
    } finally {
        conn.closeSync()
        instance.closeSync()
    }
}
