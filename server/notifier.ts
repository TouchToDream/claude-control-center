import { askLabel, EventDetector, letter, LIMIT_NAMES, testsLabel } from './events.ts'
import type { DetectedEvent, SessionWithStatus } from './events.ts'
import type { Store } from './store.ts'
import type { Secrets } from './secrets.ts'
import { TelegramError } from './telegram.ts'
import type { TelegramApi } from './telegram.ts'
import type { Ask, RateLimit } from './types.ts'

export type { SessionWithStatus } from './events.ts'

const SETTINGS_KEY = 'telegram'
const LIMIT_MARKS_KEY = 'telegramLimits'
const WAIT_BEFORE_SENDING_MS = 45_000
const LONG_TURN_MS = 2 * 60_000
const QUEUE_LIMIT = 50

export const NOTIFY_EVENTS = ['ask', 'testsFailed', 'turnError', 'crashed', 'done', 'testsPassed', 'limit'] as const

export type NotifyEvent = (typeof NOTIFY_EVENTS)[number]

const LOUD_EVENTS: ReadonlySet<NotifyEvent> = new Set(['ask', 'testsFailed', 'turnError', 'crashed'])

export type TelegramSettings = {
  enabled: boolean
  chatId: string | null
  chatTitle: string | null
  botName: string | null
  events: Record<NotifyEvent, boolean>
  projects: string[]
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

export type NotifierOptions = {
  store: Store
  api: TelegramApi
  secrets: Secrets
}

export class Notifier {
  private readonly store: Store
  private readonly api: TelegramApi
  private readonly secrets: Secrets
  private readonly detector: EventDetector
  private queue: Pending[] = []
  private isSending = false
  private blockedUntil = 0
  private lastError: string | null = null

  constructor(options: NotifierOptions) {
    this.store = options.store
    this.api = options.api
    this.secrets = options.secrets
    this.detector = new EventDetector(options.store, LIMIT_MARKS_KEY)
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

    for (const event of this.detector.tick(at, sessions, asks, limits)) {
      this.consider(at, event, settings)
    }

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

  private consider(at: number, event: DetectedEvent, settings: TelegramSettings): void {
    if (event.kind === 'limit') {
      const { limit } = event

      return this.enqueue(settings, {
        event: 'limit',
        repoRoot: null,
        text: `Ліміт ${LIMIT_NAMES[limit.kind] ?? limit.kind}: використано ${Math.round(limit.percentUsed)}%`,
        dueAt: at,
        isStale: () => false,
      })
    }

    const { session } = event
    const add = (kind: NotifyEvent, status: string, dueAt = at, isStale = () => false, workedMs: number | null = null) =>
      this.enqueue(settings, { event: kind, repoRoot: session.repoRoot, text: letter(session, status, workedMs), dueAt, isStale })

    switch (event.kind) {
      case 'ask': {
        const { ask } = event

        return add('ask', askLabel(ask), at + WAIT_BEFORE_SENDING_MS, () => this.store.ask(ask.id)?.status !== 'pending')
      }
      case 'testsFailed':
      case 'testsPassed':
        return add(event.kind, testsLabel(session), at, () => false, event.workedMs)
      case 'turnError':
        return add('turnError', 'хід завершився помилкою')
      case 'crashed':
        return add('crashed', 'сесія несподівано закрилася')
      case 'lost':
        return
      case 'done': {
        if (event.workedMs < LONG_TURN_MS) {
          return
        }

        const { startedAt } = event

        return add(
          'done',
          'завершила роботу',
          at + WAIT_BEFORE_SENDING_MS,
          () => session.turnId !== null || session.lastTurnStartAt !== startedAt,
          event.workedMs,
        )
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
