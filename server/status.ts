import type { Ask, SessionState, Stage, Status } from './types.ts'

export type StatusRules = {
  idleMinutes: number
  offlineSeconds: number
}

const CHAT_WINDOW = 3
const WRAPPERS = new Set(['npx', 'bunx', 'php', 'python', 'python3', 'time', 'exec', 'env', 'nice', 'timeout'])
const FLAGS_WITH_VALUE = new Set(['-d', '-c'])

export function computeStatus(
  session: SessionState,
  pendingAsks: readonly Ask[],
  now: number,
  rules: StatusRules,
): Status {
  if (session.endedAt !== null || now - session.lastSeenAt > rules.offlineSeconds * 1000) {
    return 'offline'
  }

  if (pendingAsks.some(ask => ask.sessionId === session.id)) {
    return 'ask'
  }

  if (session.tests !== null && session.tests.endedAt === null) {
    return 'tests'
  }

  if (session.turnId !== null || session.runningTool !== null) {
    return 'work'
  }

  if (session.turnError || session.tests?.failed === true) {
    return 'fail'
  }

  const lastTouch = Math.max(session.lastUserAt ?? 0, session.lastTurnEndAt ?? 0, session.startedAt)

  if (now - lastTouch > rules.idleMinutes * 60_000) {
    return 'idle'
  }

  const recent = session.recentWork.slice(-CHAT_WINDOW)

  return recent.some(Boolean) ? 'waiting' : 'chat'
}

export function computeStage(session: SessionState, status: Status): Stage {
  const { cycle } = session

  if (session.tests !== null && session.tests.endedAt === null) {
    return 'tests'
  }

  if (cycle.isCommitted) {
    return 'done'
  }

  if (cycle.changes === 0) {
    return cycle.hasPlan ? 'code' : 'plan'
  }

  if (status === 'work' || status === 'ask') {
    return cycle.last === 'test' ? 'tests' : 'code'
  }

  return cycle.tests === 'failed' ? 'tests' : 'review'
}

export function splitCommand(command: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string
    const next = command[index + 1]

    if (char === '\\' && quote !== "'") {
      current += char + (next ?? '')
      index += 1
    } else if (quote !== null) {
      quote = char === quote ? null : quote
      current += char
    } else if (char === '"' || char === "'") {
      quote = char
      current += char
    } else if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
      parts.push(current)
      current = ''
      index += 1
    } else if (char === ';' || char === '|' || char === '\n') {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }

  return [...parts, current].map(part => part.trim().replace(/\s+/g, ' ')).filter(part => part !== '')
}

export function matchesAnyCommand(command: string, patterns: readonly string[]): boolean {
  return splitCommand(command)
    .map(part => part.replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, ''))
    .some(part => patterns.some(pattern => matchesCommand(part, pattern)))
}

export function isTestCommand(command: string, testCommands: readonly string[]): boolean {
  return matchesAnyCommand(command, testCommands)
}

function unwrap(words: readonly string[]): string[] {
  let rest = [...words]

  while (WRAPPERS.has((rest[0] ?? '').split('/').at(-1) ?? '')) {
    rest = rest.slice(1)

    while ((rest[0] ?? '').startsWith('-') || /^\d+[smh]?$/.test(rest[0] ?? '') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0] ?? '')) {
      rest = rest.slice(FLAGS_WITH_VALUE.has(rest[0] ?? '') ? 2 : 1)
    }
  }

  return rest
}

function matchesCommand(part: string, pattern: string): boolean {
  const words = part.split(' ')
  const unwrapped = unwrap(words)

  return [words, unwrapped].some(candidate => {
    const [head = '', ...rest] = candidate
    const line = [head.split('/').at(-1), ...rest].join(' ')

    return line === pattern || line.startsWith(`${pattern} `)
  })
}
