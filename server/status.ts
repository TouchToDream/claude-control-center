import type { Ask, SessionState, Stage, Status } from './types.ts'

export type StatusRules = {
  idleMinutes: number
  offlineSeconds: number
}

const CHAT_WINDOW = 3
const WRAPPERS = new Set(['npx', 'bunx', 'php', 'python', 'python3', 'time', 'exec'])

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

export function isTestCommand(command: string, testCommands: readonly string[]): boolean {
  const normalized = command.trim().replace(/\s+/g, ' ')

  return normalized
    .split(/&&|\|\||;|\|/)
    .map(part => part.trim().replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, ''))
    .some(part => testCommands.some(pattern => matchesCommand(part, pattern)))
}

function matchesCommand(part: string, pattern: string): boolean {
  const words = part.split(' ')
  const unwrapped = WRAPPERS.has(words[0] ?? '') ? words.slice(1) : words

  return [words, unwrapped].some(candidate => {
    const [head = '', ...rest] = candidate
    const line = [head.split('/').at(-1), ...rest].join(' ')

    return line === pattern || line.startsWith(`${pattern} `)
  })
}
