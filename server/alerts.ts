import { randomUUID } from 'node:crypto'
import { askLabel, EventDetector, LIMIT_NAMES, testsLabel } from './events.ts'
import type { DetectedEvent, SessionWithStatus } from './events.ts'
import type { Store } from './store.ts'
import { MAC_EVENTS } from './types.ts'
import type { Alert, Ask, MacEvent, RateLimit } from './types.ts'

export { MAC_EVENTS } from './types.ts'
export type { Alert, MacEvent } from './types.ts'

const SETTINGS_KEY = 'macAlerts'
const LIMIT_MARKS_KEY = 'macAlertLimits'

export type MacAlertSettings = {
  enabled: boolean
  events: Record<MacEvent, boolean>
}

export type Viewing = {
  sessionIds: ReadonlySet<string>
  isAnyPanelVisible: boolean
}

type Draft = Omit<Alert, 'id' | 'createdAt' | 'readAt'>

function defaultSettings(): MacAlertSettings {
  return {
    enabled: true,
    events: Object.fromEntries(MAC_EVENTS.map(event => [event, event !== 'limit'])) as Record<MacEvent, boolean>,
  }
}

function sessionDraft(session: SessionWithStatus, event: MacEvent, body: string, askId: string | null = null): Draft {
  return { sessionId: session.id, event, title: `${session.repoName} · ${session.name}`, body, askId }
}

function draftFor(event: DetectedEvent): Draft | null {
  switch (event.kind) {
    case 'ask':
      return event.ask.kind === 'question'
        ? sessionDraft(event.session, 'question', 'питає тебе', event.ask.id)
        : sessionDraft(event.session, 'permission', askLabel(event.ask), event.ask.id)
    case 'done': {
      const count = event.session.files.length

      return sessionDraft(event.session, 'done', count === 0 ? 'завершила роботу' : `завершила роботу, змінено файлів: ${count}`)
    }
    case 'turnError':
      return sessionDraft(event.session, 'turnError', 'хід завершився помилкою')
    case 'testsFailed':
      return sessionDraft(event.session, 'testsFailed', testsLabel(event.session))
    case 'crashed':
    case 'lost':
      return sessionDraft(event.session, 'gone', 'сесія зникла під час роботи')
    case 'limit':
      return {
        sessionId: null,
        event: 'limit',
        title: `Ліміт ${LIMIT_NAMES[event.limit.kind] ?? event.limit.kind}`,
        body: `використано ${Math.round(event.limit.percentUsed)}%`,
        askId: null,
      }
    case 'testsPassed':
      return null
  }
}

export class MacAlerts {
  private readonly store: Store
  private readonly detector: EventDetector

  constructor(store: Store) {
    this.store = store
    this.detector = new EventDetector(store, LIMIT_MARKS_KEY)
  }

  settings(): MacAlertSettings {
    const stored = JSON.parse(this.store.meta(SETTINGS_KEY) ?? '{}') as Partial<MacAlertSettings>
    const defaults = defaultSettings()

    return { enabled: stored.enabled ?? defaults.enabled, events: { ...defaults.events, ...stored.events } }
  }

  update(changes: { enabled?: boolean; events?: Partial<Record<MacEvent, boolean>> }): MacAlertSettings {
    const current = this.settings()
    const settings = { enabled: changes.enabled ?? current.enabled, events: { ...current.events, ...changes.events } }

    this.store.setMeta(SETTINGS_KEY, JSON.stringify(settings))

    return settings
  }

  tick(
    at: number,
    sessions: readonly SessionWithStatus[],
    asks: readonly Ask[],
    limits: readonly RateLimit[],
    viewing: Viewing,
  ): { created: Alert[]; changed: boolean } {
    const settings = this.settings()
    const created: Alert[] = []

    for (const event of this.detector.tick(at, sessions, asks, limits)) {
      const draft = draftFor(event)
      const isWanted = draft !== null && settings.enabled && settings.events[draft.event]
      const isInView = draft?.sessionId != null && viewing.sessionIds.has(draft.sessionId)

      if (draft !== null && isWanted && !isInView) {
        const alert: Alert = { ...draft, id: randomUUID(), createdAt: at, readAt: null }

        this.store.addAlert(alert)
        created.push(alert)
      }
    }

    const read = this.store.markAlertsRead(this.settled(sessions, asks), at)

    return { created, changed: created.length > 0 || read > 0 }
  }

  markViewed(viewing: Viewing, at: number): boolean {
    const ids = this.unread()
      .filter(alert => (alert.sessionId === null ? viewing.isAnyPanelVisible : viewing.sessionIds.has(alert.sessionId)))
      .map(alert => alert.id)

    return this.store.markAlertsRead(ids, at) > 0
  }

  unread(): Alert[] {
    return this.store.unreadAlerts()
  }

  private settled(sessions: readonly SessionWithStatus[], asks: readonly Ask[]): string[] {
    const pending = new Set(asks.map(ask => ask.id))
    const byId = new Map(sessions.map(session => [session.id, session]))

    return this.unread()
      .filter(alert => {
        if (alert.sessionId === null) {
          return false
        }

        const session = byId.get(alert.sessionId)
        const isAskClosed = alert.askId !== null && !pending.has(alert.askId)
        const hasNewTurn = (session?.lastTurnStartAt ?? 0) > alert.createdAt

        return session === undefined || isAskClosed || hasNewTurn
      })
      .map(alert => alert.id)
  }
}
