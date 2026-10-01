/**
 * Typed contract between main process, preload and renderer.
 * Every invoke channel is listed in IpcInvokeMap; preload and main are both
 * typed against it, so a renamed channel or changed payload fails to compile.
 */

export interface AppInfo {
    version: string
    platform: string
    arch: string
    electron: string
    chrome: string
    node: string
    userDataPath: string
}

export interface WorkerStatus {
    pid: number | null
    uptimeMs: number
    roundTripMs: number
}

export interface IpcInvokeMap {
    'app:get-info': { args: []; result: AppInfo }
    'worker:status': { args: []; result: WorkerStatus }
    /** Native folder picker; resolves null when cancelled. */
    'dialog:pick-folder': { args: [defaultPath?: string]; result: string | null }
    /** Native file picker for a single .duckdb file; resolves null when cancelled. */
    'dialog:pick-duckdb': { args: []; result: string | null }
    /** Save dialog for an export package; resolves the chosen path or null. */
    'dialog:save-package': { args: [suggestedName: string, format: 'rses' | 'rlap']; result: string | null }
    /** Open dialog for .rses / .rlap / .duckdb files to import; resolves [] when cancelled. */
    'dialog:pick-import': { args: []; result: string[] }
    /** Asks for confirmation, moves LMU's recording files to the Recycle Bin and removes the session; false if cancelled. */
    'session:delete': { args: [sessionId: number]; result: boolean }
    /** Save dialog + write text file; resolves the written path or null when cancelled. */
    'dialog:save-text': { args: [suggestedName: string, content: string]; result: string | null }
}

export type InvokeChannel = keyof IpcInvokeMap

/** Fire-and-forget channels renderer → main. */
export const IpcSend = {
    /** Ask main to open a fresh MessagePort pair between this renderer and the worker. */
    workerConnect: 'worker:connect',
} as const

/** Channels main → preload. */
export const IpcPush = {
    workerPort: 'worker:port',
} as const

/** Message type the preload uses to hand the worker port to the page (window.postMessage). */
export const WORKER_PORT_MESSAGE = 'rays:worker-port'

/** API exposed on window.api by the preload script. */
export interface RaysApi {
    app: {
        getInfo(): Promise<AppInfo>
    }
    dialog: {
        pickFolder(defaultPath?: string): Promise<string | null>
        pickDuckDb(): Promise<string | null>
        saveText(suggestedName: string, content: string): Promise<string | null>
        savePackage(suggestedName: string, format: 'rses' | 'rlap'): Promise<string | null>
        pickImport(): Promise<string[]>
    }
    sessions: {
        delete(sessionId: number): Promise<boolean>
    }
    files: {
        /** Absolute path of a dropped file (Electron webUtils). */
        pathFor(file: File): string
    }
    worker: {
        status(): Promise<WorkerStatus>
        /** Requests a direct MessagePort to the worker; it arrives as a window message of type WORKER_PORT_MESSAGE. */
        requestPort(): void
    }
}
