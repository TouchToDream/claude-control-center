import { useState } from 'react'
import { CHECK_LABEL, checkNote, checkState, projectChecks, runningLabel, STATE_LABEL } from './checks.ts'
import type { CheckView } from './checks.ts'
import { ago, duration } from './model.ts'
import { RunBar } from './TestsBar.tsx'

function CheckRow({ run, clock }: { run: CheckView; clock: number }) {
  const [isOpen, setIsOpen] = useState(false)
  const state = checkState(run)
  const note = checkNote(run)
  const live = state === 'running' ? runningLabel(run, clock) : null
  const timing = live?.right ?? `${ago(clock - (run.endedAt ?? run.startedAt))} · ${duration((run.endedAt ?? clock) - run.startedAt)}`
  const canOpen = run.tail !== null && state !== 'running'

  return (
    <div className={`check check-${state}`}>
      <button
        type="button"
        className="check-head ghost"
        aria-expanded={canOpen ? isOpen : undefined}
        disabled={!canOpen}
        title={run.command}
        onClick={() => setIsOpen(value => !value)}
      >
        <span className={`dot check-dot-${state} ${state === 'running' ? 'pulse' : ''}`} />
        <span className="check-name">{CHECK_LABEL[run.kind]}</span>
        <span className="check-tool mono small muted ellipsis">{run.tool}</span>
        <span className={`check-state small check-state-${state}`}>{STATE_LABEL[state]}</span>
      </button>
      {state === 'running' && <RunBar run={run} clock={clock} />}
      <div className="check-meta small muted">
        <span className="ellipsis">{live?.left ?? note ?? ''}</span>
        <span className="mono nowrap">{timing}</span>
      </div>
      {isOpen && run.tail !== null && <pre className="check-tail mono small">{run.tail}</pre>}
    </div>
  )
}

export function ChecksPanel({ checks, repoRoot, clock }: { checks: readonly CheckView[] | undefined; repoRoot: string; clock: number }) {
  const rows = projectChecks(checks, repoRoot)

  return (
    <section className="checks" aria-label="Перевірки проєкту">
      <div className="side-title small muted">Перевірки</div>
      {rows.length === 0 ? (
        <p className="small muted">У цьому проєкті тести, лінт і аналіз коду ще не запускали.</p>
      ) : (
        rows.map(run => <CheckRow key={`${run.kind}-${run.id}`} run={run} clock={clock} />)
      )}
    </section>
  )
}
