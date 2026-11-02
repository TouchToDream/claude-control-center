import { timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { resumeBackgroundSession, startBackgroundSession, stopBackgroundSession } from './background.ts'
import type { BackgroundResult } from './background.ts'
import { MAC_EVENTS, MacAlerts } from './alerts.ts'
import type { Alert, MacEvent, Viewing } from './alerts.ts'
import { absolutePath, isSafePath, openInIde, readDiff } from './changes.ts'
import { applyEvents, applyTestProgress } from './ingest.ts'
import { Notifier, NOTIFY_EVENTS } from './notifier.ts'
import type { NotifyEvent } from './notifier.ts'
import { parseTestOutput } from './progress.ts'
import { readRegistry } from './registry.ts'
import type { RegistryEntry } from './registry.ts'
import { isTokenFormat } from './secrets.ts'
import type { Secrets } from './secrets.ts'
import { homeDirectory } from './settings.ts'
import { computeStage, computeStatus } from './status.ts'
import type { Store } from './store.ts'
import { createTelegramApi, TelegramError } from './telegram.ts'
import type { TelegramApi } from './telegram.ts'
import { findOutputFile, readOutput } from './testWatch.ts'
import { mediaType, pruneUploads, saveUpload, UPLOAD_LIMIT, uploadPath } from './uploads.ts'
import type {
  Ask,
  ModEvent,
  OutboxItem,
  RateLimit,
  Row,
  SessionState,
  Settings,
} from './types.ts'

const COOKIE = 'ccc_key'
const MOD_BODY_LIMIT = 8 * 1024 * 1024
const PANEL_BODY_LIMIT = 256 * 1024
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const LONG_POLL_LIMIT_MS = 28_000
const NAME_LIMIT = 80
const EXIT_COMMAND = '/exit'
const MODEL_CHOICES: readonly (string | null)[] = [null, 'fable', 'opus', 'sonnet', 'haiku']
const EFFORT_CHOICES: readonly (string | null)[] = [null, 'low', 'medium', 'high', 'xhigh', 'max']
const TICK_MS = 1000
const REGISTRY_EVERY_TICKS = 3

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

const CSP = [
  "default-src 'self'",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ')

type Waiter = (ask: Ask) => void

export type AppOptions = {
  store: Store
  settings: Settings
  webRoot: string
  registry?: () => RegistryEntry[]
  resume?: (cwd: string, sessionId: string) => Promise<BackgroundResult>
  stop?: (cwd: string, sessionId: string) => Promise<BackgroundResult>
  telegram?: TelegramApi
  secrets: Secrets
  openFile?: (terminal: string | null, path: string, line: number | null) => Promise<boolean>
  now?: () => number
  uploadsRoot?: string
  uploadLimit?: number
}

export type App = {
  server: Server
  listen: () => Promise<number>
  close: () => Promise<void>
}

export function createApp(options: AppOptions): App {
  const { store, settings, webRoot } = options
  const now = options.now ?? Date.now
  const registry = options.registry ?? (() => readRegistry())
  const resume = options.resume ?? resumeBackgroundSession
  const stopBackground = options.stop ?? stopBackgroundSession
  const telegram = options.telegram ?? createTelegramApi()
  const { secrets } = options
  const openFile = options.openFile ?? openInIde
  const uploadsRoot = options.uploadsRoot ?? join(homeDirectory(), 'uploads')
  const uploadLimit = options.uploadLimit ?? UPLOAD_LIMIT
  const notifier = new Notifier({ store, api: telegram, secrets })
  const clients = new Set<WebSocket>()
  const macAlerts = new MacAlerts(store)
  const clientInfo = new Map<WebSocket, ClientInfo>()
  const waiters = new Map<string, Set<Waiter>>()
  let rateLimits: RateLimit[] = JSON.parse(store.meta('rateLimits') ?? '[]') as RateLimit[]
  let unbridged: RegistryEntry[] = []
  let broadcastTimer: NodeJS.Timeout | null = null
  let ticks = 0

  const sessionView = (session: SessionState, asks: readonly Ask[], at: number) => {
    const status = computeStatus(session, asks, at, settings)

    return { ...session, status, stage: computeStage(session, status) }
  }

  const viewing = (): Viewing => {
    const visible = [...clientInfo.values()].filter(info => info.isVisible)

    return {
      sessionIds: new Set(visible.flatMap(info => (info.sessionId === null ? [] : [info.sessionId]))),
      isAnyPanelVisible: visible.length > 0,
    }
  }

  const macAlertsView = () => ({
    ...macAlerts.settings(),
    isAppRunning: [...clientInfo.values()].some(info => info.isApp),
  })

  const snapshot = () => {
    const at = now()
    const asks = store.pendingAsks()

    return {
      now: at,
      sessions: [...store.sessions.values()].map(session => sessionView(session, asks, at)),
      asks,
      rateLimits,
      unbridged,
      testRuns: store.testRuns(20),
      telegram: notifier.view(),
      alerts: macAlerts.unread().map(alertView),
      macAlerts: macAlertsView(),
    }
  }

  const send = (message: unknown) => {
    const text = JSON.stringify(message)

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(text)
      }
    }
  }

  const scheduleBroadcast = () => {
    broadcastTimer ??= setTimeout(() => {
      broadcastTimer = null
      send({ type: 'state', state: snapshot() })
    }, 100)
  }

  const publishRows = (rows: readonly Row[]) => {
    if (rows.length > 0) {
      send({ type: 'rows', rows })
    }
  }

  const publishOutbox = (item: OutboxItem | null) => {
    if (item !== null) {
      send({ type: 'outbox', item })
    }
  }

  const settleWaiters = (ask: Ask) => {
    for (const wake of waiters.get(ask.id) ?? []) {
      wake(ask)
    }

    waiters.delete(ask.id)
  }

  const syncRegistry = () => {
    const entries = registry()
    const known = new Set<string>()

    for (const entry of entries) {
      const session = store.sessions.get(entry.sessionId)

      if (session === undefined) {
        continue
      }

      known.add(entry.sessionId)

      if (session.pid !== entry.pid || session.isBackground !== (entry.kind === 'bg')) {
        session.pid = entry.pid
        session.isBackground = entry.kind === 'bg'
        store.touch(session)
      }

      if (entry.isAlive && entry.name !== null && entry.name !== session.registryName) {
        const isChosenName = entry.nameSource !== 'derived'

        session.registryName = entry.name

        if (isChosenName || session.nameSource === 'fallback') {
          session.name = entry.name
          session.nameSource = isChosenName ? 'registry' : 'fallback'
        }

        store.touch(session)
      }
    }

    unbridged = entries.filter(entry => entry.isAlive && !known.has(entry.sessionId))

    const alivePids = new Set(entries.filter(entry => entry.isAlive).map(entry => entry.pid))
    const at = now()

    for (const session of store.sessions.values()) {
      if (session.endedAt === null && session.pid !== null && !alivePids.has(session.pid)) {
        session.endedAt = at
        session.endReason = 'process_gone'
        session.turnId = null
        session.runningTool = null
        store.touch(session)
        scheduleBroadcast()
      }
    }
  }

  const watchTests = (at: number): boolean => {
    let hasChanged = false

    for (const session of store.sessions.values()) {
      const run = session.tests

      if (run === null || run.endedAt !== null) {
        continue
      }

      const path = findOutputFile(session.id, run.startedAt)
      const output = path === null ? null : readOutput(path)
      const parsed = output === null ? null : parseTestOutput(output)

      if (parsed !== null) {
        applyTestProgress(store, session, parsed, at)
        hasChanged = true
      }
    }

    return hasChanged
  }

  const terminateIfFree = (sessionId: string): boolean => {
    const session = store.sessions.get(sessionId)
    const entry = registry().find(candidate => candidate.sessionId === sessionId && candidate.isAlive)
    const isFree = session?.turnId === null && session.runningTool === null && entry?.status === 'idle'

    if (!isFree || entry === undefined) {
      return false
    }

    process.kill(entry.pid, 'SIGTERM')

    return true
  }

  const tick = () => {
    const at = now()
    const asks = store.pendingAsks()
    let hasChanged = false

    ticks += 1
    hasChanged = watchTests(at)

    if (ticks % REGISTRY_EVERY_TICKS === 0) {
      syncRegistry()
    }

    for (const session of store.sessions.values()) {
      if (store.logStatus(session.id, computeStatus(session, asks, at, settings), at)) {
        hasChanged = true
      }
    }

    for (const ask of asks) {
      const session = store.sessions.get(ask.sessionId)
      const isGone = session === undefined || computeStatus(session, [], at, settings) === 'offline'

      if (isGone) {
        const closed = store.closeAsk(ask.id, 'expired', null, at)

        if (closed !== null) {
          settleWaiters(closed)
          hasChanged = true
        }
      }
    }

    const views = [...store.sessions.values()].map(session => sessionView(session, asks, at))
    const alerted = macAlerts.tick(at, views, asks, rateLimits, viewing())

    notifier.tick(at, views, asks, rateLimits)

    for (const alert of alerted.created) {
      send({ type: 'alert', alert: alertView(alert) })
    }

    if (alerted.changed) {
      hasChanged = true
    }

    store.flush()

    if (hasChanged) {
      scheduleBroadcast()
    }

    if (ticks % 3600 === 0) {
      store.prune(at)
      pruneUploads(uploadsRoot, at - RETENTION_MS)
    }
  }

  const handleMod = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    if (!isKeyValid(request.headers['x-ccc-key'], settings.key)) {
      return json(response, 401, { error: 'unauthorized' })
    }

    const parts = url.pathname.split('/').filter(Boolean)

    if (url.pathname === '/api/mod/events' && request.method === 'POST') {
      const body = (await readJson(request, MOD_BODY_LIMIT)) as { sessionId: string; events: ModEvent[] }
      const change = applyEvents(store, settings, body.sessionId, body.events, now())

      if (change.rateLimits !== null) {
        rateLimits = change.rateLimits
        store.setMeta('rateLimits', JSON.stringify(rateLimits))
      }

      for (const ask of change.closedAsks) {
        settleWaiters(ask)
      }

      publishRows(change.rows)
      scheduleBroadcast()

      return json(response, 200, { ok: true })
    }

    if (url.pathname === '/api/mod/poll' && request.method === 'GET') {
      const sessionId = url.searchParams.get('session') ?? ''
      const session = store.sessions.get(sessionId)

      if (session !== undefined) {
        session.lastSeenAt = now()
        store.touch(session)
      }

      const idle = url.searchParams.get('idle')
      const isClaiming = url.searchParams.get('claim') !== '0'
      const command = isClaiming ? store.claimNext(sessionId, now(), idle === null ? null : idle === '1') : null

      publishOutbox(command)

      return json(response, 200, { commands: command === null ? [] : [command], override: session?.override ?? null })
    }

    if (parts[2] === 'commands' && parts[3] !== undefined && request.method === 'POST') {
      const body = (await readJson(request, PANEL_BODY_LIMIT)) as {
        status: 'delivered' | 'dropped' | 'queued'
        reason?: string
      }

      const item = store.settleOutbox(parts[3], body.status, body.reason ?? null, now())
      const isRefusedExit = item?.text === EXIT_COMMAND && body.status === 'dropped'

      publishOutbox(isRefusedExit && terminateIfFree(item.sessionId) ? store.settleOutbox(item.id, 'delivered', null, now()) : item)

      return json(response, 200, { ok: true })
    }

    if (url.pathname === '/api/mod/asks' && request.method === 'POST') {
      const body = (await readJson(request, MOD_BODY_LIMIT)) as Omit<
        Ask,
        'status' | 'answer' | 'createdAt' | 'updatedAt' | 'answerable'
      >
      const ask = store.createAsk({ ...body, answerable: body.blockedBy === null }, now())

      scheduleBroadcast()

      return json(response, 200, { ask })
    }

    if (parts[2] === 'asks' && parts[3] !== undefined && parts[4] === 'wait' && request.method === 'GET') {
      const id = parts[3]
      const ask = store.ask(id)

      if (ask === null) {
        return json(response, 404, { error: 'not_found' })
      }

      if (ask.status !== 'pending') {
        return json(response, 200, { ask })
      }

      const limit = Math.min(Number(url.searchParams.get('ms') ?? LONG_POLL_LIMIT_MS), LONG_POLL_LIMIT_MS)
      const answered = await waitForAsk(waiters, id, limit, request)

      return json(response, 200, { ask: answered ?? store.ask(id) })
    }

    if (parts[2] === 'asks' && parts[3] !== undefined && parts[4] === 'close' && request.method === 'POST') {
      const body = (await readJson(request, PANEL_BODY_LIMIT)) as { status: 'terminal' | 'expired' }
      const closed = store.closeAsk(parts[3], body.status, null, now())

      if (closed !== null) {
        settleWaiters(closed)
      }

      scheduleBroadcast()

      return json(response, 200, { ok: true })
    }

    return json(response, 404, { error: 'not_found' })
  }

  const handleTelegram = async (request: IncomingMessage, response: ServerResponse, action: string | undefined) => {
    const answer = (body: object = {}) => {
      scheduleBroadcast()

      return json(response, 200, { ...notifier.view(), ...body })
    }

    if (action === undefined && request.method === 'GET') {
      return answer()
    }

    if (request.method !== 'POST') {
      return json(response, 405, { error: 'method_not_allowed' })
    }

    const body = (await readJson(request, PANEL_BODY_LIMIT)) as Record<string, unknown>

    try {
      if (action === 'settings') {
        const events = notifier.settings().events

        for (const event of NOTIFY_EVENTS) {
          const value = (body.events as Partial<Record<NotifyEvent, unknown>> | undefined)?.[event]

          events[event] = typeof value === 'boolean' ? value : events[event]
        }

        const isOn = typeof body.enabled === 'boolean' ? body.enabled : notifier.settings().enabled

        notifier.update({ events, enabled: isOn && notifier.isReady() })

        return answer()
      }

      if (action === 'project') {
        notifier.setProject(String(body.repoKey ?? ''), body.enabled === true)

        return answer()
      }

      if (action === 'token') {
        const token = String(body.token ?? '').trim()

        if (!isTokenFormat(token)) {
          return json(response, 422, { error: 'Це не схоже на токен бота' })
        }

        const botName = await telegram.getBotName(token)

        await secrets.writeToken(token)
        notifier.update({ botName })

        return answer()
      }

      if (action === 'forget') {
        await secrets.deleteToken()
        notifier.update({ botName: null, chatId: null, chatTitle: null, enabled: false })

        return answer()
      }

      if (action === 'chats') {
        const token = await secrets.readToken()

        return token === null
          ? json(response, 422, { error: 'Спершу збережи токен бота' })
          : answer({ chats: await telegram.findChats(token) })
      }

      if (action === 'chat') {
        const chatId = String(body.chatId ?? '').trim()

        if (!/^-?\d+$/.test(chatId)) {
          return json(response, 422, { error: 'Id чату це число' })
        }

        notifier.update({ chatId, chatTitle: typeof body.chatTitle === 'string' ? body.chatTitle : null })

        return answer()
      }

      if (action === 'test') {
        await notifier.sendTest()

        return answer()
      }
    } catch (error) {
      if (error instanceof TelegramError) {
        return json(response, 502, { error: error.message })
      }

      throw error
    }

    return json(response, 404, { error: 'not_found' })
  }

  const handleMacAlerts = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'GET') {
      return json(response, 200, macAlertsView())
    }

    if (request.method !== 'POST') {
      return json(response, 405, { error: 'method_not_allowed' })
    }

    const body = (await readJson(request, PANEL_BODY_LIMIT)) as { enabled?: unknown; events?: Record<string, unknown> }
    const events: Partial<Record<MacEvent, boolean>> = {}

    for (const event of MAC_EVENTS) {
      const value = body.events?.[event]

      if (typeof value === 'boolean') {
        events[event] = value
      }
    }

    macAlerts.update({ enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined, events })
    scheduleBroadcast()

    return json(response, 200, macAlertsView())
  }

  const handleClientMessage = (ws: WebSocket, data: unknown) => {
    const info = clientInfo.get(ws)
    let message: { type?: unknown; client?: unknown; sessionId?: unknown; isVisible?: unknown }

    try {
      message = JSON.parse(String(data)) as typeof message
    } catch {
      return
    }

    if (info === undefined || typeof message !== 'object' || message === null) {
      return
    }

    if (message.type === 'hello' && message.client === 'mac-app') {
      info.isApp = true
      scheduleBroadcast()
    }

    if (message.type === 'viewing') {
      info.sessionId = typeof message.sessionId === 'string' ? message.sessionId : null
      info.isVisible = message.isVisible === true

      if (macAlerts.markViewed(viewing(), now())) {
        scheduleBroadcast()
      }
    }
  }

  const handlePanelApi = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    if (!isPanelRequestAllowed(request, settings)) {
      return json(response, 401, { error: 'unauthorized' })
    }

    const parts = url.pathname.split('/').filter(Boolean)

    if (parts[2] === 'telegram') {
      return handleTelegram(request, response, parts[3])
    }

    if (url.pathname === '/api/panel/mac-alerts') {
      return handleMacAlerts(request, response)
    }

    if (parts[2] === 'uploads' && parts.length === 5 && request.method === 'GET') {
      const path = uploadPath(uploadsRoot, safeDecode(parts[3] ?? ''), safeDecode(parts[4] ?? ''))

      if (path === null) {
        return json(response, 404, { error: 'not_found' })
      }

      response.writeHead(200, {
        'Content-Type': mediaType(path),
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      })

      return createReadStream(path).pipe(response)
    }

    if (url.pathname === '/api/panel/state' && request.method === 'GET') {
      return json(response, 200, snapshot())
    }

    if (url.pathname === '/api/panel/timeline' && request.method === 'GET') {
      return json(response, 200, { entries: store.statusLog(now() - 60 * 60 * 1000 - 1) })
    }

    if (parts[2] === 'sessions' && parts[3] !== undefined) {
      const session = store.sessions.get(parts[3])

      if (session === undefined) {
        return json(response, 404, { error: 'not_found' })
      }

      if (parts[4] === 'uploads' && request.method === 'POST') {
        const bytes = await readBytes(request, uploadLimit)
        const name = safeDecode(String(request.headers['x-file-name'] ?? '')) || 'file'
        const upload = saveUpload(uploadsRoot, session.id, name, bytes, now())

        return json(response, 200, { upload })
      }

      if (parts[4] === 'rows' && request.method === 'GET') {
        const before = url.searchParams.get('before')

        return json(response, 200, {
          rows: store.rows(session.id, 400, before === null ? undefined : Number(before)),
          outbox: store.outboxFor(session.id, 50),
        })
      }

      if (parts[4] === 'messages' && request.method === 'POST') {
        const { text } = (await readJson(request, PANEL_BODY_LIMIT)) as { text?: string }
        const trimmed = (text ?? '').trim()

        if (trimmed === '') {
          return json(response, 422, { error: 'empty_message' })
        }

        const isShell = trimmed.startsWith('!')
        const command = trimmed.slice(1).trim()

        if (isShell && command === '') {
          return json(response, 422, { error: 'empty_command' })
        }

        if (isShell && !supportsShell(session.modVersion)) {
          return json(response, 409, { error: 'mod_outdated' })
        }

        const item = isShell ? store.enqueue(session.id, 'bash', command, now()) : store.enqueue(session.id, 'message', trimmed, now())

        publishOutbox(item)

        return json(response, 200, { item })
      }

      if (parts[4] === 'commands' && request.method === 'GET') {
        return json(response, 200, { commands: store.commands(session.id) })
      }

      if (parts[4] === 'diff' || parts[4] === 'open') {
        const isOpen = parts[4] === 'open' && request.method === 'POST'
        const body = (isOpen ? await readJson(request, PANEL_BODY_LIMIT) : {}) as { path?: string; line?: number | null }
        const path = isOpen ? (body.path ?? '') : (url.searchParams.get('path') ?? '')
        const file = session.files.find(candidate => candidate.path === path)

        if (file === undefined || !isSafePath(path)) {
          return json(response, 404, { error: 'not_a_changed_file' })
        }

        if (!isOpen) {
          const diff = await readDiff(session.cwd, file)

          return diff === null ? json(response, 502, { error: 'git_failed' }) : json(response, 200, diff)
        }

        const absolute = await absolutePath(session.cwd, file)
        const line = typeof body.line === 'number' ? body.line : null
        const isOpened = absolute !== null && (await openFile(session.terminal, absolute, line))

        return json(response, isOpened ? 200 : 502, { ok: isOpened })
      }

      if (parts[4] === 'model' && request.method === 'POST') {
        const { model = null, effort = null } = (await readJson(request, PANEL_BODY_LIMIT)) as {
          model?: string | null
          effort?: string | null
        }

        if (!MODEL_CHOICES.includes(model) || !EFFORT_CHOICES.includes(effort)) {
          return json(response, 422, { error: 'invalid_choice' })
        }

        session.override = { model, effort }
        store.touch(session)
        scheduleBroadcast()

        return json(response, 200, { ok: true })
      }

      if (parts[4] === 'rename' && request.method === 'POST') {
        const { name } = (await readJson(request, PANEL_BODY_LIMIT)) as { name?: string }
        const clean = (name ?? '').replace(/\s+/g, ' ').trim()

        if (clean === '' || clean.length > NAME_LIMIT) {
          return json(response, 422, { error: 'invalid_name' })
        }

        session.name = clean
        session.nameSource = 'panel'
        store.touch(session)
        publishOutbox(store.enqueue(session.id, 'message', `/rename ${clean}`, now()))
        scheduleBroadcast()

        return json(response, 200, { ok: true })
      }

      if (parts[4] === 'close' && request.method === 'POST') {
        const entry = registry().find(candidate => candidate.sessionId === session.id && candidate.isAlive)

        if (entry?.kind === 'bg') {
          const stopped = await stopBackground(session.cwd, session.id)

          return json(response, stopped.error === null ? 200 : 502, { ok: stopped.error === null })
        }

        const item = store.enqueue(session.id, 'message', EXIT_COMMAND, now())

        publishOutbox(item)

        return json(response, 200, { item })
      }

      if (parts[4] === 'resume' && request.method === 'POST') {
        const isRunningNow = registry().some(entry => entry.sessionId === session.id && entry.isAlive)

        if (session.cwd === '' || isRunningNow) {
          return json(response, 409, { error: 'session_is_open' })
        }

        return json(response, 200, await resume(session.cwd, session.id))
      }

      if (parts[4] === 'abort' && request.method === 'POST') {
        const item = store.enqueue(session.id, 'abort', '', now())

        publishOutbox(item)

        return json(response, 200, { item })
      }
    }

    if (parts[2] === 'outbox' && parts[3] !== undefined && parts[4] === 'cancel' && request.method === 'POST') {
      const item = store.cancelQueued(parts[3], now())

      publishOutbox(item)

      return json(response, item === null ? 409 : 200, { ok: item !== null })
    }

    if (parts[2] === 'outbox' && parts[3] !== undefined && parts[4] === 'force' && request.method === 'POST') {
      const { mode } = (await readJson(request, PANEL_BODY_LIMIT)) as { mode?: string }

      if (mode !== 'inject' && mode !== 'interrupt') {
        return json(response, 422, { error: 'invalid_mode' })
      }

      const item = store.forceQueued(parts[3], mode, now())

      publishOutbox(item)

      return json(response, item === null ? 409 : 200, { ok: item !== null })
    }

    if (parts[2] === 'outbox' && parts[3] !== undefined && parts[4] === 'dismiss' && request.method === 'POST') {
      const item = store.outboxItem(parts[3])

      if (item === null || item.status !== 'dropped') {
        return json(response, 409, { error: 'not_dismissable' })
      }

      publishOutbox(store.settleOutbox(item.id, 'dismissed', item.reason, now()))

      return json(response, 200, { ok: true })
    }

    if (url.pathname === '/api/panel/background-sessions' && request.method === 'POST') {
      const { cwd, prompt } = (await readJson(request, PANEL_BODY_LIMIT)) as { cwd?: string; prompt?: string }
      const isKnown = [...store.sessions.values()].some(session => session.repoRoot === cwd || session.cwd === cwd)
      const trimmed = (prompt ?? '').trim()

      if (cwd === undefined || !isKnown || trimmed === '') {
        return json(response, 422, { error: 'invalid_session_request' })
      }

      return json(response, 200, await startBackgroundSession(cwd, trimmed, settings.modDir))
    }

    if (parts[2] === 'asks' && parts[3] !== undefined && parts[4] === 'answer' && request.method === 'POST') {
      const ask = store.ask(parts[3])

      if (ask === null || ask.status !== 'pending') {
        return json(response, 409, { error: 'already_closed' })
      }

      if (!ask.answerable) {
        return json(response, 403, { error: 'terminal_only' })
      }

      const answer = await readJson(request, PANEL_BODY_LIMIT)
      const closed = store.closeAsk(ask.id, 'answered', answer, now())

      if (closed !== null) {
        settleWaiters(closed)
      }

      scheduleBroadcast()

      return json(response, 200, { ok: true })
    }

    return json(response, 404, { error: 'not_found' })
  }

  const handleStatic = (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const key = url.searchParams.get('key')

    if (key !== null && isKeyValid(key, settings.key)) {
      response.writeHead(303, {
        Location: '/',
        'Set-Cookie': `${COOKIE}=${settings.key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
      })

      return response.end()
    }

    if (!isKeyValid(cookieKey(request), settings.key)) {
      response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP })

      return response.end(
        '<!doctype html><html lang="uk"><meta charset="utf-8"><title>Центр керування</title>' +
          '<body style="background:#0F1216;color:#E8EBEF;font:16px system-ui;padding:40px">' +
          '<h1 style="font-size:20px">Потрібен ключ доступу</h1>' +
          '<p>Відкрий панель командою <code>npm run ccc -- open</code>.</p></body></html>',
      )
    }

    const root = resolve(webRoot)
    const candidate = normalize(join(root, decodeURIComponent(url.pathname)))
    const isInside = candidate === root || candidate.startsWith(root + sep)
    const path = isInside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, 'index.html')

    if (!existsSync(path)) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })

      return response.end('Інтерфейс не зібрано: виконай npm run build')
    }

    response.writeHead(200, {
      'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': path.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    })
    createReadStream(path).pipe(response)
  }

  const routeFor = (path: string) => {
    if (path.startsWith('/api/mod/')) {
      return handleMod
    }

    if (path.startsWith('/api/panel/')) {
      return handlePanelApi
    }

    return async (request: IncomingMessage, response: ServerResponse, url: URL) =>
      handleStatic(request, response, url)
  }

  const server = createServer((request, response) => {
    if (!isHostAllowed(request, settings)) {
      return json(response, 403, { error: 'host_not_allowed' })
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const route = routeFor(url.pathname)(request, response, url)

    route.catch(error => {
      if (!response.headersSent) {
        json(response, error instanceof HttpError ? error.status : 500, {
          error: error instanceof HttpError ? error.message : 'internal',
        })
      }
    })
  })

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })

  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws' || !isHostAllowed(request, settings) || !isPanelRequestAllowed(request, settings)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')

      return socket.destroy()
    }

    sockets.handleUpgrade(request, socket, head, ws => {
      clients.add(ws)
      clientInfo.set(ws, { isApp: false, sessionId: null, isVisible: false })
      ws.send(JSON.stringify({ type: 'state', state: snapshot() }))
      ws.on('message', data => handleClientMessage(ws, data))
      ws.on('close', () => {
        const wasApp = clientInfo.get(ws)?.isApp === true

        clients.delete(ws)
        clientInfo.delete(ws)

        if (wasApp) {
          scheduleBroadcast()
        }
      })
    })
  })

  let ticker: NodeJS.Timeout | null = null

  return {
    server,
    listen: () =>
      new Promise((done, fail) => {
        server.once('error', fail)
        server.listen(settings.port, '127.0.0.1', () => {
          const address = server.address()

          ticker = setInterval(tick, TICK_MS)
          done(typeof address === 'object' && address !== null ? address.port : settings.port)
        })
      }),
    close: () =>
      new Promise(done => {
        if (ticker !== null) {
          clearInterval(ticker)
        }

        if (broadcastTimer !== null) {
          clearTimeout(broadcastTimer)
        }

        for (const client of clients) {
          client.terminate()
        }

        server.close(() => done())
        server.closeAllConnections()
      }),
  }
}

type ClientInfo = {
  isApp: boolean
  sessionId: string | null
  isVisible: boolean
}

function alertView(alert: Alert) {
  return {
    id: alert.id,
    sessionId: alert.sessionId,
    event: alert.event,
    title: alert.title,
    body: alert.body,
    createdAt: alert.createdAt,
  }
}

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function waitForAsk(
  waiters: Map<string, Set<Waiter>>,
  id: string,
  limit: number,
  request: IncomingMessage,
): Promise<Ask | null> {
  return new Promise(done => {
    const set = waiters.get(id) ?? new Set<Waiter>()
    let timer: NodeJS.Timeout | null = null

    const finish = (ask: Ask | null) => {
      if (timer !== null) {
        clearTimeout(timer)
      }

      set.delete(wake)
      done(ask)
    }

    const wake: Waiter = ask => finish(ask)

    set.add(wake)
    waiters.set(id, set)
    timer = setTimeout(() => finish(null), limit)
    request.once('close', () => finish(null))
  })
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

function supportsShell(modVersion: string | null): boolean {
  const [major = 0, minor = 0] = (modVersion ?? '').split('.').map(Number)

  return major > 0 || minor >= 8
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

async function readBytes(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of request) {
    const piece = chunk as Buffer

    size += piece.length

    if (size > limit) {
      throw new HttpError(413, 'too_large')
    }

    chunks.push(piece)
  }

  return Buffer.concat(chunks)
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const bytes = await readBytes(request, limit)

  try {
    return JSON.parse(bytes.toString('utf8') || '{}')
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

function isKeyValid(given: string | string[] | undefined | null, expected: string): boolean {
  if (typeof given !== 'string') {
    return false
  }

  const left = Buffer.from(given)
  const right = Buffer.from(expected)

  return left.length === right.length && timingSafeEqual(left, right)
}

function cookieKey(request: IncomingMessage): string | undefined {
  return (request.headers.cookie ?? '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
}

function allowedHosts(settings: Settings, port: string): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`]
}

function isHostAllowed(request: IncomingMessage, settings: Settings): boolean {
  const port = String(request.socket.localPort ?? settings.port)

  return allowedHosts(settings, port).includes(request.headers.host ?? '')
}

function isPanelRequestAllowed(request: IncomingMessage, settings: Settings): boolean {
  if (!isKeyValid(cookieKey(request), settings.key)) {
    return false
  }

  const origin = request.headers.origin

  if (origin === undefined) {
    return request.method === 'GET'
  }

  const port = String(request.socket.localPort ?? settings.port)

  return allowedHosts(settings, port).some(host => origin === `http://${host}`)
}
