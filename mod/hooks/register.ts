import type { EngineInterface, Register } from 'claude-code'
import { clip, redact } from './redact.ts'

const MOD_VERSION = '0.8.0'
const TICK_MS = 1500
const FLUSH_MS = 700
const DOWN_RETRY_MS = 5000
const GIT_EVERY_MS = 10_000
const COMMANDS_EVERY_MS = 60_000
const BUFFER_LIMIT = 2000
const BATCH_BYTES = 1_500_000
const TEXT_LIMIT = 16_000
const RESULT_LIMIT = 4000
const SUMMARY_LIMIT = 300
const TAIL_LIMIT = 6000
const LONG_POLL_MS = 25_000
const ASK_WAIT_MS = 6 * 60 * 60 * 1000
const OPEN_COMMAND = 'control-center'
const SKIPPED_DOORS = new Set(['attachment', 'hook-context', 'queue', 'tool-message'])
const ROW_DOORS = ['prompt', 'command', 'response', 'tool-result', 'delivery', 'compaction', 'notice'] as const
const PERSON_ONLY_TOOLS = new Set(['ExitPlanMode'])
const SLASH_COMMAND = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/
const WANTS_OUTPUT = /test|spec|phpunit|pest|jest|vitest|gh\s+pr/i
const PEER_ENVELOPE = /<cross-session-message[^>]*from-name="([^"]*)"[^>]*>([\s\S]*?)<\/cross-session-message>/

type Dollar = EngineInterface
type Report = { t: string; [key: string]: unknown }
type Queued = Report & { at: number; sid: string | null }
type Config = { url: string; key: string }

type Command = {
  id: string
  kind: 'message' | 'abort' | 'inject' | 'interrupt' | 'bash'
  text: string
}

type AskRecord = {
  id: string
  status: 'pending' | 'answered' | 'terminal' | 'expired'
  answer: { decision?: 'allow' | 'deny'; message?: string; answers?: Record<string, string> } | null
}

type CheckMemo = { rule: string | null }

type ModelOverride = { model: string | null; effort: string | null }

const bridge = {
  config: null as Config | null,
  sessionId: null as string | null,
  buffer: [] as Queued[],
  isFlushing: false,
  isPolling: false,
  isRunningCommand: false,
  isRefreshing: false,
  downUntil: 0,
  hasSaidHello: false,
  turnId: null as string | null,
  gitDirty: true,
  gitCheckedAt: 0,
  agentsJson: '[]',
  commandsJson: '',
  commandsCheckedAt: 0,
  modelJson: '',
  unreadInjection: null as string | null,
  override: null as ModelOverride | null,
  checks: new Map<string, CheckMemo>(),
  openAsks: new Map<string, string>(),
}

function report(event: Report): void {
  bridge.buffer.push({ ...event, at: Date.now(), sid: bridge.sessionId })

  if (bridge.buffer.length > BUFFER_LIMIT) {
    bridge.buffer.splice(0, bridge.buffer.length - BUFFER_LIMIT)
  }
}

function mask(text: string, limit: number): string {
  return clip(redact(text), limit)
}

async function loadConfig($: Dollar): Promise<Config | null> {
  const home = (await $.env.get('CCC_HOME')) ?? `${await $.env.get('HOME')}/.claude-control-center`

  try {
    const stored = JSON.parse(await $.fs.read(`${home}/config.json`)) as { port: number; key: string }

    return { url: `http://127.0.0.1:${stored.port}`, key: stored.key }
  } catch {
    return null
  }
}

async function call($: Dollar, path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const config = bridge.config

  if (config === null) {
    throw new Error('not configured')
  }

  const response = await $.http.fetch(`${config.url}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'x-ccc-key': config.key, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

  if (!response.ok) {
    throw new Error(`status ${response.status}`)
  }

  return JSON.parse(response.text)
}

function markDown(): void {
  bridge.downUntil = Date.now() + DOWN_RETRY_MS
  bridge.hasSaidHello = false
}

function isDown(): boolean {
  return Date.now() < bridge.downUntil
}

async function flush($: Dollar): Promise<void> {
  if (bridge.isFlushing || bridge.config === null || isDown() || bridge.buffer.length === 0) {
    return
  }

  bridge.isFlushing = true

  try {
    const sid = bridge.buffer[0]?.sid ?? bridge.sessionId

    if (sid === null || sid === undefined) {
      return
    }

    const batch: Queued[] = []
    let bytes = 0

    for (const event of bridge.buffer) {
      if ((event.sid ?? sid) !== sid) {
        break
      }

      bytes += JSON.stringify(event).length

      if (bytes > BATCH_BYTES && batch.length > 0) {
        break
      }

      batch.push(event)
    }

    await call($, '/api/mod/events', { method: 'POST', body: { sessionId: sid, events: batch } })
    bridge.buffer.splice(0, batch.length)
  } catch {
    markDown()
  } finally {
    bridge.isFlushing = false
  }
}

async function detectTerminal($: Dollar): Promise<string | null> {
  const bundle = await $.env.get('__CFBundleIdentifier')
  const emulator = await $.env.get('TERMINAL_EMULATOR')
  const program = await $.env.get('TERM_PROGRAM')

  if (emulator === 'JetBrains-JediTerm' && bundle !== undefined) {
    return bundle.split('.').at(-1) ?? 'JetBrains'
  }

  return program ?? emulator ?? bundle ?? null
}

async function sayHello($: Dollar): Promise<void> {
  const [cwd, repo, model, surfaces, version, terminal] = await Promise.all([
    $.session.cwd(),
    $.session.repo(),
    $.session.model(),
    $.session.surfaces(),
    $.session.version(),
    detectTerminal($),
  ])

  report({
    t: 'hello',
    cwd,
    repoRoot: repo?.root ?? null,
    model,
    surfaces,
    version: version.version,
    modVersion: MOD_VERSION,
    terminal,
  })
  bridge.hasSaidHello = true
  bridge.gitDirty = true
  bridge.commandsJson = ''
  bridge.commandsCheckedAt = 0
}

async function refreshGit($: Dollar): Promise<void> {
  const now = Date.now()

  if (!bridge.gitDirty || now - bridge.gitCheckedAt < GIT_EVERY_MS) {
    return
  }

  bridge.gitCheckedAt = now
  bridge.gitDirty = false

  const branch = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 })

  if (branch.exitCode !== 0) {
    return
  }

  const diff = await $.process.run(['git', 'diff', '--numstat', 'HEAD'], { timeoutMs: 5000 })
  const files = diff.stdout
    .split('\n')
    .filter(line => line !== '')
    .slice(0, 200)
    .map(line => {
      const [added, removed, path] = line.split('\t')

      return { path: path ?? '', added: Number(added) || 0, removed: Number(removed) || 0, isNew: false }
    })
  const untracked = await $.process.run(['git', 'ls-files', '--others', '--exclude-standard'], { timeoutMs: 5000 })
  const created = untracked.stdout
    .split('\n')
    .filter(path => path !== '')
    .slice(0, 200 - files.length)
    .map(path => ({ path, added: 0, removed: 0, isNew: true }))

  report({ t: 'git', branch: branch.stdout.trim(), files: [...files, ...created] })
}

async function refreshAgents($: Dollar): Promise<void> {
  const list = (await $.agent.list()).map(agent => ({
    id: agent.id,
    type: agent.type,
    description: mask(agent.description, SUMMARY_LIMIT),
    status: agent.status,
    parentId: agent.parentId,
  }))
  const json = JSON.stringify(list)

  if (json !== bridge.agentsJson) {
    bridge.agentsJson = json
    report({ t: 'agents', list })
  }
}

async function refreshCommands($: Dollar): Promise<void> {
  const now = Date.now()

  if (now - bridge.commandsCheckedAt < COMMANDS_EVERY_MS) {
    return
  }

  bridge.commandsCheckedAt = now

  const list = (await $.command.list()).map(command => ({
    name: command.name,
    description: mask(command.description, SUMMARY_LIMIT),
    source: command.source,
  }))
  const json = JSON.stringify(list)

  if (json !== bridge.commandsJson) {
    bridge.commandsJson = json
    report({ t: 'commands', list })
  }
}

async function runShell($: Dollar, command: Command): Promise<string | null> {
  report({
    t: 'row',
    uuid: `shell-${command.id}`,
    door: 'prompt',
    role: 'user',
    viaPanel: true,
    blocks: [{ type: 'text', text: mask(`!${command.text}`, TEXT_LIMIT) }],
  })

  const answer = await $.tool.call({ tool: 'Bash', command: command.text, description: 'Команда з Центру керування' })

  const toolUseId = `shell-${command.id}`
  const showResult = (text: string, isError: boolean) =>
    report({
      t: 'row',
      uuid: `${toolUseId}-out`,
      door: 'tool-result',
      role: 'user',
      viaPanel: true,
      blocks: [{ type: 'tool_result', tool_use_id: toolUseId, text: mask(text, TEXT_LIMIT), is_error: isError }],
    })

  report({
    t: 'row',
    uuid: `${toolUseId}-call`,
    door: 'response',
    role: 'assistant',
    viaPanel: true,
    blocks: [{ type: 'tool_use', id: toolUseId, name: 'Bash', summary: mask(command.text, TEXT_LIMIT) }],
  })

  if (answer.deny !== undefined) {
    showResult(answer.deny, true)

    return `Команду не дозволено: ${answer.deny}`
  }

  const record = (answer.result ?? {}) as { stdout?: string; stderr?: string }
  const stdout = record.stdout ?? answer.text ?? ''
  const stderr = record.stderr ?? ''
  const output = `<bash-stdout>${stdout}</bash-stdout><bash-stderr>${stderr}</bash-stderr>`

  showResult([stdout, stderr].filter(part => part !== '').join('\n'), answer.isError === true)

  await $.session.append({
    message: {
      type: 'user',
      content: [
        { type: 'text', text: `<bash-input>${command.text}</bash-input>` },
        { type: 'text', text: output },
      ],
    },
  })

  return null
}

async function runCommand($: Dollar, command: Command): Promise<void> {
  const settle = (status: 'delivered' | 'dropped', reason?: string) =>
    call($, `/api/mod/commands/${command.id}`, { method: 'POST', body: { status, reason } })

  try {
    const submit = async () => {
      const entered = await $.prompt.submit({ text: command.text, asUser: true })

      await (entered.drop === undefined ? settle('delivered') : settle('dropped', entered.drop))
    }

    const slash = command.kind === 'message' ? SLASH_COMMAND.exec(command.text.trim()) : null

    if (slash !== null) {
      await $.command.run({ command: slash[1] as string, args: slash[2] ?? '' })
      await settle('delivered')
    } else if (command.kind === 'inject' && bridge.turnId !== null) {
      await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: command.text }] } })
      bridge.unreadInjection = command.text
      report({
        t: 'row',
        uuid: `inject-${command.id}`,
        door: 'prompt',
        role: 'user',
        viaPanel: true,
        blocks: [{ type: 'text', text: mask(command.text, TEXT_LIMIT) }],
      })
      await settle('delivered')
    } else if (command.kind === 'bash') {
      const refusal = await runShell($, command)

      await (refusal === null ? settle('delivered') : settle('dropped', refusal))
    } else if (command.kind === 'interrupt') {
      if (bridge.turnId !== null) {
        await $.turn.abort({ turnId: bridge.turnId })
      }

      await submit()
    } else if (command.kind === 'message' || command.kind === 'inject') {
      await submit()
    } else if (bridge.turnId === null) {
      await settle('dropped', 'Хід уже завершено')
    } else {
      await $.turn.abort({ turnId: bridge.turnId })
      await settle('delivered')
    }
  } catch (error) {
    await settle('dropped', error instanceof Error ? error.message : 'Не вдалося доставити').catch(() => {})
  } finally {
    bridge.isRunningCommand = false
  }
}

async function poll($: Dollar): Promise<void> {
  if (bridge.isPolling || bridge.config === null || isDown() || bridge.sessionId === null) {
    return
  }

  bridge.isPolling = true

  try {
    const idle = bridge.turnId === null ? 1 : 0
    const claim = bridge.isRunningCommand ? 0 : 1
    const session = encodeURIComponent(bridge.sessionId)
    const answer = (await call($, `/api/mod/poll?session=${session}&idle=${idle}&claim=${claim}`)) as {
      commands: Command[]
      override: ModelOverride | null
    }

    bridge.override = answer.override

    for (const command of answer.commands) {
      bridge.isRunningCommand = true
      void runCommand($, command)
    }
  } catch {
    markDown()
  } finally {
    bridge.isPolling = false
  }
}

async function openPanel($: Dollar): Promise<string> {
  bridge.config ??= await loadConfig($)

  const config = bridge.config

  if (config === null) {
    return 'Центр керування ще не налаштовано: запусти сервіс командою npm run ccc -- start'
  }

  try {
    await $.http.fetch(`${config.url}/api/panel/state`)
  } catch {
    return 'Сервіс панелі не відповідає: запусти його командою npm run ccc -- start'
  }

  const sessionId = await $.session.id()
  const inApp = await $.process.run(['open', '-g', `ccc://session/${encodeURIComponent(sessionId)}`], { timeoutMs: 5000 })

  if (inApp.exitCode === 0) {
    return 'Центр керування відкрито'
  }

  const opened = await $.process.run(['open', `${config.url}/?key=${config.key}#${sessionId}`], {
    timeoutMs: 5000,
  })

  return opened.exitCode === 0 ? 'Центр керування відкрито' : 'Не вдалося відкрити браузер'
}

async function tick($: Dollar): Promise<void> {
  bridge.config ??= await loadConfig($)

  const id = await $.session.id()

  if (id !== bridge.sessionId) {
    bridge.sessionId = id
    bridge.hasSaidHello = false
  }

  if (bridge.config === null || isDown()) {
    return
  }

  if (!bridge.hasSaidHello) {
    await sayHello($).catch(() => {})
  }

  await poll($)

  if (!bridge.isRefreshing) {
    bridge.isRefreshing = true
    void Promise.allSettled([refreshGit($), refreshAgents($), refreshCommands($)]).finally(() => {
      bridge.isRefreshing = false
    })
  }
}

function field(source: unknown, key: string): unknown {
  return typeof source === 'object' && source !== null ? (source as Record<string, unknown>)[key] : undefined
}

function summarize(tool: string, input: unknown): string {
  const questions = field(input, 'questions')

  if (Array.isArray(questions)) {
    return mask(String(field(questions[0], 'question') ?? tool), SUMMARY_LIMIT)
  }

  const pick = (key: string) => {
    const value = field(input, key)

    return typeof value === 'string' ? value : undefined
  }
  const text =
    pick('command') ??
    pick('file_path') ??
    pick('notebook_path') ??
    pick('pattern') ??
    pick('url') ??
    pick('query') ??
    pick('description') ??
    pick('prompt') ??
    ''

  return mask(text, SUMMARY_LIMIT) || tool
}

function blockText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map(block => (field(block, 'type') === 'text' ? String(field(block, 'text') ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

function toBlocks(content: unknown): unknown[] {
  const list = typeof content === 'string' ? [{ type: 'text', text: content }] : content

  if (!Array.isArray(list)) {
    return []
  }

  return list.flatMap(block => {
    const type = field(block, 'type')

    if (type === 'text') {
      return [{ type, text: mask(String(field(block, 'text') ?? ''), TEXT_LIMIT) }]
    }

    if (type === 'tool_use') {
      const name = String(field(block, 'name') ?? '')

      return [{ type, id: field(block, 'id'), name, summary: summarize(name, field(block, 'input')) }]
    }

    if (type === 'tool_result') {
      return [
        {
          type,
          tool_use_id: field(block, 'tool_use_id'),
          text: mask(blockText(field(block, 'content')), RESULT_LIMIT),
          is_error: field(block, 'is_error') === true,
        },
      ]
    }

    return []
  })
}

function askKey(tool: string, summary: string): string {
  return `${tool}:${summary}`
}

async function postAsk(
  $: Dollar,
  ask: { id: string; kind: 'permission' | 'question'; tool: string; summary: string; detail: string; agentId: string | null; blockedBy: string | null },
): Promise<boolean> {
  if (bridge.config === null || isDown() || bridge.sessionId === null) {
    return false
  }

  try {
    await call($, '/api/mod/asks', { method: 'POST', body: { ...ask, sessionId: bridge.sessionId } })

    return true
  } catch {
    markDown()

    return false
  }
}

function closeAsk($: Dollar, id: string, status: 'terminal' | 'expired'): void {
  void call($, `/api/mod/asks/${id}/close`, { method: 'POST', body: { status } }).catch(() => {})
}

async function waitForAnswer($: Dollar, id: string, signal: AbortSignal): Promise<AskRecord | null> {
  const deadline = Date.now() + ASK_WAIT_MS

  while (Date.now() < deadline && !signal.aborted) {
    try {
      const left = Math.min(LONG_POLL_MS, deadline - Date.now())
      const { ask } = (await call($, `/api/mod/asks/${id}/wait?ms=${left}`)) as { ask: AskRecord }

      if (ask.status !== 'pending') {
        return ask
      }
    } catch {
      markDown()

      return null
    }
  }

  return null
}

function settleAskOf(tool: string, summary: string, $: Dollar): void {
  const key = askKey(tool, summary)
  const id = bridge.openAsks.get(key)

  if (id !== undefined) {
    bridge.openAsks.delete(key)
    closeAsk($, id, 'terminal')
  }
}

function askId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function answerQuestion(
  $: Dollar,
  input: Record<string, unknown>,
  dialog: () => Promise<unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const questions = input.questions as { question: string }[]
  const id = askId()
  const posted = await postAsk($, {
    id,
    kind: 'question',
    tool: 'AskUserQuestion',
    summary: mask(questions[0]?.question ?? 'Питання', SUMMARY_LIMIT),
    detail: mask(JSON.stringify(questions), TEXT_LIMIT),
    agentId: (input.agentId as string | undefined) ?? null,
    blockedBy: null,
  })

  if (!posted) {
    return dialog()
  }

  const terminal = dialog().then(result => ({ from: 'terminal' as const, result }))
  const panel = waitForAnswer($, id, signal).then(ask => ({ from: 'panel' as const, ask }))
  const first = await Promise.race([terminal, panel])

  if (first.from === 'panel' && first.ask?.answer?.answers !== undefined) {
    return { result: { questions, answers: first.ask.answer.answers } }
  }

  const settled = await terminal

  closeAsk($, id, 'terminal')

  return settled.result
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    bridge.sessionId = await $.session.id()
    await $.command
      .register({ name: OPEN_COMMAND, description: 'Відкрити Центр керування на цій сесії', immediate: true })
      .catch(() => {})
    $.clock.every(TICK_MS, () => void tick($).catch(() => {}))
    $.clock.every(FLUSH_MS, () => void flush($).catch(() => {}))

    return started
  })

  on('command.run', { command: OPEN_COMMAND }, async $ => {
    $.ui.toast(await openPanel($))

    return {}
  })

  on('session.end', ($, e, next) => {
    void call($, '/api/mod/events', {
      method: 'POST',
      body: { sessionId: e.sessionId, events: [{ t: 'session_end', reason: e.reason, at: Date.now() }] },
    }).catch(() => {})

    if (e.reason === 'clear' || e.reason === 'resume') {
      bridge.sessionId = null
    }

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    report({
      t: 'prompt',
      text: mask(e.text, TEXT_LIMIT),
      isMeta: e.isMeta,
      command: e.command?.name,
      origin: e.origin.kind,
    })

    return next(e)
  })

  on('session.append', { door: [...ROW_DOORS] }, ($, e, next) => {
    const isPeer = e.door === 'delivery'

    if (!SKIPPED_DOORS.has(e.door) && (e.message.isMeta !== true || isPeer)) {
      report({
        t: 'row',
        uuid: e.uuid,
        door: e.door,
        role: e.message.role,
        agentId: e.agentId,
        viaPanel: e.origin.kind === 'plugin',
        blocks: toBlocks(e.message.content),
      })
    }

    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      bridge.turnId = e.turnId
    }

    report({ t: 'turn_start', turnId: e.turnId, agentId: e.agentId })

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      bridge.turnId = null

      if (bridge.unreadInjection !== null) {
        void $.prompt.submit({ text: bridge.unreadInjection, asUser: true }).catch(() => {})
        bridge.unreadInjection = null
      }
    }

    bridge.gitDirty = true
    report({ t: 'turn_complete', agentId: e.agentId, reason: e.reason })

    return next(e)
  })

  on('session.measure', ($, e, next) => {
    report({
      t: 'measure',
      contextPercent: e.context.percent,
      costUsd: e.cost?.usd,
      rateLimits: e.rateLimits.map(limit => ({
        kind: limit.kind,
        percentUsed: limit.percentUsed,
        resetsAt: limit.resetsAt,
      })),
    })

    return next(e)
  })

  on('session.send', async ($, e, next) => {
    const sent = await next(e)

    report({ t: 'peer_send', to: e.to, text: mask(e.text, RESULT_LIMIT), ok: sent.isDelivered })

    return sent
  })

  on('session.receive', ($, e, next) => {
    const envelope = PEER_ENVELOPE.exec(e.text)

    report({
      t: 'peer_receive',
      from: envelope?.[1] ?? e.origin.kind,
      text: mask((envelope?.[2] ?? e.text).trim(), RESULT_LIMIT),
    })

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }

    bridge.unreadInjection = null
    bridge.turnId = e.turnId

    const step = {
      ...e,
      model: bridge.override?.model ?? e.model,
      effort: (bridge.override?.effort as typeof e.effort | null | undefined) ?? e.effort,
    }
    const modelJson = JSON.stringify([step.model, step.effort])

    if (modelJson !== bridge.modelJson) {
      bridge.modelJson = modelJson
      report({ t: 'model', model: step.model, effort: step.effort })
    }

    return yield* next(step)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const id = e.tool_use_id ?? askId()
    const summary = summarize(tool, input)
    const agentId = e.agentId

    report({ t: 'tool_start', id, tool, agentId, summary, background: input.run_in_background === true })

    const ran =
      tool === 'AskUserQuestion'
        ? ((await answerQuestion($, input, () => next(e), next.signal)) as Awaited<ReturnType<typeof next>>)
        : await next(e)

    settleAskOf(tool, summary, $)
    bridge.gitDirty = true
    report({
      t: 'tool_end',
      id,
      tool,
      agentId,
      summary,
      isError: ran.isError === true,
      denied: ran.deny !== undefined,
      isReadOnly: ran.isReadOnly === true,
      tail: tool === 'Bash' && WANTS_OUTPUT.test(summary) ? mask((ran.text ?? '').slice(-TAIL_LIMIT), TAIL_LIMIT) : undefined,
    })

    return ran
  })

  on('tool.check', async ($, e, next) => {
    const decided = await next(e)

    if (decided.decision === 'ask') {
      bridge.checks.set(askKey(e.tool, summarize(e.tool, e.input)), {
        rule: decided.rule ?? decided.hook ?? decided.setting ?? null,
      })

      if (bridge.checks.size > 200) {
        bridge.checks.delete(bridge.checks.keys().next().value as string)
      }
    }

    return decided
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    const under = await next(e)

    if (under.decision !== undefined || e.tool_name === 'AskUserQuestion') {
      return under
    }

    const id = askId()
    const summary = summarize(e.tool_name, e.tool_input)
    const key = askKey(e.tool_name, summary)
    const blockedBy = PERSON_ONLY_TOOLS.has(e.tool_name) ? e.tool_name : (bridge.checks.get(key)?.rule ?? null)
    const posted = await postAsk($, {
      id,
      kind: 'permission',
      tool: e.tool_name,
      summary,
      detail: mask(JSON.stringify(e.tool_input, null, 2), TEXT_LIMIT),
      agentId: e.agent_id ?? null,
      blockedBy,
    })

    if (!posted) {
      return under
    }

    bridge.openAsks.set(key, id)

    if (blockedBy !== null) {
      return under
    }

    const ask = await waitForAnswer($, id, next.signal)

    bridge.openAsks.delete(key)

    if (ask?.status !== 'answered' || ask.answer?.decision === undefined) {
      closeAsk($, id, 'terminal')

      return under
    }

    return ask.answer.decision === 'allow'
      ? { ...under, decision: { behavior: 'allow' as const } }
      : { ...under, decision: { behavior: 'deny' as const, message: ask.answer.message ?? 'Відхилено в панелі' } }
  })
}
