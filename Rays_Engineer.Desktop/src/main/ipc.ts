import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import { IpcSend, type InvokeChannel, type IpcInvokeMap } from '../shared/ipc'
import { isTrustedRendererUrl } from './security'
import type { WorkerHost } from './worker-host'

type InvokeHandler<C extends InvokeChannel> = (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']> | IpcInvokeMap[C]['result']

function handle<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>): void {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedRendererUrl(event.senderFrame?.url))
            throw new Error(`Rejected IPC '${channel}' from untrusted sender`)
        return handler(event, ...(args as IpcInvokeMap[C]['args']))
    })
}

export function registerIpc(worker: WorkerHost): void {
    handle('app:get-info', () => ({
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        userDataPath: app.getPath('userData'),
    }))

    handle('worker:status', async () => {
        const t0 = performance.now()
        const pong = await worker.call('ping', undefined)
        return { pid: pong.pid, uptimeMs: pong.uptimeMs, roundTripMs: performance.now() - t0 }
    })

    handle('dialog:pick-folder', async (event, defaultPath) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.OpenDialogOptions = {
            title: 'Select LMU telemetry folder',
            defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
            properties: ['openDirectory'],
        }
        const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        return res.canceled ? null : res.filePaths[0] ?? null
    })

    handle('dialog:pick-duckdb', async event => {
        const win = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.OpenDialogOptions = {
            title: 'Select a telemetry file',
            properties: ['openFile'],
            filters: [{ name: 'DuckDB telemetry', extensions: ['duckdb'] }],
        }
        const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        return res.canceled ? null : res.filePaths[0] ?? null
    })

    handle('dialog:save-package', async (event, suggestedName, format) => {
        if (format !== 'rses' && format !== 'rlap') throw new Error('Invalid format')
        const win = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.SaveDialogOptions = {
            title: format === 'rses' ? 'Export session' : 'Export lap',
            defaultPath: `${String(suggestedName).replace(/[\\/:*?"<>|]+/g, '_')}.${format}`,
            filters: [{ name: format === 'rses' ? 'Rays Engineer session' : 'Rays Engineer lap', extensions: [format] }],
        }
        const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
        return res.canceled || !res.filePath ? null : res.filePath
    })

    handle('dialog:pick-import', async event => {
        const win = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.OpenDialogOptions = {
            title: 'Import sessions or laps',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Sessions, laps, recordings', extensions: ['rses', 'rlap', 'duckdb'] }],
        }
        const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        return res.canceled ? [] : res.filePaths
    })

    handle('session:delete', async (event, sessionId) => {
        const id = Number(sessionId)
        if (!Number.isInteger(id)) throw new Error('Invalid session id')
        // The worker decides which files belong to the session — never the renderer.
        const { lmuFiles } = await worker.call('sessionFiles', { sessionId: id })
        const win = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.MessageBoxOptions = {
            type: 'warning',
            buttons: ['Cancel', 'Delete'],
            defaultId: 0,
            cancelId: 0,
            title: 'Delete session',
            message: 'Delete this session?',
            detail: lmuFiles.length
                ? `The recording will be moved to the Recycle Bin:\n${lmuFiles.join('\n')}`
                : 'It is removed from Rays Engineer together with the app\'s own copy.',
        }
        const res = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
        if (res.response !== 1) return false
        for (const f of lmuFiles) await shell.trashItem(f)
        await worker.call('removeSession', { sessionId: id })
        return true
    })

    handle('dialog:save-text', async (event, suggestedName, content) => {
        if (typeof suggestedName !== 'string' || typeof content !== 'string') throw new Error('Invalid arguments')
        const win = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.SaveDialogOptions = { defaultPath: suggestedName }
        const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
        if (res.canceled || !res.filePath) return null
        await writeFile(res.filePath, content, 'utf8')
        return res.filePath
    })

    ipcMain.on(IpcSend.workerConnect, event => {
        if (!isTrustedRendererUrl(event.senderFrame?.url)) return
        worker.connectRenderer(event.sender)
    })
}
