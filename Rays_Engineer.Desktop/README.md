# Rays Engineer Desktop

Local-only Windows desktop app (Electron + electron-vite + React + TypeScript).
Replaces the former ASP.NET API, web app and tray uploader (see `../docs/LEGACY.md`).

## Commands

```bash
npm install
npm run dev        # electron-vite dev server + Electron with HMR
npm run build      # typecheck + production build into out/
npm start          # run the production build
npm run lint
npm test           # unit tests (vitest)
npm run smoke      # end-to-end smoke test of the build (pass an executable to test a packaged app)
npm run inspect-duckdb -- <file|folder>   # structural dump of .duckdb recordings
npm run dist:win   # NSIS installer into release/
```

The Windows installer is built and smoke-tested by `.github/workflows/tests.yml` (every PR)
and `.github/workflows/release.yml` (GitHub releases). Building it on Linux needs wine + wine32
**and** produces Linux native modules, so only use CI-built installers for real installs.

Native modules: `better-sqlite3` is pinned to 12.x because 13.x ships no Electron 38
prebuilds; `postinstall` (`electron-builder install-app-deps`) fetches the Electron build.
`@duckdb/node-api` uses Node-API and needs no rebuild.

## Build, test and debug on Windows

Requirements: [Node.js 22 LTS](https://nodejs.org) and Git. No Visual Studio / build tools —
the native modules come prebuilt.

```powershell
git clone https://github.com/xRayflx/Rays_Engineer.git
cd Rays_Engineer
cd Rays_Engineer.Desktop
npm install          # also downloads the Electron build of better-sqlite3
npm run dev          # starts the app with hot reload
```

| Task | Command |
|---|---|
| Run with hot reload | `npm run dev` — renderer changes reload instantly, main/worker changes restart the app |
| Production build, run it | `npm run build` then `npm start` |
| Unit tests (incl. real LMU samples in `../samples`) | `npm test` — one file: `npx vitest run src/worker/telemetry`, watch mode: `npx vitest` |
| End-to-end smoke test | `npm run smoke` (dev build) or `npm run smoke -- "release\win-unpacked\Rays Engineer.exe"` |
| Typecheck / lint | `npm run typecheck` / `npm run lint` |
| Installer | `npm run dist:win` → `release\Rays Engineer Setup <version>.exe` |
| Inspect a recording | `npm run inspect-duckdb -- "<path>\file.duckdb"` |

**Debugging**

- **UI (renderer):** `Ctrl+Shift+I` opens the Chromium DevTools in `npm run dev` (press `Alt`
  for the menu → View). React DevTools cannot be downloaded — the app blocks all network access.
- **Main process:** `npm run dev -- --inspect=9229`, then attach Chrome (`chrome://inspect`) or
  VS Code ("Attach to Node Process", port 9229).
- **Worker (DB, reader, analysis):** set `RAYS_WORKER_INSPECT` before starting, e.g.
  `$env:RAYS_WORKER_INSPECT=9230; npm run dev` (PowerShell), then attach to port 9230.
  `console.log` from main and worker appears in the terminal running `npm run dev`.
- **Data folder:** `%APPDATA%\Rays Engineer` — `index.sqlite` (index, readable with any SQLite
  viewer), `archive\`, `imports\`. Delete the folder to start from scratch (your LMU files are
  untouched).
- **Blocked requests** are logged as `[security] blocked request: …` in the terminal.

## Layout

| Path | Process | Purpose |
|---|---|---|
| `src/main/` | main | window, security policies, IPC handlers, worker host |
| `src/preload/` | preload (sandboxed) | exposes the typed `window.api` |
| `src/worker/` | utilityProcess | index DB, folder detection + watching, DuckDB reads |
| `src/worker/db/` | utilityProcess | SQLite index (better-sqlite3), append-only migrations |
| `src/worker/locate/` | utilityProcess | LMU telemetry folder detection (Steam libraries, Documents) |
| `src/worker/indexer/` | utilityProcess | watcher, "file finished writing" detection, hashing, archive |
| `src/worker/telemetry/` | utilityProcess | DuckDB reader: session metadata, lap segmentation, lap traces |
| `src/worker/analysis/` | utilityProcess | lap cleaning, corner detection (speed minima), distance resampling, time delta |
| `src/worker/analysis-service.ts` | utilityProcess | builds lap comparisons for the Analysis page (shared 2 m distance grid) |
| `src/worker/packages.ts` | utilityProcess | `.rses` / `.rlap` export and import (`src/shared/package.ts`) |
| `src/worker/recording.ts` | utilityProcess | read/write LMU's telemetry `config.json` (Recording page) |
| `src/worker/lmu-settings.ts` | utilityProcess | read/toggle "Automatically Record Telemetry" in `UserData\player\Settings.JSON` |
| `src/shared/` | all | IPC contract (`ipc.ts`) and worker RPC protocol (`worker-protocol.ts`) |
| `src/renderer/` | renderer | React UI |

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (plus `app.enableSandbox()`).
- Renderer is served from the custom `app://rays/` protocol with a strict CSP
  (`script-src 'self'`, no eval, no inline scripts).
- Network kill-switch: `session.webRequest.onBeforeRequest` cancels every request
  that is not `app://`, `data:`, `blob:` or `devtools:` (dev server only in `npm run dev`).
- Permissions denied, new windows denied, navigation outside the app blocked,
  spellchecker disabled (it would download dictionaries).
- Every IPC handler validates the sender frame URL.

## Data path

The renderer gets a direct `MessagePort` to the worker (brokered once by main via
`MessageChannelMain`). Traces travel as `Float32Array` via structured clone — binary,
never JSON — and bypass the main process.

## Index and folder watching

- The SQLite index (`<userData>/index.sqlite`) holds sessions, laps, reference laps,
  notes/tags, settings and an optional resampled trace cache — never raw samples.
- Telemetry folder: auto-detected from every Steam library in `libraryfolders.vdf`
  (Steam root from the registry) and `Documents\Le Mans Ultimate`; can be set manually.
- A recording is `<name>.duckdb` plus its `<name>.duckdb.wal` — LMU leaves the WAL in place
  after the session (see `docs/SCHEMA.md`). New recordings are indexed once the combined
  size/mtime of both files has been stable for 10 s and the file can be opened.
  Sessions are deduplicated by SHA-256 over both files.
- Optional archive copies each recording (both files) to `<userData>/archive/<sha256>.duckdb[.wal]`.
- The telemetry reader (`src/worker/telemetry/`) parses every new recording in the worker:
  metadata, car setup, laps segmented at finish-line crossings with LMU's official lap
  times/validity and sector times (see `docs/SCHEMA.md`). Recordings with a WAL are read
  from a temporary copy so LMU's files are never modified. `READER_VERSION` bumps re-parse
  existing sessions.
- Reference lap per track + car: fastest valid lap automatically, or pinned by the user.

## Product decisions

- UI language: English only.
- Analysis views: keep every view of the web app that works sensibly with LMU data
  (decided per view once real recordings are available). AI coach is dropped.
- Telemetry config generator stays (Recording page) and writes `config.json` straight
  into the telemetry folder. The Recording page also switches LMU's
  "Automatically Record Telemetry" (exactly one value in `Settings.JSON` is changed, original backed up once).
- Reference lap: best valid lap per track + car, user can override.
- `.rlap`: original timestamps are kept unchanged; the lap start/end is stored in the manifest.
- `samples/` with real recordings stays in the repo as test fixtures.

## Analysis

`analyseLaps` (worker) reads each lap at 50 Hz, resamples it onto an absolute distance
grid (2 m steps from the finish line) and returns typed arrays for the charts, the time
delta to the reference lap, map coordinates, detected corners and any extra channels the
user added. The renderer draws them with uPlot; cursor and zoom are shared through
`lib/analysisStore.ts`.

Per-lap results (resampled core traces, corners, channel list) are cached in SQLite
(`trace_cache`, encoding in `src/worker/trace-cache.ts`), so reopening a comparison needs
no DuckDB access. Rows are tied to laps and disappear when a session is re-parsed or
deleted; bump `TRACE_CACHE_VERSION` when the cached computation changes.

## Deleting sessions

`session:delete` (main process) asks the worker which files belong to the session,
confirms with a native dialog, moves LMU's own recording (`.duckdb` + `.wal`) to the
**Recycle Bin** and lets the worker delete the app's copies (imports, archive) and the
index rows. The renderer only passes the session id.

## Packages

- `.rses`: ZIP with `manifest.json` + the original recording (`recording.duckdb`, plus
  `recording.duckdb.wal` if present).
- `.rlap`: ZIP with `manifest.json` + a small recording containing only the lap's time
  window, in LMU's schema with 16 KB blocks. The window starts a whole number of seconds
  after the recording start so all channels stay aligned (`t0 + rowid / frequency`); event
  tables get a state row at the window start; timestamps are LMU's originals. The manifest
  stores the lap's start/end and number.
- Import (`.rses`, `.rlap`, `.duckdb`) copies into `<userData>/imports/<sha256>.duckdb`,
  deduplicates by content hash and indexes the result like any LMU recording.
