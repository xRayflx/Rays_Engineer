/**
 * Utility-process entry point. Runs all heavy work (index database, folder
 * watching, DuckDB reads, lap processing) so neither the UI nor the main
 * process ever blocks.
 */
import type { MessagePortMain } from 'electron'
import {
    isWorkerRequest,
    type WorkerEventName,
    type WorkerMethod,
    type WorkerMethods,
    type WorkerRequest,
    type WorkerResponse,
} from '../shared/worker-protocol'
import { inspectDuckDb } from './inspect'
import { readAutoRecord, writeAutoRecord } from './lmu-settings'
import { readRecordingConfig, writeRecordingConfig } from './recording'
import { WorkerService } from './service'

type Handler<M extends WorkerMethod> = (params: WorkerMethods[M]['params']) =>
    WorkerMethods[M]['result'] | Promise<WorkerMethods[M]['result']>

const startedAt = Date.now()
const clients = new Set<MessagePortMain>()

function emit(event: WorkerEventName): void {
    for (const port of clients) port.postMessage({ type: 'event', event })
}

const userData = process.env['RAYS_USER_DATA']
if (!userData) throw new Error('RAYS_USER_DATA is not set')
const service = new WorkerService(userData, process.env['RAYS_DOCUMENTS'] ?? null, emit, process.env['RAYS_APP_VERSION'] ?? '0.0.0')
const ready = service.start().catch(err => console.error('[worker] start failed', err))

const handlers: { [M in WorkerMethod]: Handler<M> } = {
    ping: () => ({ pid: process.pid, uptimeMs: Date.now() - startedAt }),

    transferTest: ({ samples }) => {
        const n = Math.max(1, Math.min(samples, 5_000_000))
        const distance = new Float32Array(n)
        const value = new Float32Array(n)
        for (let i = 0; i < n; i++) {
            distance[i] = i
            value[i] = Math.sin(i / 100)
        }
        return { distance, value }
    },

    getIndexStatus: async () => { await ready; return service.status() },
    setTelemetryFolder: async setting => { await ready; return service.setFolderSetting(setting) },
    setArchiveSessions: async ({ enabled }) => { await ready; return service.setArchive(enabled) },
    rescan: async () => { await ready; return service.rescan() },
    listSessions: async () => { await ready; return service.listSessions() },
    getSession: async ({ id }) => { await ready; return service.getSessionDetail(Number(id)) },
    analyseLaps: async ({ lapIds, referenceLapId, extraChannels }) => {
        await ready
        if (!Array.isArray(lapIds)) throw new Error('lapIds must be an array')
        return service.analyse(lapIds, referenceLapId ?? null, Array.isArray(extraChannels) ? extraChannels : [])
    },
    setSessionNote: async ({ sessionId, body }) => { await ready; service.setNote(Number(sessionId), String(body ?? '')) },
    setLapNote: async ({ lapId, body }) => { await ready; service.setLapNote(Number(lapId), String(body ?? '')) },
    setSessionTags: async ({ sessionId, tags }) => {
        await ready
        if (!Array.isArray(tags)) throw new Error('tags must be an array')
        service.setTags(Number(sessionId), tags)
    },
    sessionFiles: async ({ sessionId }) => { await ready; return service.sessionFiles(Number(sessionId)) },
    removeSession: async ({ sessionId }) => { await ready; await service.removeSession(Number(sessionId)) },
    exportSession: async ({ sessionId, targetPath }) => { await ready; await service.exportSession(Number(sessionId), String(targetPath)) },
    exportLap: async ({ lapId, targetPath }) => { await ready; await service.exportLap(Number(lapId), String(targetPath)) },
    importFiles: async ({ paths }) => {
        await ready
        if (!Array.isArray(paths)) throw new Error('paths must be an array')
        return service.importFiles(paths.map(String))
    },

    getRecordingConfig: async () => { await ready; return readRecordingConfig(service.status().activeFolder) },
    writeRecordingConfig: async ({ config }) => {
        await ready
        const folder = service.status().activeFolder
        if (!folder) throw new Error('No telemetry folder found — choose it in Settings first')
        return writeRecordingConfig(folder, config)
    },

    getAutoRecord: async () => { await ready; return readAutoRecord(service.status().activeFolder) },
    setAutoRecord: async ({ enabled }) => {
        await ready
        if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
        return writeAutoRecord(service.status().activeFolder, enabled)
    },

    inspectDuckDb: ({ path }) => {
        if (typeof path !== 'string' || !path.toLowerCase().endsWith('.duckdb')) throw new Error('Not a .duckdb file')
        return inspectDuckDb(path)
    },
}

async function dispatch(req: WorkerRequest): Promise<WorkerResponse> {
    const handler = handlers[req.method] as Handler<WorkerMethod> | undefined
    if (!handler) return { id: req.id, ok: false, error: `Unknown method: ${req.method}` }
    try {
        return { id: req.id, ok: true, result: await handler(req.params as never) }
    } catch (err) {
        return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
}

function serve(port: MessagePortMain): void {
    clients.add(port)
    port.on('message', async e => {
        if (isWorkerRequest(e.data)) port.postMessage(await dispatch(e.data))
    })
    port.on('close', () => {
        clients.delete(port)
        port.removeAllListeners()
    })
    port.start()
}

process.parentPort.on('message', async e => {
    const data = e.data as unknown
    if (typeof data === 'object' && data !== null && (data as { type?: string }).type === 'connect') {
        if (e.ports[0]) serve(e.ports[0])
        return
    }
    if (isWorkerRequest(data)) process.parentPort.postMessage(await dispatch(data))
})

process.on('exit', () => service.stop())
