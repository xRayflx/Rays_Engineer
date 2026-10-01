import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcPush, IpcSend, WORKER_PORT_MESSAGE, type InvokeChannel, type IpcInvokeMap, type RaysApi } from '../shared/ipc'

function invoke<C extends InvokeChannel>(channel: C, ...args: IpcInvokeMap[C]['args']): Promise<IpcInvokeMap[C]['result']> {
    return ipcRenderer.invoke(channel, ...args)
}

// MessagePorts cannot cross the context bridge, so hand them to the page via
// window.postMessage (the pattern recommended by the Electron docs).
ipcRenderer.on(IpcPush.workerPort, event => {
    window.postMessage({ type: WORKER_PORT_MESSAGE }, '*', event.ports)
})

const api: RaysApi = {
    app: {
        getInfo: () => invoke('app:get-info'),
    },
    dialog: {
        pickFolder: defaultPath => invoke('dialog:pick-folder', defaultPath),
        pickDuckDb: () => invoke('dialog:pick-duckdb'),
        saveText: (suggestedName, content) => invoke('dialog:save-text', suggestedName, content),
        savePackage: (suggestedName, format) => invoke('dialog:save-package', suggestedName, format),
        pickImport: () => invoke('dialog:pick-import'),
    },
    sessions: {
        delete: sessionId => invoke('session:delete', sessionId),
    },
    files: {
        pathFor: file => webUtils.getPathForFile(file),
    },
    worker: {
        status: () => invoke('worker:status'),
        requestPort: () => ipcRenderer.send(IpcSend.workerConnect),
    },
}

contextBridge.exposeInMainWorld('api', api)
