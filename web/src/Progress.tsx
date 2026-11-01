import type { SessionView, Stage } from './model.ts'
import { ago, STAGES } from './model.ts'

function hasHappened(stage: Stage, session: SessionView): boolean {
  const { cycle } = session

  switch (stage) {
    case 'plan':
      return cycle.reads > 0 || cycle.hasPlan
    case 'code':
      return cycle.changes > 0
    case 'tests':
      return cycle.tests !== null
    case 'review':
      return cycle.isCommitted
    case 'done':
      return cycle.isCommitted
  }
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100
  const units = count % 10

  if (tens >= 11 && tens <= 14) {
    return many
  }

  return units === 1 ? one : units >= 2 && units <= 4 ? few : many
}

function testsLine(session: SessionView, clock: number): string {
  const { testRuns, testFailures } = session.work
  const runs = `${testRuns} ${plural(testRuns, 'запуск', 'запуски', 'запусків')}`
  const failed = testFailures > 0 ? `, із падінням ${testFailures}` : ''
  const run = session.tests

  if (run === null || run.endedAt === null) {
    return `${runs}${failed}`
  }

  return `${runs}${failed}, останній ${run.failed === true ? 'впав' : 'пройшов'} ${ago(clock - run.endedAt)} тому`
}

function commitLine(session: SessionView, clock: number): string {
  const { commits, lastCommit } = session.work

  if (lastCommit === null) {
    return String(commits)
  }

  const message = lastCommit.message === null ? '' : `, «${lastCommit.message}»`

  return `${commits}${message}, ${ago(clock - lastCommit.at)} тому`
}

export function Progress({ session, clock }: { session: SessionView; clock: number }) {
  const { work } = session

  return (
    <>
      <div className="side-label small muted" title="Починається заново з першого повідомлення після коміту">
        Поточне завдання
      </div>
      <div className="stages">
        {STAGES.map(stage => {
          const isCurrent = stage.key === session.stage
          const hasFailed = stage.key === 'tests' && session.cycle.tests === 'failed'
          const state = hasFailed ? 'failed' : isCurrent ? 'current' : hasHappened(stage.key, session) ? 'past' : ''

          return (
            <div key={stage.key} className="stage">
              <div className={`stage-bar ${state}`} />
              <div className={`stage-name ${isCurrent ? 'current' : ''}`}>{stage.label}</div>
            </div>
          )
        })}
      </div>

      <div className="side-label small muted" title="Рахується з моменту, коли сесія підключилася до панелі">
        За сесію
      </div>
      <dl className="facts">
        <dt>Читання</dt>
        <dd>{work.reads}</dd>
        <dt>Правки</dt>
        <dd>
          {work.edits}
          {work.editedPaths.length > 0 && ` у ${work.editedPaths.length} ${plural(work.editedPaths.length, 'файлі', 'файлах', 'файлах')}`}
        </dd>
        <dt>Команди</dt>
        <dd>{work.commands}</dd>
        <dt>Тести</dt>
        <dd>{work.testRuns === 0 ? 'не запускались' : testsLine(session, clock)}</dd>
        <dt>Коміти</dt>
        <dd>{commitLine(session, clock)}</dd>
        {work.pullRequests.length > 0 && (
          <>
            <dt>PR</dt>
            <dd>
              {work.pullRequests.map(url => (
                <div key={url}>
                  <a href={url} target="_blank" rel="noreferrer">
                    #{url.split('/').at(-1)}
                  </a>
                </div>
              ))}
            </dd>
          </>
        )}
      </dl>
    </>
  )
}
