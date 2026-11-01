import { telegramAction } from './api.ts'
import { Icon } from './Icon.tsx'
import type { RateLimit, Snapshot } from './model.ts'
import { isLive, isRunning } from './model.ts'

const LIMITS = [
  { kind: 'five_hour', label: 'Ліміт 5 год' },
  { kind: 'seven_day', label: 'Ліміт 7 днів' },
]

function LimitBar({ label, limit }: { label: string; limit: RateLimit | undefined }) {
  const percent = limit?.percentUsed ?? null
  const resets = limit?.resetsAt === undefined ? '' : `Скидання: ${new Date(limit.resetsAt).toLocaleString('uk-UA')}`

  return (
    <div className="limit" title={resets}>
      <div className="limit-head">
        <span>{label}</span>
        <span className="mono">{percent === null ? '—' : `${Math.round(percent)}%`}</span>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${Math.min(percent ?? 0, 100)}%` }} />
      </div>
    </div>
  )
}

type Props = {
  snapshot: Snapshot
  isConnected: boolean
  onHome: () => void
  onTelegram: () => void
}

export function Header({ snapshot, isConnected, onHome, onTelegram }: Props) {
  const live = snapshot.sessions.filter(isLive)
  const count = (statuses: string[]) => live.filter(session => statuses.includes(session.status)).length
  const { enabled, isReady } = snapshot.telegram

  const toggleTelegram = () => {
    if (isReady) {
      void telegramAction('settings', { enabled: !enabled })
    } else {
      onTelegram()
    }
  }

  return (
    <header className="header">
      <button type="button" className="brand ghost" onClick={onHome}>
        Центр керування
      </button>
      <div className="counters">
        <div className="counter">
          <span className="mono big">{live.length}</span>
          <span>сесій</span>
        </div>
        <div className="counter">
          <span className="mono big count-work">{live.filter(isRunning).length}</span>
          <span>працюють</span>
        </div>
        <div className="counter">
          <span className="mono big count-ask">{count(['ask', 'fail', 'waiting', 'chat'])}</span>
          <span>чекають на тебе</span>
        </div>
        <div className="counter">
          <span className="mono big count-muted">{count(['idle'])}</span>
          <span>idle</span>
        </div>
      </div>
      <div className="tg">
        <button
          type="button"
          className="tg-toggle"
          aria-pressed={enabled}
          title={isReady ? 'Сповіщення в Telegram' : 'Спершу налаштуй бота'}
          onClick={toggleTelegram}
        >
          <Icon name="send" />
          Telegram
          <span className={`switch ${enabled ? 'on' : ''}`} aria-hidden="true" />
        </button>
        <button type="button" className="tg-settings" aria-label="Налаштування Telegram" title="Налаштування Telegram" onClick={onTelegram}>
          <Icon name="sliders" />
        </button>
      </div>
      <div className="limits">
        {LIMITS.map(({ kind, label }) => (
          <LimitBar key={kind} label={label} limit={snapshot.rateLimits.find(limit => limit.kind === kind)} />
        ))}
        {!isConnected && <span className="disconnected">Немає зв’язку з сервісом</span>}
      </div>
    </header>
  )
}
