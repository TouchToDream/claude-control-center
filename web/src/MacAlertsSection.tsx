import { useState } from 'react'
import { saveMacAlerts } from './api.ts'
import type { MacAlertsView, MacEvent } from './model.ts'

const EVENTS: { key: MacEvent; label: string }[] = [
  { key: 'question', label: 'Питання від Claude' },
  { key: 'permission', label: 'Запит дозволу' },
  { key: 'done', label: 'Завершене завдання' },
  { key: 'turnError', label: 'Хід завершився помилкою' },
  { key: 'testsFailed', label: 'Тести впали' },
  { key: 'gone', label: 'Сесія зникла під час роботи' },
  { key: 'limit', label: 'Ліміт дійшов до 80% і 95%' },
]

export function MacAlertsSection({ view }: { view: MacAlertsView }) {
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = (changes: { enabled?: boolean; events?: Partial<Record<MacEvent, boolean>> }) => {
    setIsBusy(true)
    setError(null)
    saveMacAlerts(changes)
      .catch(() => setError('Не вдалося зберегти'))
      .finally(() => setIsBusy(false))
  }

  return (
    <section className="dialog-option">
      <h3>Сповіщення Mac</h3>
      <label className="tg-event small">
        <input
          type="checkbox"
          checked={view.enabled}
          disabled={isBusy}
          onChange={change => save({ enabled: change.target.checked })}
        />
        <span>Надсилати сповіщення Mac</span>
      </label>
      <div className="tg-events">
        {EVENTS.map(event => (
          <label key={event.key} className="tg-event small">
            <input
              type="checkbox"
              checked={view.events[event.key]}
              disabled={isBusy || !view.enabled}
              onChange={change => save({ events: { [event.key]: change.target.checked } })}
            />
            <span>{event.label}</span>
          </label>
        ))}
      </div>
      <p className="small muted">
        Сповіщення показує програма Claude Control Center, для всіх проєктів одразу. Про сесію, яку ти зараз бачиш у
        панелі, сповіщення не приходить.
      </p>
      {!view.isAppRunning && (
        <p className="small text-ask">Програма не запущена: сповіщення побачиш, коли вона працюватиме.</p>
      )}
      {error !== null && <p className="small text-fail">{error}</p>}
    </section>
  )
}
