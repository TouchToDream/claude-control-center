import type {
  Ask,
  OutboxItem,
  RateLimit,
  Row,
  SessionState,
  Stage,
  Status,
  TestRun,
} from '../../server/types.ts'

export type { Ask, OutboxItem, RateLimit, Row, Stage, Status, TestRun }

export type NotifyEvent = 'ask' | 'testsFailed' | 'turnError' | 'crashed' | 'done' | 'testsPassed' | 'limit'

export type SessionCommand = { name: string; description: string; source: string }

export type TelegramChat = { id: string; title: string; type: string }

export type TelegramView = {
  enabled: boolean
  isReady: boolean
  botName: string | null
  chatId: string | null
  chatTitle: string | null
  events: Record<NotifyEvent, boolean>
  projects: string[]
  lastError: string | null
  chats?: TelegramChat[]
}

export type SessionView = SessionState & { status: Status; stage: Stage }

export type Unbridged = {
  pid: number
  sessionId: string
  cwd: string
  name: string | null
  entrypoint: string | null
  kind: string | null
  status: string | null
}

export type Attachment = {
  key: string
  name: string
  status: 'uploading' | 'ready' | 'failed'
  path: string | null
  url: string | null
  isImage: boolean
  error: string | null
}

export type UploadView = {
  name: string
  path: string
  size: number
  isImage: boolean
  url: string
}

export type MacEvent = 'question' | 'permission' | 'done' | 'turnError' | 'testsFailed' | 'gone' | 'limit'

export type AlertView = {
  id: string
  sessionId: string | null
  event: MacEvent
  title: string
  body: string
  createdAt: number
}

export type MacAlertsView = {
  enabled: boolean
  events: Record<MacEvent, boolean>
  isAppRunning: boolean
}

export type Snapshot = {
  now: number
  sessions: SessionView[]
  asks: Ask[]
  rateLimits: RateLimit[]
  unbridged: Unbridged[]
  testRuns: TestRun[]
  telegram: TelegramView
  alerts?: AlertView[]
  macAlerts?: MacAlertsView
}

export type TimelineEntry = { sessionId: string; ts: number; status: Status }

export const STATUS_LABEL: Record<Status, string> = {
  work: 'працює',
  tests: 'тести йдуть',
  ask: 'питає тебе',
  chat: 'обговорення',
  waiting: 'чекає на тебе',
  idle: 'idle',
  fail: 'помилка',
  offline: 'офлайн',
}

export const STAGES: { key: Stage; label: string }[] = [
  { key: 'plan', label: 'План' },
  { key: 'code', label: 'Код' },
  { key: 'tests', label: 'Тести' },
  { key: 'review', label: 'Рев’ю' },
  { key: 'done', label: 'Готово' },
]

const DROP_REASONS: Record<string, string> = {
  'the session was stopped and nobody has sent input since':
    'Сесію зупинено через Esc. Напиши щось у терміналі, потім надішли ще раз.',
}

const OLD_MOD = 'prompt.submit: submits a prompt to the model'
const OLD_MOD_HINT = 'У цій сесії стара версія мода. Виконай у ній /reload-plugins і надішли ще раз.'
const REASON_PREFIX = /^control-center: \$\.[a-z.]+: /
const UNKNOWN_COMMAND = /^no command named (\S+) in this session/

export function dropReason(reason: string | null): string {
  if (reason === null) {
    return 'Не вдалося доставити'
  }

  if (reason.includes(OLD_MOD)) {
    return OLD_MOD_HINT
  }

  const plain = reason.replace(REASON_PREFIX, '')
  const unknown = UNKNOWN_COMMAND.exec(plain)

  return unknown === null ? (DROP_REASONS[plain] ?? plain) : `У цій сесії немає команди ${unknown[1]}.`
}

export function modelLabel(model: string | null): string | null {
  const match = model === null ? null : /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model)

  if (match === null || match[1] === undefined) {
    return model
  }

  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1)

  return [family, [match[2], match[3]].filter(Boolean).join('.')].join(' ')
}

function hasModVersion(session: SessionView, minimumMinor: number): boolean {
  const [major = 0, minor = 0] = (session.modVersion ?? '').split('.').map(Number)

  return major > 0 || minor >= minimumMinor
}

export function canChooseModel(session: SessionView): boolean {
  return hasModVersion(session, 3)
}

export function canForceMessage(session: SessionView): boolean {
  return hasModVersion(session, 4)
}

export function isRunning(session: SessionView): boolean {
  return session.status === 'work' || session.status === 'tests'
}

export function isLive(session: SessionView): boolean {
  return session.status !== 'offline'
}

export function repoKey(session: SessionView): string {
  return session.repoRoot === '' ? session.cwd : session.repoRoot
}

export function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000)

  if (minutes < 1) {
    return 'щойно'
  }

  if (minutes < 60) {
    return `${minutes} хв`
  }

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  if (hours < 24) {
    return rest === 0 ? `${hours} год` : `${hours} год ${rest}`
  }

  return `${Math.floor(hours / 24)} дн`
}

export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))

  if (seconds < 60) {
    return `${seconds} с`
  }

  return `${Math.floor(seconds / 60)} хв ${seconds % 60} с`
}

export function testEta(run: TestRun, now: number): string | null {
  if (run.endedAt !== null) {
    return null
  }

  const elapsed = now - run.startedAt
  const progress = run.progress

  if (progress !== null && progress.total > 0 && progress.done > 0) {
    return `~${duration((elapsed / progress.done) * (progress.total - progress.done))}`
  }

  if (run.expectedMs === null || run.expectedMs <= elapsed) {
    return null
  }

  return `~${duration(run.expectedMs - elapsed)}`
}

export function expectedShare(run: TestRun, now: number): number | null {
  if (run.endedAt !== null || run.expectedMs === null || run.expectedMs === 0) {
    return null
  }

  return Math.min(((now - run.startedAt) / run.expectedMs) * 100, 97)
}
