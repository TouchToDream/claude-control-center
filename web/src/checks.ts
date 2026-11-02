import type { CheckKind, TestRun } from '../../server/types.ts'

export type CheckView = TestRun & {
  kind: CheckKind
  tool: string
  summary: string | null
  tail: string | null
}

export type CheckState = 'running' | 'passed' | 'failed' | 'stopped'

const ORDER: Record<CheckKind, number> = { tests: 0, lint: 1, analysis: 2 }

export const CHECK_LABEL: Record<CheckKind, string> = { tests: 'Тести', lint: 'Лінт', analysis: 'Аналіз коду' }

export const STATE_LABEL: Record<CheckState, string> = {
  running: 'йде',
  passed: 'пройшли',
  failed: 'впали',
  stopped: 'зупинено',
}

export function projectChecks(checks: readonly CheckView[] | undefined, repoRoot: string): CheckView[] {
  return (checks ?? []).filter(check => check.repoRoot === repoRoot).sort((left, right) => ORDER[left.kind] - ORDER[right.kind])
}

export function checkState(run: CheckView): CheckState {
  if (run.endedAt === null) {
    return 'running'
  }

  if (run.failed === null) {
    return 'stopped'
  }

  return run.failed ? 'failed' : 'passed'
}

export function checkNote(run: CheckView): string | null {
  const progress = run.progress

  if (run.kind === 'tests' && progress !== null && progress.total > 0) {
    return progress.failed > 0 ? `упало ${progress.failed} з ${progress.total}` : `тестів: ${progress.total}`
  }

  return run.summary
}

function span(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))

  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} хв ${seconds % 60} с`
}

export function runningLabel(run: CheckView, now: number): { left: string; right: string } {
  const elapsed = now - run.startedAt
  const progress = run.progress

  if (progress !== null && progress.total > 0 && progress.done > 0) {
    const share = Math.round((progress.done / progress.total) * 100)
    const left = (elapsed / progress.done) * (progress.total - progress.done)

    return { left: `${progress.done} з ${progress.total} · ${share}%`, right: `залишилось ~${span(left)}` }
  }

  if (run.expectedMs !== null && run.expectedMs > elapsed) {
    const share = Math.min(Math.round((elapsed / run.expectedMs) * 100), 97)

    return { left: `≈${share}% за минулим прогоном`, right: `залишилось ~${span(run.expectedMs - elapsed)}` }
  }

  return { left: run.expectedMs === null ? 'оцінка — з наступного прогону' : 'довше, ніж минулого разу', right: `минуло ${span(elapsed)}` }
}
