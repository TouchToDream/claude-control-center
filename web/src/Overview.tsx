import type { Ask, SessionView, Snapshot, Status, TimelineEntry } from './model.ts'
import { ago, duration, isLive, STATUS_LABEL } from './model.ts'
import { TestsBar } from './TestsBar.tsx'

const HOUR = 60 * 60 * 1000

const LEGEND: { status: Status | 'quiet'; label: string }[] = [
  { status: 'work', label: 'робота' },
  { status: 'chat', label: 'обговорення' },
  { status: 'ask', label: 'чекає на тебе' },
  { status: 'fail', label: 'помилка' },
  { status: 'quiet', label: 'тиша' },
]

type Segment = { status: Status | 'quiet'; share: number }

export function segmentsFor(
  entries: readonly TimelineEntry[],
  session: SessionView,
  now: number,
): Segment[] {
  const start = now - HOUR
  const own = entries.filter(entry => entry.sessionId === session.id)
  const segments: Segment[] = []
  let cursor = start
  let status: Status | 'quiet' = 'quiet'

  for (const entry of own) {
    segments.push({ status, share: (entry.ts - cursor) / HOUR })
    cursor = entry.ts
    status = entry.status
  }

  segments.push({ status: own.length === 0 ? mapQuiet(session.status) : status, share: (now - cursor) / HOUR })

  return segments.filter(segment => segment.share > 0).map(segment => ({
    ...segment,
    status: mapQuiet(segment.status),
  }))
}

function mapQuiet(status: Status | 'quiet'): Status | 'quiet' {
  return status === 'waiting' || status === 'offline' || status === 'idle' ? 'quiet' : status
}

function Attention({
  snapshot,
  onOpen,
}: {
  snapshot: Snapshot
  onOpen: (id: string) => void
}) {
  const asks = snapshot.asks
  const failed = snapshot.sessions.filter(session => session.status === 'fail')
  const sessionOf = (ask: Ask) => snapshot.sessions.find(session => session.id === ask.sessionId)

  return (
    <>
      {asks.map(ask => {
        const session = sessionOf(ask)

        return (
          <div key={ask.id} className="attention">
            <div className="attention-text">
              <div className="mono small attention-repo">
                {session?.repoName} · {session?.name}
              </div>
              <div className="attention-title">
                {ask.kind === 'question' ? ask.summary : `Дозвіл: ${ask.tool} · ${ask.summary}`}
              </div>
            </div>
            <button type="button" className="ghost attention-button" onClick={() => onOpen(ask.sessionId)}>
              Відкрити й відповісти
            </button>
          </div>
        )
      })}
      {failed.map(session => (
        <div key={session.id} className="attention failed">
          <div className="attention-text">
            <div className="mono small attention-repo">
              {session.repoName} · {session.name}
            </div>
            <div className="attention-title">{session.turnError ? 'Хід завершився помилкою' : 'Тести впали'}</div>
          </div>
          <button type="button" className="ghost attention-button" onClick={() => onOpen(session.id)}>
            Відкрити
          </button>
        </div>
      ))}
    </>
  )
}

function Timeline({
  snapshot,
  timeline,
  clock,
  onOpen,
}: {
  snapshot: Snapshot
  timeline: readonly TimelineEntry[]
  clock: number
  onOpen: (id: string) => void
}) {
  const active = new Set(timeline.map(entry => entry.sessionId))
  const sessions = snapshot.sessions.filter(session => isLive(session) || active.has(session.id))

  return (
    <section className="card">
      <div className="card-head">
        <h2>Остання година</h2>
        <div className="legend small muted">
          {LEGEND.map(item => (
            <span key={item.status}>
              <span className={`swatch seg-${item.status}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      {sessions.length === 0 && <p className="small muted">За останню годину сесій не було.</p>}
      {sessions.map(session => (
        <button type="button" key={session.id} className="timeline-row" onClick={() => onOpen(session.id)}>
          <span className="timeline-name">
            <span className="ellipsis">{session.name}</span>
            <span className="small muted ellipsis">
              {session.repoName} · {session.activity}
            </span>
          </span>
          <span className="timeline-bar">
            {segmentsFor(timeline, session, clock).map((segment, index) => (
              <span
                key={index}
                className={`seg-${segment.status}`}
                style={{ flexGrow: segment.share, flexBasis: 0 }}
              />
            ))}
          </span>
          <span className={`small timeline-status text-${session.status}`}>{STATUS_LABEL[session.status]}</span>
        </button>
      ))}
    </section>
  )
}

function History({ snapshot, clock, onOpen }: { snapshot: Snapshot; clock: number; onOpen: (id: string) => void }) {
  const finished = snapshot.testRuns.filter(run => (run.kind ?? 'tests') === 'tests' && run.endedAt !== null).slice(0, 6)

  if (finished.length === 0) {
    return null
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Історія тестів</h2>
      </div>
      {finished.map(run => {
        const session = snapshot.sessions.find(item => item.id === run.sessionId)
        const label = run.failed === true ? 'упали' : run.failed === false ? 'пройшли' : 'завершено'

        return (
          <button type="button" key={run.id} className="history-row" onClick={() => onOpen(run.sessionId)}>
            <span className="ellipsis">
              <span className="mono small">{run.command}</span>
              <span className="small muted"> · {session?.repoName ?? 'сесія закрита'}</span>
            </span>
            <span className="mono small muted nowrap">{duration((run.endedAt as number) - run.startedAt)}</span>
            <span className={`small nowrap ${run.failed === true ? 'text-fail' : 'text-work'}`}>{label}</span>
            <span className="small muted nowrap">{ago(clock - (run.endedAt as number))} тому</span>
          </button>
        )
      })}
    </section>
  )
}

type Props = {
  snapshot: Snapshot
  timeline: readonly TimelineEntry[]
  clock: number
  onOpen: (id: string) => void
}

export function Overview({ snapshot, timeline, clock, onOpen }: Props) {
  const runningTests = snapshot.sessions.flatMap(session =>
    session.tests !== null && session.tests.endedAt === null ? [session.tests] : [],
  )

  return (
    <div className="overview">
      <Attention snapshot={snapshot} onOpen={onOpen} />
      {runningTests.map(run => (
        <button type="button" key={run.id} className="card card-button" onClick={() => onOpen(run.sessionId)}>
          <TestsBar run={run} clock={clock} />
        </button>
      ))}
      <Timeline snapshot={snapshot} timeline={timeline} clock={clock} onOpen={onOpen} />
      <History snapshot={snapshot} clock={clock} onOpen={onOpen} />
    </div>
  )
}
