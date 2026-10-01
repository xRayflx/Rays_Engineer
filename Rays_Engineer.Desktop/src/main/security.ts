/**
 * Security hardening: custom app:// protocol with CSP, a network kill-switch
 * and lockdown of permissions, navigation and new windows.
 * The app must never talk to the network — every request that is not the
 * bundled renderer (or the local dev server during `npm run dev`) is cancelled.
 */
import { app, net, protocol, session, type Session } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const APP_SCHEME = 'app'
export const APP_HOST = 'rays'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

/** Dev server URL injected by electron-vite in `dev` mode; undefined in production. */
export const DEV_SERVER_URL = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined

const PROD_CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ')

// Vite's dev server needs inline scripts (React refresh preamble) and a websocket for HMR.
function devCsp(devUrl: string): string {
    const origin = new URL(devUrl).origin
    const ws = origin.replace(/^http/, 'ws')
    return PROD_CSP
        .replace("script-src 'self'", `script-src 'self' 'unsafe-inline' ${origin}`)
        .replace("connect-src 'self'", `connect-src 'self' ${origin} ${ws}`)
}

/** Must run before app 'ready'. */
export function registerPrivilegedSchemes(): void {
    protocol.registerSchemesAsPrivileged([
        { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    ])
}

/** Serves the built renderer from out/renderer under app://rays/. */
export function registerAppProtocol(rendererDir: string): void {
    const root = normalize(rendererDir)
    protocol.handle(APP_SCHEME, async request => {
        const url = new URL(request.url)
        if (url.host !== APP_HOST) return new Response('Not found', { status: 404 })

        const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
        const filePath = normalize(join(root, relative))
        if (filePath !== root && !filePath.startsWith(root + sep))
            return new Response('Forbidden', { status: 403 })

        const file = await net.fetch(pathToFileURL(filePath).toString())
        const headers = new Headers(file.headers)
        headers.set('Content-Security-Policy', PROD_CSP)
        headers.set('X-Content-Type-Options', 'nosniff')
        return new Response(file.body, { status: file.status, headers })
    })
}

function isAllowedUrl(raw: string): boolean {
    let url: URL
    try { url = new URL(raw) } catch { return false }

    switch (url.protocol) {
        case `${APP_SCHEME}:`: return url.host === APP_HOST
        case 'devtools:':
        case 'data:':
        case 'blob:':
            return true
    }
    if (DEV_SERVER_URL) {
        const dev = new URL(DEV_SERVER_URL)
        if ((url.protocol === 'http:' || url.protocol === 'ws:') && url.host === dev.host) return true
    }
    return false
}

/** True if the URL belongs to our own renderer (used to validate IPC senders). */
export function isTrustedRendererUrl(raw: string | undefined): boolean {
    if (!raw) return false
    if (raw.startsWith(`${APP_ORIGIN}/`)) return true
    return !!DEV_SERVER_URL && raw.startsWith(DEV_SERVER_URL)
}

function hardenSession(ses: Session): void {
    ses.webRequest.onBeforeRequest((details, callback) => {
        const allowed = isAllowedUrl(details.url)
        if (!allowed) console.warn(`[security] blocked request: ${details.url}`)
        callback({ cancel: !allowed })
    })

    if (DEV_SERVER_URL) {
        const csp = devCsp(DEV_SERVER_URL)
        ses.webRequest.onHeadersReceived((details, callback) => {
            callback({
                responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
            })
        })
    }

    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    // Chromium's spellchecker downloads dictionaries from the network.
    ses.setSpellCheckerEnabled(false)
}

export function applySecurityPolicies(): void {
    hardenSession(session.defaultSession)

    app.on('web-contents-created', (_e, contents) => {
        contents.setWindowOpenHandler(() => ({ action: 'deny' }))
        contents.on('will-navigate', (event, url) => {
            if (!isTrustedRendererUrl(url)) event.preventDefault()
        })
        contents.on('will-redirect', (event, url) => {
            if (!isTrustedRendererUrl(url)) event.preventDefault()
        })
        contents.on('will-attach-webview', event => event.preventDefault())
    })
}
