import { duration, expectedShare, testEta } from './model.ts'
import type { TestRun } from './model.ts'

function title(run: TestRun): string {
  if (run.endedAt === null) {
    return 'Тести йдуть'
  }

  if (run.failed === true) {
    return 'Тести впали'
  }

  return run.failed === false ? 'Тести пройшли' : 'Тести завершено'
}

export function TestsBar({ run, clock, isCompact = false }: { run: TestRun; clock: number; isCompact?: boolean }) {
  const progress = run.progress
  const elapsed = (run.endedAt ?? clock) - run.startedAt
  const hasTotal = progress !== null && progress.total > 0
  const passedShare = hasTotal ? ((progress.done - progress.failed) / progress.total) * 100 : 0
  const failedShare = hasTotal ? (progress.failed / progress.total) * 100 : 0
  const eta = testEta(run, clock)
  const expected = hasTotal ? null : expectedShare(run, clock)
  const unit = progress?.unit === 'files' ? 'файлів' : 'тестів'

  return (
    <div className={`tests ${isCompact ? 'compact' : ''}`}>
      <div className="tests-head">
        <div>
          <div className={isCompact ? 'mono small' : 'tests-title'}>{title(run)}</div>
          <div className="mono small muted ellipsis">{run.command}</div>
        </div>
        <div className="tests-numbers mono">
          {progress !== null && (
            <>
              <div>
                <div>{hasTotal ? `${progress.done} з ${progress.total}` : progress.done}</div>
                <div className="small muted">{unit} виконано</div>
              </div>
              <div>
                <div className="text-fail">{progress.failed}</div>
                <div className="small muted">упало</div>
              </div>
            </>
          )}
          <div>
            <div>{eta ?? duration(elapsed)}</div>
            <div className="small muted">{eta === null ? 'минуло' : 'залишилось'}</div>
          </div>
        </div>
      </div>
      <div className={`bar ${!hasTotal && expected === null && run.endedAt === null ? 'indeterminate' : ''}`}>
        {hasTotal && (
          <>
            <div className="bar-pass" style={{ width: `${passedShare}%` }} />
            <div className="bar-fail" style={{ width: `${failedShare}%`, minWidth: progress.failed > 0 ? 4 : 0 }} />
          </>
        )}
        {expected !== null && <div className="bar-pass" style={{ width: `${expected}%` }} />}
        {!hasTotal && run.endedAt !== null && (
          <div className={run.failed === true ? 'bar-fail' : 'bar-pass'} style={{ width: '100%' }} />
        )}
      </div>
      {!isCompact && progress !== null && progress.suites.length > 0 && (
        <div className="suites">
          {progress.suites.map(suite => {
            const share = suite.total === 0 ? 0 : (suite.done / suite.total) * 100

            return (
              <div key={suite.name}>
                <div className="suite-head mono small">
                  <span className="ellipsis">{suite.name}</span>
                  <span className={suite.failed > 0 ? 'text-fail' : 'muted'}>
                    {suite.failed > 0 ? `упало ${suite.failed}` : `${suite.done} з ${suite.total}`}
                  </span>
                </div>
                <div className="track thin">
                  <div className={suite.failed > 0 ? 'fill failed' : 'fill'} style={{ width: `${share}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
      {!isCompact && run.endedAt === null && !hasTotal && (
        <p className="small muted">
          {expected === null
            ? 'Загальна кількість невідома: ця команда не показує її під час роботи.'
            : 'Час оцінено за попереднім запуском цієї команди.'}
        </p>
      )}
    </div>
  )
}
