import type { Store } from './store.ts'
import type { Ask, RateLimit, SessionState, Status } from './types.ts'

const LIMIT_LEVELS = [95, 80]
const WAKE_GAP_MS = 5_000
const WAKE_GRACE_MS = 30_000

export const BUSY: readonly Status[] = ['work', 'tests', 'ask']
export const FREE: readonly Status[] = ['waiting', 'chat']
export const LIMIT_NAMES: Record<string, string> = { five_hour: '5 годин', seven_day: '7 днів' }

export type SessionWithStatus = SessionState & { status: Status }

export type DetectedEvent =
  | { kind: 'ask'; session: SessionWithStatus; ask: Ask }
  | { kind: 'testsFailed' | 'testsPassed'; session: SessionWithStatus; workedMs: number }
  | { kind: 'turnError'; session: SessionWithStatus }
  | { kind: 'crashed'; session: SessionWithStatus }
  | { kind: 'lost'; session: SessionWithStatus }
  | { kind: 'done'; session: SessionWithStatus; workedMs: number; startedAt: number | null }
  | { kind: 'limit'; limit: RateLimit; level: number }

type Seen = {
  status: Status
  endedRunId: string | null
  hadError: boolean
  wasEnded: boolean
}

function minutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000))
}

export function letter(session: SessionState, status: string, workedMs: number | null = null): string {
  const details = [
    session.branch === null ? null : `Гілка ${session.branch}`,
    workedMs === null ? null : `працювала ${minutes(workedMs)} хв`,
    session.files.length === 0 ? null : `змінено файлів: ${session.files.length}`,
  ].filter(part => part !== null)

  return [
    `Проєкт: ${session.repoName}`,
    `Сесія: ${session.name}`,
    `Статус: ${status}`,
    ...(details.length === 0 ? [] : [details.join(' · ')]),
  ].join('\n')
}

export function askLabel(ask: Ask): string {
  if (ask.kind === 'question') {
    return 'чекає на відповідь (питання)'
  }

  return ask.tool === 'ExitPlanMode' ? 'чекає на відповідь (план)' : `чекає на відповідь (дозвіл на ${ask.tool})`
}

export function testsLabel(session: SessionState): string {
  const run = session.tests
  const progress = run?.progress ?? null

  if (run?.failed === true) {
    const counts = progress !== null && progress.total > 0 ? ` (упало ${progress.failed} з ${progress.total})` : ''

    return `тести впали${counts}`
  }

  return progress !== null && progress.total > 0 ? `тести пройшли (${progress.total})` : 'тести пройшли'
}

export class EventDetector {
  private readonly store: Store
  private readonly limitMarksKey: string
  private readonly seen = new Map<string, Seen>()
  private readonly seenAsks = new Set<string>()
  private isFirstTick = true
  private lastTickAt: number | null = null
  private quietUntil = 0

  constructor(store: Store, limitMarksKey: string) {
    this.store = store
    this.limitMarksKey = limitMarksKey
  }

  tick(
    at: number,
    sessions: readonly SessionWithStatus[],
    asks: readonly Ask[],
    limits: readonly RateLimit[],
  ): DetectedEvent[] {
    if (this.lastTickAt !== null && at - this.lastTickAt > WAKE_GAP_MS) {
      this.quietUntil = at + WAKE_GRACE_MS
    }

    this.lastTickAt = at

    const isWaking = at < this.quietUntil
    const events = [
      ...(this.isFirstTick ? [] : this.detectLimits(limits)),
      ...sessions.flatMap(session => this.detect(session, isWaking)),
      ...this.detectAsks(sessions, asks),
    ]

    this.isFirstTick = false

    return events
  }

  private detect(session: SessionWithStatus, isWaking: boolean): DetectedEvent[] {
    const previous = this.seen.get(session.id)
    const wasBusyBefore = previous !== undefined && BUSY.includes(previous.status)
    const isSilentAfterWake = isWaking && wasBusyBefore && session.status === 'offline' && session.endedAt === null

    if (isSilentAfterWake) {
      return []
    }
    const run = session.tests
    const endedRunId = run?.endedAt === null || run === null ? (previous?.endedRunId ?? null) : run.id
    const wasEnded = session.endedAt !== null

    this.seen.set(session.id, { status: session.status, endedRunId, hadError: session.turnError, wasEnded })

    if (previous === undefined) {
      return []
    }

    const events: DetectedEvent[] = []
    const wasBusy = BUSY.includes(previous.status)

    if (run !== null && endedRunId !== previous.endedRunId && run.failed !== null) {
      events.push({ kind: run.failed ? 'testsFailed' : 'testsPassed', session, workedMs: (run.endedAt as number) - run.startedAt })
    }

    if (session.turnError && !previous.hadError) {
      events.push({ kind: 'turnError', session })
    }

    if (wasEnded && !previous.wasEnded && session.endReason === 'process_gone' && wasBusy) {
      events.push({ kind: 'crashed', session })
    }

    if (!wasEnded && session.status === 'offline' && wasBusy) {
      events.push({ kind: 'lost', session })
    }

    const hasFinished = wasBusy && FREE.includes(session.status)

    if (hasFinished && session.turnEndReason === 'answer') {
      const workedMs = (session.lastTurnEndAt ?? 0) - (session.lastTurnStartAt ?? 0)

      events.push({ kind: 'done', session, workedMs, startedAt: session.lastTurnStartAt })
    }

    return events
  }

  private detectAsks(sessions: readonly SessionWithStatus[], asks: readonly Ask[]): DetectedEvent[] {
    const events: DetectedEvent[] = []

    for (const ask of asks) {
      if (this.seenAsks.has(ask.id)) {
        continue
      }

      this.seenAsks.add(ask.id)

      const session = sessions.find(candidate => candidate.id === ask.sessionId)

      if (!this.isFirstTick && session !== undefined) {
        events.push({ kind: 'ask', session, ask })
      }
    }

    return events
  }

  private detectLimits(limits: readonly RateLimit[]): DetectedEvent[] {
    const marks = JSON.parse(this.store.meta(this.limitMarksKey) ?? '{}') as Record<string, { resetsAt?: string; level: number }>
    const events: DetectedEvent[] = []

    for (const limit of limits) {
      const level = LIMIT_LEVELS.find(candidate => limit.percentUsed >= candidate)
      const mark = marks[limit.kind]
      const isSameWindow = mark?.resetsAt === limit.resetsAt

      if (level !== undefined && (!isSameWindow || (mark?.level ?? 0) < level)) {
        marks[limit.kind] = { resetsAt: limit.resetsAt, level }
        this.store.setMeta(this.limitMarksKey, JSON.stringify(marks))
        events.push({ kind: 'limit', limit, level })
      }
    }

    return events
  }
}
