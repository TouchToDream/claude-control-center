import type { Store } from './store.ts'
import type { Secrets } from './secrets.ts'
import { TelegramError } from './telegram.ts'
import type { TelegramApi } from './telegram.ts'
import type { Ask, RateLimit, SessionState, Status } from './types.ts'

const SETTINGS_KEY = 'telegram'
const LIMIT_MARKS_KEY = 'telegramLimits'
const WAIT_BEFORE_SENDING_MS = 45_000
const LONG_TURN_MS = 2 * 60_000
const LIMIT_LEVELS = [95, 80]
const QUEUE_LIMIT = 50
const BUSY: readonly Status[] = ['work', 'tests', 'ask']
const FREE: readonly Status[] = ['waiting', 'chat']

export const NOTIFY_EVENTS = ['ask', 'testsFailed', 'turnError', 'crashed', 'done', 'testsPassed', 'limit'] as const

export type NotifyEvent = (typeof NOTIFY_EVENTS)[number]

const LOUD_EVENTS: ReadonlySet<NotifyEvent> = new Set(['ask', 'testsFailed', 'turnError', 'crashed'])

const LIMIT_NAMES: Record<string, string> = { five_hour: '5 годин', seven_day: '7 днів' }

export type TelegramSettings = {
  enabled: boolean
  chatId: string | null
  chatTitle: string | null
  botName: string | null
  events: Record<NotifyEvent, boolean>
  projects: string[]
}

export type SessionWithStatus = SessionState & { status: Status }

type Seen = {
  status: Status
  endedRunId: string | null
  hadError: boolean
  wasEnded: boolean
}

type Pending = {
  event: NotifyEvent
  repoRoot: string | null
  text: string
  dueAt: number
  isStale: () => boolean
}

function defaultSettings(): TelegramSettings {
  return {
    enabled: false,
    chatId: null,
    chatTitle: null,
    botName: null,
    events: Object.fromEntries(NOTIFY_EVENTS.map(event => [event, true])) as Record<NotifyEvent, boolean>,
    projects: [],
  }
}

function minutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000))
}

function letter(session: SessionState, status: string, workedMs: number | null = null): string {
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

function askLabel(ask: Ask): string {
  if (ask.kind === 'question') {
    return 'чекає на відповідь (питання)'
  }

  return ask.tool === 'ExitPlanMode' ? 'чекає на відповідь (план)' : `чекає на відповідь (дозвіл на ${ask.tool})`
}

function testsLabel(session: SessionState): string {
  const run = session.tests
  const progress = run?.progress ?? null

  if (run?.failed === true) {
    const counts = progress !== null && progress.total > 0 ? ` (упало ${progress.failed} з ${progress.total})` : ''

    return `тести впали${counts}`
  }

  return progress !== null && progress.total > 0 ? `тести пройшли (${progress.total})` : 'тести пройшли'
}

export type NotifierOptions = {
  store: Store
  api: TelegramApi
  secrets: Secrets
}

export class Notifier {
  private readonly store: Store
  private readonly api: TelegramApi
  private readonly secrets: Secrets
  private readonly seen = new Map<string, Seen>()
  private readonly seenAsks = new Set<string>()
  private queue: Pending[] = []
  private isFirstTick = true
  private isSending = false
  private blockedUntil = 0
  private lastError: string | null = null

  constructor(options: NotifierOptions) {
    this.store = options.store
    this.api = options.api
    this.secrets = options.secrets
  }

  settings(): TelegramSettings {
    const stored = JSON.parse(this.store.meta(SETTINGS_KEY) ?? '{}') as Partial<TelegramSettings>
    const defaults = defaultSettings()

    return { ...defaults, ...stored, events: { ...defaults.events, ...stored.events } }
  }

  update(changes: Partial<TelegramSettings>): TelegramSettings {
    const settings = { ...this.settings(), ...changes }

    this.store.setMeta(SETTINGS_KEY, JSON.stringify(settings))

    return settings
  }

  setProject(repoRoot: string, isEnabled: boolean): TelegramSettings {
    const others = this.settings().projects.filter(project => project !== repoRoot)

    return this.update({ projects: isEnabled ? [...others, repoRoot] : others })
  }

  isReady(): boolean {
    const { chatId, botName } = this.settings()

    return chatId !== null && botName !== null
  }

  view(): TelegramSettings & { isReady: boolean; lastError: string | null } {
    return { ...this.settings(), isReady: this.isReady(), lastError: this.lastError }
  }

  async sendTest(): Promise<void> {
    const { chatId } = this.settings()
    const token = await this.secrets.readToken()

    if (token === null || chatId === null) {
      throw new TelegramError('Спершу вкажи бота й чат')
    }

    await this.api.send(token, chatId, 'Центр керування: тестове повідомлення. Сповіщення налаштовано.', false)
    this.lastError = null
  }

  tick(at: number, sessions: readonly SessionWithStatus[], asks: readonly Ask[], limits: readonly RateLimit[]): void {
    const settings = this.settings()

    if (!this.isFirstTick) {
      this.detectLimits(at, settings, limits)
    }

    for (const session of sessions) {
      this.detect(at, session, settings)
    }

    this.detectAsks(at, sessions, asks, settings)
    this.isFirstTick = false

    void this.flush(at, settings).catch(() => {})
  }

  private isWatched(settings: TelegramSettings, repoRoot: string | null): boolean {
    return settings.enabled && (repoRoot === null || settings.projects.includes(repoRoot))
  }

  private enqueue(settings: TelegramSettings, item: Pending): void {
    if (this.isWatched(settings, item.repoRoot) && settings.events[item.event]) {
      this.queue = [...this.queue, item].slice(-QUEUE_LIMIT)
    }
  }

  private detect(at: number, session: SessionWithStatus, settings: TelegramSettings): void {
    const previous = this.seen.get(session.id)
    const run = session.tests
    const endedRunId = run?.endedAt === null || run === null ? (previous?.endedRunId ?? null) : run.id
    const wasEnded = session.endedAt !== null

    this.seen.set(session.id, { status: session.status, endedRunId, hadError: session.turnError, wasEnded })

    if (previous === undefined) {
      return
    }

    const add = (event: NotifyEvent, status: string, dueAt = at, isStale = () => false, workedMs: number | null = null) =>
      this.enqueue(settings, {
        event,
        repoRoot: session.repoRoot,
        text: letter(session, status, workedMs),
        dueAt,
        isStale,
      })

    if (run !== null && endedRunId !== previous.endedRunId && run.failed !== null) {
      add(run.failed ? 'testsFailed' : 'testsPassed', testsLabel(session), at, () => false, (run.endedAt as number) - run.startedAt)
    }

    if (session.turnError && !previous.hadError) {
      add('turnError', 'хід завершився помилкою')
    }

    if (wasEnded && !previous.wasEnded && session.endReason === 'process_gone' && BUSY.includes(previous.status)) {
      add('crashed', 'сесія несподівано закрилася')
    }

    const workedMs = (session.lastTurnEndAt ?? 0) - (session.lastTurnStartAt ?? 0)
    const hasFinished = BUSY.includes(previous.status) && FREE.includes(session.status)

    if (hasFinished && session.turnEndReason === 'answer' && workedMs >= LONG_TURN_MS) {
      const startedAt = session.lastTurnStartAt

      add(
        'done',
        'завершила роботу',
        at + WAIT_BEFORE_SENDING_MS,
        () => session.turnId !== null || session.lastTurnStartAt !== startedAt,
        workedMs,
      )
    }
  }

  private detectAsks(
    at: number,
    sessions: readonly SessionWithStatus[],
    asks: readonly Ask[],
    settings: TelegramSettings,
  ): void {
    for (const ask of asks) {
      if (this.seenAsks.has(ask.id)) {
        continue
      }

      this.seenAsks.add(ask.id)

      const session = sessions.find(candidate => candidate.id === ask.sessionId)

      if (!this.isFirstTick && session !== undefined) {
        this.enqueue(settings, {
          event: 'ask',
          repoRoot: session.repoRoot,
          text: letter(session, askLabel(ask)),
          dueAt: at + WAIT_BEFORE_SENDING_MS,
          isStale: () => this.store.ask(ask.id)?.status !== 'pending',
        })
      }
    }
  }

  private detectLimits(at: number, settings: TelegramSettings, limits: readonly RateLimit[]): void {
    const marks = JSON.parse(this.store.meta(LIMIT_MARKS_KEY) ?? '{}') as Record<string, { resetsAt?: string; level: number }>

    for (const limit of limits) {
      const level = LIMIT_LEVELS.find(candidate => limit.percentUsed >= candidate)
      const mark = marks[limit.kind]
      const isSameWindow = mark?.resetsAt === limit.resetsAt

      if (level !== undefined && (!isSameWindow || (mark?.level ?? 0) < level)) {
        marks[limit.kind] = { resetsAt: limit.resetsAt, level }
        this.store.setMeta(LIMIT_MARKS_KEY, JSON.stringify(marks))
        this.enqueue(settings, {
          event: 'limit',
          repoRoot: null,
          text: `Ліміт ${LIMIT_NAMES[limit.kind] ?? limit.kind}: використано ${Math.round(limit.percentUsed)}%`,
          dueAt: at,
          isStale: () => false,
        })
      }
    }
  }

  private async flush(at: number, settings: TelegramSettings): Promise<void> {
    if (this.isSending || at < this.blockedUntil || settings.chatId === null) {
      return
    }

    const due = this.queue.filter(item => item.dueAt <= at)
    const fresh = due.filter(item => this.isWatched(settings, item.repoRoot) && settings.events[item.event] && !item.isStale())

    if (due.length === 0) {
      return
    }

    this.queue = this.queue.filter(item => !due.includes(item))

    if (fresh.length === 0) {
      return
    }

    this.isSending = true

    try {
      const token = await this.secrets.readToken()

      if (token === null) {
        this.lastError = 'Токен бота не знайдено в Keychain'

        return
      }

      const isSilent = !fresh.some(item => LOUD_EVENTS.has(item.event))

      await this.api.send(token, settings.chatId, fresh.map(item => item.text).join('\n\n'), isSilent)
      this.lastError = null
    } catch (error) {
      const failure = error instanceof TelegramError ? error : new TelegramError('Не вдалося надіслати')

      this.lastError = failure.message

      if (failure.retryAfterSeconds !== null) {
        this.blockedUntil = at + failure.retryAfterSeconds * 1000
        this.queue = [...fresh, ...this.queue].slice(-QUEUE_LIMIT)
      }
    } finally {
      this.isSending = false
    }
  }
}
