import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue, StatementSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { blankSession } from './ingest.ts'
import type {
  Alert,
  Ask,
  AskKind,
  AskStatus,
  OutboxItem,
  OutboxStatus,
  Row,
  SessionCommand,
  SessionState,
  Status,
  TestRun,
} from './types.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  last_seen_at INTEGER NOT NULL,
  ended_at INTEGER,
  state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rows (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  uuid TEXT NOT NULL UNIQUE,
  ts INTEGER NOT NULL,
  agent_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  tool TEXT,
  tool_use_id TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  via_panel INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rows_by_session ON rows (session_id, seq);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_by_session ON outbox (session_id, status, created_at);
CREATE TABLE IF NOT EXISTS asks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT NOT NULL,
  agent_id TEXT,
  answerable INTEGER NOT NULL,
  blocked_by TEXT,
  status TEXT NOT NULL,
  answer TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS asks_by_status ON asks (status, session_id);
CREATE TABLE IF NOT EXISTS status_log (
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS status_log_by_time ON status_log (ts);
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS test_runs_by_time ON test_runs (started_at);
CREATE TABLE IF NOT EXISTS session_commands (
  session_id TEXT PRIMARY KEY,
  list TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  event TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  ask_id TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS alerts_by_read ON alerts (read_at, created_at);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

const RETENTION_DAYS = 14

type RawRow = {
  seq: number
  session_id: string
  uuid: string
  ts: number
  agent_id: string | null
  kind: Row['kind']
  text: string
  tool: string | null
  tool_use_id: string | null
  is_error: number
  via_panel: number
}

type RawOutbox = {
  id: string
  session_id: string
  kind: OutboxItem['kind']
  text: string
  status: OutboxStatus
  reason: string | null
  created_at: number
  updated_at: number
}

type RawAsk = {
  id: string
  session_id: string
  kind: AskKind
  tool: string
  summary: string
  detail: string
  agent_id: string | null
  answerable: number
  blocked_by: string | null
  status: AskStatus
  answer: string | null
  created_at: number
  updated_at: number
}

type RawAlert = {
  id: string
  session_id: string | null
  event: Alert['event']
  title: string
  body: string
  ask_id: string | null
  created_at: number
  read_at: number | null
}

export type NewRow = Omit<Row, 'seq'>

export class Store {
  readonly sessions = new Map<string, SessionState>()

  private readonly db: DatabaseSync
  private readonly dirty = new Set<string>()
  private readonly lastStatus = new Map<string, Status>()
  private readonly statements = new Map<string, StatementSync>()
  private latestChecksCache: TestRun[] | null = null

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    this.db.exec(SCHEMA)
    this.loadSessions()
  }

  close(): void {
    this.flush()
    this.db.close()
  }

  touch(session: SessionState): void {
    this.dirty.add(session.id)
  }

  flush(): void {
    for (const id of this.dirty) {
      const session = this.sessions.get(id)

      if (session !== undefined) {
        this.run(
          `INSERT INTO sessions (id, last_seen_at, ended_at, state) VALUES (?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET last_seen_at = excluded.last_seen_at,
             ended_at = excluded.ended_at, state = excluded.state`,
          id,
          session.lastSeenAt,
          session.endedAt,
          JSON.stringify(session),
        )
      }
    }

    this.dirty.clear()
  }

  addRow(row: NewRow): Row | null {
    const inserted = this.get<{ seq: number }>(
      `INSERT INTO rows (session_id, uuid, ts, agent_id, kind, text, tool, tool_use_id, is_error, via_panel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (uuid) DO NOTHING
       RETURNING seq`,
      row.sessionId,
      row.uuid,
      row.ts,
      row.agentId,
      row.kind,
      row.text,
      row.tool,
      row.toolUseId,
      row.isError ? 1 : 0,
      row.viaPanel ? 1 : 0,
    )

    return inserted === undefined ? null : { ...row, seq: inserted.seq }
  }

  rows(sessionId: string, limit: number, beforeSeq?: number): Row[] {
    const rows = this.all<RawRow>(
      `SELECT * FROM rows WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`,
      sessionId,
      beforeSeq ?? Number.MAX_SAFE_INTEGER,
      limit,
    )

    return rows.reverse().map(toRow)
  }

  enqueue(sessionId: string, kind: OutboxItem['kind'], text: string, now: number): OutboxItem {
    const id = randomUUID()

    this.run(
      `INSERT INTO outbox (id, session_id, kind, text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
      id,
      sessionId,
      kind,
      text,
      now,
      now,
    )

    return this.outboxItem(id) as OutboxItem
  }

  claimNext(sessionId: string, now: number, isIdle: boolean | null): OutboxItem | null {
    const kinds = isIdle === null
      ? ['message', 'abort']
      : isIdle
        ? ['message', 'bash', 'abort', 'inject', 'interrupt']
        : ['abort', 'inject', 'interrupt']
    const next = this.all<RawOutbox>(
      `SELECT * FROM outbox WHERE session_id = ? AND status = 'queued' ORDER BY kind IN ('message', 'bash'), created_at`,
      sessionId,
    ).find(item => kinds.includes(item.kind))

    if (next === undefined) {
      return null
    }

    this.run(`UPDATE outbox SET status = 'claimed', updated_at = ? WHERE id = ?`, now, next.id)

    return { ...toOutbox(next), status: 'claimed', updatedAt: now }
  }

  cancelQueued(id: string, now: number): OutboxItem | null {
    const changed = this.run(
      `UPDATE outbox SET status = 'dismissed', updated_at = ? WHERE id = ? AND status = 'queued'`,
      now,
      id,
    ).changes

    return Number(changed) === 0 ? null : this.outboxItem(id)
  }

  forceQueued(id: string, kind: 'inject' | 'interrupt', now: number): OutboxItem | null {
    const changed = this.run(
      `UPDATE outbox SET kind = ?, updated_at = ? WHERE id = ? AND status = 'queued' AND kind = 'message'`,
      kind,
      now,
      id,
    ).changes

    return Number(changed) === 0 ? null : this.outboxItem(id)
  }

  saveCommands(sessionId: string, list: readonly SessionCommand[]): void {
    this.run(
      `INSERT INTO session_commands (session_id, list) VALUES (?, ?)
       ON CONFLICT (session_id) DO UPDATE SET list = excluded.list`,
      sessionId,
      JSON.stringify(list),
    )
  }

  commands(sessionId: string): SessionCommand[] {
    const raw = this.get<{ list: string }>(`SELECT list FROM session_commands WHERE session_id = ?`, sessionId)

    return raw === undefined ? [] : (JSON.parse(raw.list) as SessionCommand[])
  }

  settleOutbox(id: string, status: OutboxStatus, reason: string | null, now: number): OutboxItem | null {
    this.run(
      `UPDATE outbox SET status = ?, reason = ?, updated_at = ? WHERE id = ?`,
      status,
      reason,
      now,
      id,
    )

    return this.outboxItem(id)
  }

  outboxItem(id: string): OutboxItem | null {
    const raw = this.get<RawOutbox>(`SELECT * FROM outbox WHERE id = ?`, id)

    return raw === undefined ? null : toOutbox(raw)
  }

  outboxFor(sessionId: string, limit: number): OutboxItem[] {
    return this.all<RawOutbox>(
      `SELECT * FROM outbox WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
      sessionId,
      limit,
    )
      .reverse()
      .map(toOutbox)
  }

  createAsk(ask: Omit<Ask, 'status' | 'answer' | 'createdAt' | 'updatedAt'>, now: number): Ask {
    this.run(
      `INSERT INTO asks (id, session_id, kind, tool, summary, detail, agent_id, answerable, blocked_by,
                         status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      ask.id,
      ask.sessionId,
      ask.kind,
      ask.tool,
      ask.summary,
      ask.detail,
      ask.agentId,
      ask.answerable ? 1 : 0,
      ask.blockedBy,
      now,
      now,
    )

    return this.ask(ask.id) as Ask
  }

  ask(id: string): Ask | null {
    const raw = this.get<RawAsk>(`SELECT * FROM asks WHERE id = ?`, id)

    return raw === undefined ? null : toAsk(raw)
  }

  pendingAsks(): Ask[] {
    return this.all<RawAsk>(`SELECT * FROM asks WHERE status = 'pending' ORDER BY created_at`).map(toAsk)
  }

  closeAsk(id: string, status: AskStatus, answer: unknown, now: number): Ask | null {
    this.run(
      `UPDATE asks SET status = ?, answer = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
      status,
      answer === undefined ? null : JSON.stringify(answer),
      now,
      id,
    )

    return this.ask(id)
  }

  logStatus(sessionId: string, status: Status, now: number): boolean {
    if (this.lastStatus.get(sessionId) === status) {
      return false
    }

    this.lastStatus.set(sessionId, status)
    this.run(`INSERT INTO status_log (session_id, ts, status) VALUES (?, ?, ?)`, sessionId, now, status)

    return true
  }

  statusLog(since: number): { sessionId: string; ts: number; status: Status }[] {
    return this.all<{ session_id: string; ts: number; status: Status }>(
      `SELECT session_id, ts, status FROM status_log WHERE ts >= ? ORDER BY ts`,
      since,
    ).map(entry => ({ sessionId: entry.session_id, ts: entry.ts, status: entry.status }))
  }

  saveTestRun(run: TestRun): void {
    this.run(
      `INSERT INTO test_runs (id, session_id, started_at, state) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET state = excluded.state`,
      run.id,
      run.sessionId,
      run.startedAt,
      JSON.stringify(run),
    )
    this.latestChecksCache = null
  }

  latestChecks(): TestRun[] {
    if (this.latestChecksCache === null) {
      const latest = new Map<string, TestRun>()

      for (const run of this.testRuns(500)) {
        const key = `${run.repoRoot}\u0000${run.kind ?? 'tests'}`

        if (!latest.has(key)) {
          latest.set(key, run)
        }
      }

      this.latestChecksCache = [...latest.values()]
    }

    return this.latestChecksCache
  }

  testRuns(limit: number): TestRun[] {
    return this.all<{ state: string }>(`SELECT state FROM test_runs ORDER BY started_at DESC LIMIT ?`, limit).map(
      row => JSON.parse(row.state) as TestRun,
    )
  }

  addAlert(alert: Alert): void {
    this.run(
      `INSERT INTO alerts (id, session_id, event, title, body, ask_id, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      alert.id,
      alert.sessionId,
      alert.event,
      alert.title,
      alert.body,
      alert.askId,
      alert.createdAt,
      alert.readAt,
    )
  }

  unreadAlerts(limit = 100): Alert[] {
    return this.all<RawAlert>(
      `SELECT * FROM alerts WHERE read_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      limit,
    ).map(raw => ({
      id: raw.id,
      sessionId: raw.session_id,
      event: raw.event,
      title: raw.title,
      body: raw.body,
      askId: raw.ask_id,
      createdAt: raw.created_at,
      readAt: raw.read_at,
    }))
  }

  markAlertsRead(ids: readonly string[], at: number): number {
    let count = 0

    for (const id of ids) {
      count += Number(this.run(`UPDATE alerts SET read_at = ? WHERE id = ? AND read_at IS NULL`, at, id).changes)
    }

    return count
  }

  meta(key: string): string | null {
    return this.get<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key)?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    )
  }

  prune(now: number): void {
    const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000

    this.run(`DELETE FROM rows WHERE ts < ?`, cutoff)
    this.run(`DELETE FROM status_log WHERE ts < ?`, cutoff)
    this.run(`DELETE FROM test_runs WHERE started_at < ?`, cutoff)
    this.run(`DELETE FROM outbox WHERE updated_at < ?`, cutoff)
    this.run(`DELETE FROM asks WHERE updated_at < ?`, cutoff)
    this.run(`DELETE FROM alerts WHERE created_at < ?`, cutoff)
    this.run(`DELETE FROM sessions WHERE last_seen_at < ?`, cutoff)
    this.run(`DELETE FROM session_commands WHERE session_id NOT IN (SELECT id FROM sessions)`)

    for (const [id, session] of this.sessions) {
      if (session.lastSeenAt < cutoff) {
        this.sessions.delete(id)
      }
    }
  }

  private loadSessions(): void {
    const raw = this.all<{ state: string }>(`SELECT state FROM sessions`)

    for (const { state } of raw) {
      const stored = JSON.parse(state) as SessionState

      this.sessions.set(stored.id, { ...blankSession(stored.id, stored.startedAt), ...stored })
    }
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql)

    if (statement === undefined) {
      statement = this.db.prepare(sql)
      this.statements.set(sql, statement)
    }

    return statement
  }

  private run(sql: string, ...params: SQLInputValue[]) {
    return this.statement(sql).run(...params)
  }

  private get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.statement(sql).get(...params) as T | undefined
  }

  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.statement(sql).all(...params) as T[]
  }
}

function toRow(raw: RawRow): Row {
  return {
    seq: raw.seq,
    sessionId: raw.session_id,
    uuid: raw.uuid,
    ts: raw.ts,
    agentId: raw.agent_id,
    kind: raw.kind,
    text: raw.text,
    tool: raw.tool,
    toolUseId: raw.tool_use_id,
    isError: raw.is_error === 1,
    viaPanel: raw.via_panel === 1,
  }
}

function toOutbox(raw: RawOutbox): OutboxItem {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    kind: raw.kind,
    text: raw.text,
    status: raw.status,
    reason: raw.reason,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function toAsk(raw: RawAsk): Ask {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    kind: raw.kind,
    tool: raw.tool,
    summary: raw.summary,
    detail: raw.detail,
    agentId: raw.agent_id,
    answerable: raw.answerable === 1,
    blockedBy: raw.blocked_by,
    status: raw.status,
    answer: raw.answer === null ? null : JSON.parse(raw.answer),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}
