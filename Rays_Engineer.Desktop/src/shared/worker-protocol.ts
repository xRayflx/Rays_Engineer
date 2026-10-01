/**
 * RPC protocol spoken over MessagePorts between the utility process (worker)
 * and its clients (main process, renderer). Payloads are structured-cloned,
 * so typed arrays travel as binary — never as JSON.
 */
import type { AnalysisResult } from './analysis'
import type { ImportResult } from './package'
import type { LmuTelemetryConfig } from './telemetry-config'
import type { AutoRecordState, IndexStatus, InspectReport, LapRow, RecordingConfigState, ReferenceLap, SessionRow, TelemetryFolderSetting } from './types'

export interface WorkerMethods {
    ping: { params: void; result: { pid: number; uptimeMs: number } }
    /** Diagnostics: returns a synthetic trace to verify the binary transfer path. */
    transferTest: { params: { samples: number }; result: { distance: Float32Array; value: Float32Array } }

    getIndexStatus: { params: void; result: IndexStatus }
    setTelemetryFolder: { params: TelemetryFolderSetting; result: IndexStatus }
    setArchiveSessions: { params: { enabled: boolean }; result: IndexStatus }
    rescan: { params: void; result: IndexStatus }
    listSessions: { params: void; result: SessionRow[] }
    getSession: { params: { id: number }; result: { session: SessionRow; laps: LapRow[]; reference: ReferenceLap | null; note: string; allTags: string[] } }
    setSessionNote: { params: { sessionId: number; body: string }; result: void }
    setLapNote: { params: { lapId: number; body: string }; result: void }
    setSessionTags: { params: { sessionId: number; tags: string[] }; result: void }
    /** Called by the main process only (delete flow). */
    sessionFiles: { params: { sessionId: number }; result: { lmuFiles: string[]; appFiles: string[] } }
    removeSession: { params: { sessionId: number }; result: void }
    /** targetPath comes from the native save dialog (.rses / .rlap). */
    exportSession: { params: { sessionId: number; targetPath: string }; result: void }
    exportLap: { params: { lapId: number; targetPath: string }; result: void }
    importFiles: { params: { paths: string[] }; result: ImportResult & { sessionIds: number[] } }
    /** manual = true pins the lap as reference for its track + car; false returns to automatic (best valid lap). */
    /** Up to 5 laps on a shared distance grid; the reference lap comes first. */
    analyseLaps: { params: { lapIds: number[]; referenceLapId: number | null; extraChannels?: string[] }; result: AnalysisResult }

    /** LMU's recording config (config.json) in the active telemetry folder. */
    getRecordingConfig: { params: void; result: RecordingConfigState }
    writeRecordingConfig: { params: { config: LmuTelemetryConfig }; result: RecordingConfigState }

    /** LMU's "Automatically Record Telemetry" option (UserData\player\Settings.JSON). */
    getAutoRecord: { params: void; result: AutoRecordState }
    setAutoRecord: { params: { enabled: boolean }; result: AutoRecordState }

    /** Generic structural dump of any .duckdb file (schema analysis, diagnostics). */
    inspectDuckDb: { params: { path: string }; result: InspectReport }
}

export type WorkerMethod = keyof WorkerMethods

export interface WorkerRequest<M extends WorkerMethod = WorkerMethod> {
    id: number
    method: M
    params: WorkerMethods[M]['params']
}

export type WorkerResponse<M extends WorkerMethod = WorkerMethod> =
    | { id: number; ok: true; result: WorkerMethods[M]['result'] }
    | { id: number; ok: false; error: string }

/** Unsolicited notifications worker → all connected clients. */
export type WorkerEventName = 'sessions-changed' | 'status-changed'

export interface WorkerEventMessage {
    type: 'event'
    event: WorkerEventName
}

export function isWorkerRequest(data: unknown): data is WorkerRequest {
    return typeof data === 'object' && data !== null
        && typeof (data as WorkerRequest).id === 'number'
        && typeof (data as WorkerRequest).method === 'string'
}

export function isWorkerEvent(data: unknown): data is WorkerEventMessage {
    return typeof data === 'object' && data !== null && (data as WorkerEventMessage).type === 'event'
}
