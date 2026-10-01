import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import {
    APP_ORIGIN,
    DEV_SERVER_URL,
    applySecurityPolicies,
    registerAppProtocol,
    registerPrivilegedSchemes,
} from './security'
import { WorkerHost } from './worker-host'

const worker = new WorkerHost()

app.enableSandbox()
registerPrivilegedSchemes()

if (!app.requestSingleInstanceLock()) {
    app.quit()
} else {
    app.on('second-instance', () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
            if (win.isMinimized()) win.restore()
            win.focus()
        }
    })

    app.whenReady().then(() => {
        applySecurityPolicies()
        registerAppProtocol(join(__dirname, '../renderer'))
        if (app.isPackaged) Menu.setApplicationMenu(null)

        worker.start()
        registerIpc(worker)
        createWindow()

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow()
        })
    })

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit()
    })

    app.on('before-quit', () => worker.stop())
}

function createWindow(): void {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        show: false,
        backgroundColor: '#0a0a0f',
        autoHideMenuBar: true,
        title: 'Rays Engineer',
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            spellcheck: false,
        },
    })

    win.once('ready-to-show', () => win.show())

    if (DEV_SERVER_URL) win.loadURL(DEV_SERVER_URL)
    else win.loadURL(`${APP_ORIGIN}/index.html`)
}
