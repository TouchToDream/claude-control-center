import { basename } from 'node:path'
import { clip, redact } from '../mod/hooks/redact.ts'
import { parseTestOutput } from './progress.ts'
import type { ParsedProgress } from './progress.ts'
import { isTestCommand } from './status.ts'
import type { Store } from './store.ts'
import type {
  AgentSnapshot,
  Ask,
  ChangedFile,
  ModEvent,
  RateLimit,
  Row,
  SessionCommand,
  SessionState,
  Settings,
  TaskCycle,
} from './types.ts'

const NAME_LIMIT = 48
const WORK_WINDOW = 5
const PATHS_LIMIT = 500
const PULL_REQUESTS_LIMIT = 10
const GIT_COMMIT = /\bgit\b[^|;&]*?\scommit\b/
const GIT_SHIP = /\bgit\b[^|;&]*?\spush\b|\bgh\s+pr\s+(?:create|merge)\b/
const COMMIT_MESSAGE = /\s-[a-zA-Z]*m\s+(?:"([^"]+)"|'([^']+)')/
const PULL_REQUEST = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch'])
const COMMAND_NAME = /<command-name>([^<]*)<\/command-name>/
const COMMAND_ARGS = /<command-args>([^<]*)<\/command-args>/
const ENGINE_NOTE = /^\s*<(?:task-notification|system-reminder)>/
const TASK_SUMMARY = /<summary>([\s\S]*?)<\/summary>/
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

export type Change = {
  rows: Row[]
  rateLimits: RateLimit[] | null
  closedAsks: Ask[]
}

function blankCycle(startedAt: number): TaskCycle {
  return { startedAt, hasPlan: false, reads: 0, changes: 0, tests: null, isCommitted: false, last: null }
}

export function blankSession(id: string, now: number): SessionState {
  return {
    id,
    cwd: '',
    repoRoot: '',
    repoName: 'невідомо',
    branch: null,
    name: id.slice(0, 8),
    nameSource: 'fallback',
    registryName: null,
    isBackground: false,
    firstPrompt: null,
    model: null,
    effort: null,
    override: { model: null, effort: null },
    version: null,
    modVersion: null,
    permissionMode: null,
    terminal: null,
    surfaces: [],
    pid: null,
    startedAt: now,
    lastSeenAt: now,
    endedAt: null,
    endReason: null,
    lastUserAt: null,
    lastTurnStartAt: null,
    lastTurnEndAt: null,
    turnId: null,
    turnEndReason: null,
    runningTool: null,
    activity: 'Щойно запустилася',
    tests: null,
    turnError: false,
    recentWork: [],
    turnHadWork: false,
    work: {
      reads: 0,
      edits: 0,
      commands: 0,
      editedPaths: [],
      testRuns: 0,
      testFailures: 0,
      commits: 0,
      lastCommit: null,
      pullRequests: [],
    },
    cycle: blankCycle(now),
    contextPercent: null,
    costUsd: null,
    agents: [],
    files: [],
  }
}

export function applyEvents(
  store: Store,
  settings: Settings,
  sessionId: string,
  events: readonly ModEvent[],
  now: number,
): Change {
  let session = store.sessions.get(sessionId)

  if (session === undefined) {
    session = blankSession(sessionId, now)
    store.sessions.set(sessionId, session)
  }

  const change: Change = { rows: [], rateLimits: null, closedAsks: [] }

  session.lastSeenAt = now

  if (session.endedAt !== null && events.some(event => event.t !== 'session_end')) {
    session.endedAt = null
    session.endReason = null
  }

  for (const event of events) {
    applyEvent(store, settings, session, event, change)
  }

  store.touch(session)

  return change
}

function applyEvent(
  store: Store,
  settings: Settings,
  session: SessionState,
  event: ModEvent,
  change: Change,
): void {
  const addRow = (row: Omit<Row, 'seq' | 'sessionId' | 'viaPanel' | 'ts'> & { viaPanel?: boolean }) => {
    const stored = store.addRow({
      viaPanel: false,
      ...row,
      sessionId: session.id,
      ts: event.at,
    })

    if (stored !== null) {
      change.rows.push(stored)
    }
  }

  switch (event.t) {
    case 'hello':
      applyHello(session, event)
      break
    case 'prompt':
      applyPrompt(session, event)
      break
    case 'row':
      applyRow(event, addRow)
      break
    case 'turn_start':
      if (event.agentId === undefined) {
        session.turnId = String(event.turnId)
        session.lastTurnStartAt = event.at
        session.turnEndReason = null
        session.turnError = false
        session.turnHadWork = false
        session.activity = 'Працює над відповіддю'
      }
      break
    case 'turn_complete':
      if (event.agentId === undefined) {
        applyTurnComplete(store, session, event)
        change.closedAsks.push(...closeMainLoopAsks(store, session.id, event.at))
      }
      break
    case 'tool_start':
      applyToolStart(store, session, settings, event)
      break
    case 'tool_end':
      applyToolEnd(store, session, event)
      break
    case 'measure':
      applyMeasure(session, event, change)
      break
    case 'commands':
      store.saveCommands(session.id, event.list as SessionCommand[])
      break
    case 'model':
      session.model = String(event.model)
      session.effort = typeof event.effort === 'string' ? event.effort : null
      break
    case 'agents':
      session.agents = event.list as AgentSnapshot[]
      break
    case 'git':
      session.branch = (event.branch as string | null) ?? session.branch
      session.files = event.files as ChangedFile[]
      break
    case 'peer_send':
      addRow({
        uuid: `peer-send-${event.at}-${session.id}-${String(event.to)}`,
        agentId: null,
        kind: 'peer',
        text: `→ ${String(event.to)}: ${String(event.text)}`,
        tool: null,
        toolUseId: null,
        isError: event.ok === false,
      })
      break
    case 'peer_receive':
      addRow({
        uuid: `peer-receive-${event.at}-${session.id}`,
        agentId: null,
        kind: 'peer',
        text: `← ${String(event.from)}: ${String(event.text)}`,
        tool: null,
        toolUseId: null,
        isError: false,
      })
      break
    case 'session_end':
      session.endReason = String(event.reason)
      session.endedAt = event.at
      session.turnId = null
      session.runningTool = null
      change.closedAsks.push(...closeAsks(store, session.id, 'expired', event.at))
      break
  }
}

function closeAsks(store: Store, sessionId: string, status: 'terminal' | 'expired', at: number): Ask[] {
  return store
    .pendingAsks()
    .filter(ask => ask.sessionId === sessionId)
    .flatMap(ask => store.closeAsk(ask.id, status, null, at) ?? [])
}

function closeMainLoopAsks(store: Store, sessionId: string, at: number): Ask[] {
  return store
    .pendingAsks()
    .filter(ask => ask.sessionId === sessionId && ask.agentId === null)
    .flatMap(ask => store.closeAsk(ask.id, 'terminal', null, at) ?? [])
}

function applyHello(session: SessionState, event: ModEvent): void {
  const repoRoot = (event.repoRoot as string | null) ?? String(event.cwd)

  session.cwd = String(event.cwd)
  session.repoRoot = repoRoot
  session.repoName = basename(repoRoot)
  session.branch = (event.branch as string | null) ?? session.branch
  session.model = (event.model as string | null) ?? session.model
  session.version = (event.version as string | null) ?? session.version
  session.modVersion = (event.modVersion as string | null) ?? session.modVersion
  session.terminal = (event.terminal as string | null) ?? session.terminal
  session.surfaces = (event.surfaces as string[] | undefined) ?? session.surfaces
}

function applyPrompt(session: SessionState, event: ModEvent): void {
  if (event.isMeta === true || event.origin === 'task-notification' || ENGINE_NOTE.test(String(event.text))) {
    return
  }

  session.lastUserAt = event.at

  if (session.cycle.isCommitted && event.command === undefined) {
    session.cycle = blankCycle(event.at)
  }

  if (session.firstPrompt === null && event.command === undefined) {
    const firstLine = String(event.text).trim().split('\n')[0] ?? ''

    session.firstPrompt = firstLine.length > NAME_LIMIT ? `${firstLine.slice(0, NAME_LIMIT)}…` : firstLine

    if (session.nameSource === 'fallback' && session.firstPrompt !== '') {
      session.name = session.firstPrompt
      session.nameSource = 'prompt'
    }
  }
}

type Block = {
  type: string
  text?: string
  id?: string
  name?: string
  summary?: string
  tool_use_id?: string
  is_error?: boolean
}

function applyRow(
  event: ModEvent,
  addRow: (row: Omit<Row, 'seq' | 'sessionId' | 'viaPanel' | 'ts'> & { viaPanel?: boolean }) => void,
): void {
  const agentId = (event.agentId as string | undefined) ?? null
  const uuid = String(event.uuid)
  const door = String(event.door)
  const blocks = event.blocks as Block[]

  blocks.forEach((block, index) => {
    const blockUuid = index === 0 ? uuid : `${uuid}:${index}`

    if (block.type === 'text' && block.text !== undefined && block.text.trim() !== '') {
      const isEngineNote = door === 'delivery' || ENGINE_NOTE.test(block.text)
      const delivery = isEngineNote ? deliveryRow(block.text) : undefined
      const text = door === 'command' ? commandLine(block.text) : (delivery === undefined ? block.text : delivery?.text)

      if (text === null || text === undefined) {
        return
      }

      addRow({
        uuid: blockUuid,
        agentId,
        kind: delivery?.kind ?? rowKind(door, event.role as string | undefined),
        text,
        tool: null,
        toolUseId: null,
        isError: false,
        viaPanel: event.viaPanel === true,
      })
    }

    if (block.type === 'tool_use') {
      addRow({
        uuid: blockUuid,
        agentId,
        kind: 'tool',
        text: block.summary ?? '',
        tool: block.name ?? null,
        toolUseId: block.id ?? null,
        isError: false,
      })
    }

    if (block.type === 'tool_result' && block.text !== undefined && block.text !== '') {
      addRow({
        uuid: blockUuid,
        agentId,
        kind: 'result',
        text: block.text,
        tool: null,
        toolUseId: block.tool_use_id ?? null,
        isError: block.is_error === true,
      })
    }
  })
}

function deliveryRow(text: string): { kind: Row['kind']; text: string } | null {
  const summary = TASK_SUMMARY.exec(text)?.[1]

  if (summary !== undefined) {
    return { kind: 'notice', text: `Фонове завдання: ${summary}` }
  }

  return text.includes('<system-reminder>') || text.includes('<cross-session-message') ? null : { kind: 'peer', text }
}

function commandLine(text: string): string | null {
  const name = COMMAND_NAME.exec(text)?.[1]

  if (name === undefined) {
    return null
  }

  return `${name} ${COMMAND_ARGS.exec(text)?.[1] ?? ''}`.trim()
}

function rowKind(door: string, role: string | undefined): Row['kind'] {
  if (door === 'notice' || door === 'compaction' || door === 'command') {
    return 'notice'
  }

  if (door === 'delivery') {
    return 'peer'
  }

  return role === 'assistant' ? 'assistant' : 'user'
}

function forgetInterruptedRun(store: Store, session: SessionState): void {
  const run = session.tests
  const wasInThisTurn = run !== null && run.startedAt >= (session.lastTurnStartAt ?? 0)
  const hasCounters = run?.progress !== null && run?.progress !== undefined

  if (run === null || !wasInThisTurn || run.failed !== true || hasCounters) {
    return
  }

  session.tests = { ...run, failed: null }
  session.work.testFailures = Math.max(0, session.work.testFailures - 1)
  session.cycle.tests = null
  store.saveTestRun(session.tests)
}

function applyTurnComplete(store: Store, session: SessionState, event: ModEvent): void {
  if (event.reason === 'aborted') {
    forgetInterruptedRun(store, session)
  }

  session.turnId = null
  session.turnEndReason = String(event.reason)
  session.lastTurnEndAt = event.at
  session.turnError = event.reason === 'error'
  session.runningTool = null
  session.recentWork = [...session.recentWork, session.turnHadWork].slice(-WORK_WINDOW)
  session.activity = activityAfterTurn(String(event.reason))
}

function activityAfterTurn(reason: string): string {
  if (reason === 'aborted') {
    return 'Зупинено'
  }

  if (reason === 'error') {
    return 'Хід завершився помилкою'
  }

  if (reason === 'refusal') {
    return 'Модель відмовилась відповідати'
  }

  return 'Відповів, чекає на тебе'
}

function applyToolStart(store: Store, session: SessionState, settings: Settings, event: ModEvent): void {
  const tool = String(event.tool)
  const summary = String(event.summary ?? '')
  const isMain = event.agentId === undefined

  const { work, cycle } = session

  if (READ_TOOLS.has(tool)) {
    work.reads += 1
    cycle.reads += 1
    cycle.last = 'read'
  }

  if (EDIT_TOOLS.has(tool)) {
    session.turnHadWork = true
    work.edits += 1
    work.editedPaths = [...new Set([...work.editedPaths, summary])].slice(-PATHS_LIMIT)
    cycle.changes += 1
    cycle.last = 'change'
  }

  if (tool === 'Bash') {
    session.turnHadWork = true

    if (event.background !== true && isTestCommand(summary, settings.testCommands)) {
      session.tests = {
        id: String(event.id),
        sessionId: session.id,
        repoRoot: session.repoRoot,
        command: summary,
        expectedMs: expectedDuration(store, session, summary),
        startedAt: event.at,
        endedAt: null,
        failed: null,
        progress: null,
      }
      store.saveTestRun(session.tests)
      work.testRuns += 1
      cycle.last = 'test'
    }
  }

  if (isMain) {
    session.runningTool = { id: String(event.id), tool, summary, startedAt: event.at }
    session.activity = describeTool(tool, summary)
  }
}

function applyToolEnd(store: Store, session: SessionState, event: ModEvent): void {
  const isMain = event.agentId === undefined
  const failed = event.isError === true
  const summary = String(event.summary ?? '')

  if (session.tests !== null && session.tests.endedAt === null && session.tests.id === String(event.id)) {
    const parsed = typeof event.tail === 'string' ? parseTestOutput(event.tail) : null
    const hasResult = parsed?.isFinal === true
    const counters = hasResult ? { progress: { ...withoutFinal(parsed), updatedAt: event.at } } : {}

    session.tests = {
      ...session.tests,
      ...counters,
      endedAt: event.at,
      failed: runFailed(event.denied === true, failed, hasResult ? parsed : null),
    }
    store.saveTestRun(session.tests)
  }

  const wasTestRun = session.tests?.id === String(event.id)

  if (wasTestRun && session.tests?.endedAt !== null) {
    const hasFailed = session.tests?.failed === true

    session.work.testFailures += hasFailed ? 1 : 0
    session.cycle.tests = hasFailed ? 'failed' : 'passed'
  }

  if (String(event.tool) === 'ExitPlanMode' && !failed && event.denied !== true) {
    session.cycle.hasPlan = true
  }

  if (String(event.tool) === 'Bash' && !wasTestRun && !failed && event.denied !== true) {
    applyCommand(session, event, summary)
  }

  if (isMain && session.runningTool?.id === String(event.id)) {
    session.runningTool = null
    session.activity = session.turnId === null ? session.activity : 'Працює над відповіддю'
  }
}

function applyCommand(session: SessionState, event: ModEvent, summary: string): void {
  const { work, cycle } = session
  const isCommit = GIT_COMMIT.test(summary)
  const pullRequest = typeof event.tail === 'string' ? PULL_REQUEST.exec(event.tail)?.[0] : undefined

  if (pullRequest !== undefined && !work.pullRequests.includes(pullRequest)) {
    work.pullRequests = [...work.pullRequests, pullRequest].slice(-PULL_REQUESTS_LIMIT)
  }

  if (isCommit) {
    const match = COMMIT_MESSAGE.exec(summary)

    work.commits += 1
    work.lastCommit = { message: match?.[1] ?? match?.[2] ?? null, at: event.at }
  }

  if (isCommit || GIT_SHIP.test(summary)) {
    cycle.isCommitted = true
    cycle.last = 'commit'
  } else if (event.isReadOnly === false) {
    work.commands += 1
    cycle.changes += 1
    cycle.last = 'change'
  }
}

function applyMeasure(session: SessionState, event: ModEvent, change: Change): void {
  if (typeof event.contextPercent === 'number') {
    session.contextPercent = event.contextPercent
  }

  if (typeof event.costUsd === 'number') {
    session.costUsd = event.costUsd
  }

  const limits = event.rateLimits as RateLimit[] | undefined

  if (limits !== undefined && limits.length > 0) {
    change.rateLimits = limits
  }
}

function withoutFinal(parsed: ParsedProgress): Omit<ParsedProgress, 'isFinal'> {
  const { isFinal: _isFinal, ...counters } = parsed

  return counters
}

function runFailed(isDenied: boolean, hasCommandFailed: boolean, parsed: ParsedProgress | null): boolean | null {
  if (isDenied) {
    return null
  }

  return parsed === null ? hasCommandFailed : parsed.failed > 0 || hasCommandFailed
}

export function applyTestProgress(store: Store, session: SessionState, parsed: ParsedProgress, now: number): void {
  if (session.tests === null) {
    return
  }

  session.tests = { ...session.tests, progress: { ...withoutFinal(parsed), updatedAt: now } }
  store.saveTestRun(session.tests)
  store.touch(session)
}

function expectedDuration(store: Store, session: SessionState, command: string): number | null {
  const previous = store
    .testRuns(200)
    .find(run => run.repoRoot === session.repoRoot && run.command === command && run.endedAt !== null)

  return previous === undefined ? null : (previous.endedAt as number) - previous.startedAt
}

function describeTool(tool: string, summary: string): string {
  const short = clip(redact(summary), 120)

  switch (tool) {
    case 'Bash':
      return `Виконує: ${short}`
    case 'Read':
      return `Читає ${short}`
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
    case 'MultiEdit':
      return `Редагує ${short}`
    case 'Grep':
    case 'Glob':
      return `Шукає: ${short}`
    case 'Agent':
      return `Запускає агента: ${short}`
    default:
      return short === '' ? tool : `${tool}: ${short}`
  }
}
