/**
 * SQLite index schema. The index never stores raw telemetry — samples stay in
 * the .duckdb files; only metadata, lap summaries and an optional
 * distance-resampled trace cache live here.
 *
 * Migrations are append-only: never edit an entry once released, add a new one.
 */
export const MIGRATIONS: readonly string[] = [
    // v1
    `
    CREATE TABLE sessions (
        id              INTEGER PRIMARY KEY,
        file_path       TEXT    NOT NULL,
        file_hash       TEXT    NOT NULL UNIQUE,      -- sha256 of the .duckdb, dedupes copies/imports
        file_size       INTEGER NOT NULL,
        file_mtime_ms   INTEGER NOT NULL,
        origin          TEXT    NOT NULL CHECK (origin IN ('lmu', 'import')),
        archived_path   TEXT,                         -- copy under %APPDATA%, survives deletion of the original
        file_missing    INTEGER NOT NULL DEFAULT 0,
        status          TEXT    NOT NULL DEFAULT 'unparsed' CHECK (status IN ('unparsed', 'parsed', 'error')),
        parser_version  INTEGER NOT NULL DEFAULT 0,   -- re-parse rows below the current reader version
        error           TEXT,
        track           TEXT,
        track_layout    TEXT,
        car             TEXT,
        car_class       TEXT,
        driver          TEXT,
        session_type    TEXT,
        recorded_at     TEXT,
        setup_json      TEXT,
        lap_count       INTEGER,
        best_lap_ms     INTEGER,
        indexed_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX sessions_file_path ON sessions(file_path);
    CREATE INDEX sessions_track_car ON sessions(track, car);

    CREATE TABLE laps (
        id              INTEGER PRIMARY KEY,
        session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        lap_number      INTEGER NOT NULL,
        lap_time_ms     INTEGER,
        sector1_ms      INTEGER,
        sector2_ms      INTEGER,
        sector3_ms      INTEGER,
        is_valid        INTEGER NOT NULL DEFAULT 0,
        start_ts        REAL,                         -- session timestamps of the lap boundaries (s)
        end_ts          REAL,
        UNIQUE (session_id, lap_number)
    );

    -- One reference lap per track + car ("references" is an SQL keyword).
    CREATE TABLE reference_laps (
        track           TEXT    NOT NULL,
        car             TEXT    NOT NULL,
        lap_id          INTEGER NOT NULL REFERENCES laps(id) ON DELETE CASCADE,
        is_manual       INTEGER NOT NULL DEFAULT 0,
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (track, car)
    );

    CREATE TABLE notes (
        id              INTEGER PRIMARY KEY,
        session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        lap_id          INTEGER REFERENCES laps(id) ON DELETE CASCADE,
        body            TEXT    NOT NULL,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE tags (
        id              INTEGER PRIMARY KEY,
        name            TEXT    NOT NULL UNIQUE COLLATE NOCASE
    );

    CREATE TABLE session_tags (
        session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        tag_id          INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (session_id, tag_id)
    );

    CREATE TABLE settings (
        key             TEXT PRIMARY KEY,
        value           TEXT NOT NULL                 -- JSON
    );

    -- Optional cache of distance-resampled traces for fast comparisons.
    CREATE TABLE trace_cache (
        lap_id          INTEGER PRIMARY KEY REFERENCES laps(id) ON DELETE CASCADE,
        cache_version   INTEGER NOT NULL,
        step_m          REAL    NOT NULL,
        data            BLOB    NOT NULL,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    `,
    // v2: data from the telemetry reader (docs/SCHEMA.md)
    `
    ALTER TABLE sessions ADD COLUMN weather TEXT;
    ALTER TABLE sessions ADD COLUMN track_length_m REAL;
    ALTER TABLE laps ADD COLUMN kind TEXT NOT NULL DEFAULT 'lap' CHECK (kind IN ('lap', 'partial'));
    ALTER TABLE laps ADD COLUMN in_pits INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX laps_session ON laps(session_id);
    `,
    // v3: manifest of imported .rses/.rlap packages (original lap numbers)
    `
    ALTER TABLE sessions ADD COLUMN manifest_json TEXT;
    `,
    // v4: references can no longer be pinned; pinned ones return to the fastest valid lap
    `
    UPDATE reference_laps SET
        is_manual = 0,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        lap_id = COALESCE((
            SELECT l.id FROM laps l JOIN sessions s ON s.id = l.session_id
            WHERE COALESCE(s.track_layout, s.track) = reference_laps.track AND s.car = reference_laps.car
              AND l.kind = 'lap' AND l.is_valid = 1 AND l.lap_time_ms IS NOT NULL
            ORDER BY l.lap_time_ms, l.id LIMIT 1
        ), lap_id)
    WHERE is_manual = 1;
    `,
]
