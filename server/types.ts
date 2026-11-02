export type Status = 'work' | 'tests' | 'ask' | 'chat' | 'waiting' | 'idle' | 'fail' | 'offline'

export type Stage = 'plan' | 'code' | 'tests' | 'review' | 'done'

export type AgentSnapshot = {
  id: string
  type: string
  description: string
  status: string
  parentId?: string
}

export type ChangedFile = {
  path: string
  added: number
  removed: number
  isNew: boolean
}

export type RateLimit = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type WorkStats = {
  reads: number
  edits: number
  commands: number
  editedPaths: string[]
  testRuns: number
  testFailures: number
  commits: number
  lastCommit: { message: string | null; at: number } | null
  pullRequests: string[]
}

export type TaskCycle = {
  startedAt: number
  hasPlan: boolean
  reads: number
  changes: number
  tests: 'passed' | 'failed' | null
  isCommitted: boolean
  last: 'read' | 'change' | 'test' | 'commit' | null
}

export type ModelOverride = {
  model: string | null
  effort: string | null
}

export type SessionState = {
  id: string
  cwd: string
  repoRoot: string
  repoName: string
  branch: string | null
  name: string
  nameSource: 'registry' | 'prompt' | 'fallback' | 'panel'
  registryName: string | null
  isBackground: boolean
  firstPrompt: string | null
  model: string | null
  effort: string | null
  override: ModelOverride
  version: string | null
  modVersion: string | null
  permissionMode: string | null
  terminal: string | null
  surfaces: string[]
  pid: number | null
  startedAt: number
  lastSeenAt: number
  endedAt: number | null
  endReason: string | null
  lastUserAt: number | null
  lastTurnStartAt: number | null
  lastTurnEndAt: number | null
  turnId: string | null
  turnEndReason: string | null
  runningTool: { id: string; tool: string; summary: string; startedAt: number } | null
  activity: string
  tests: TestRun | null
  turnError: boolean
  recentWork: boolean[]
  turnHadWork: boolean
  work: WorkStats
  cycle: TaskCycle
  contextPercent: number | null
  costUsd: number | null
  agents: AgentSnapshot[]
  files: ChangedFile[]
}

export type TestSuiteProgress = {
  name: string
  total: number
  done: number
  failed: number
}

export type TestProgress = {
  runner: string
  unit: 'tests' | 'files'
  total: number
  done: number
  failed: number
  suites: TestSuiteProgress[]
  updatedAt: number
}

export type TestRun = {
  id: string
  sessionId: string
  repoRoot: string
  command: string
  expectedMs: number | null
  startedAt: number
  endedAt: number | null
  failed: boolean | null
  progress: TestProgress | null
}

export type RowKind = 'user' | 'assistant' | 'tool' | 'result' | 'notice' | 'peer'

export type Row = {
  seq: number
  sessionId: string
  uuid: string
  ts: number
  agentId: string | null
  kind: RowKind
  text: string
  tool: string | null
  toolUseId: string | null
  isError: boolean
  viaPanel: boolean
}

export type OutboxStatus = 'queued' | 'claimed' | 'delivered' | 'dropped' | 'dismissed'

export type OutboxItem = {
  id: string
  sessionId: string
  kind: 'message' | 'abort' | 'inject' | 'interrupt' | 'bash'
  text: string
  status: OutboxStatus
  reason: string | null
  createdAt: number
  updatedAt: number
}

export type SessionCommand = {
  name: string
  description: string
  source: string
}

export type AskKind = 'permission' | 'question'

export type AskStatus = 'pending' | 'answered' | 'terminal' | 'expired'

export type Ask = {
  id: string
  sessionId: string
  kind: AskKind
  tool: string
  summary: string
  detail: string
  agentId: string | null
  answerable: boolean
  blockedBy: string | null
  status: AskStatus
  answer: unknown
  createdAt: number
  updatedAt: number
}

export type ModEvent = {
  t: string
  at: number
  [key: string]: unknown
}

export type Settings = {
  port: number
  key: string
  idleMinutes: number
  offlineSeconds: number
  testCommands: string[]
  modDir: string | null
}

export const MAC_EVENTS = ['question', 'permission', 'done', 'turnError', 'testsFailed', 'gone', 'limit'] as const

export type MacEvent = (typeof MAC_EVENTS)[number]

export type Alert = {
  id: string
  sessionId: string | null
  event: MacEvent
  title: string
  body: string
  askId: string | null
  createdAt: number
  readAt: number | null
}
