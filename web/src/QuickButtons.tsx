import { useState } from 'react'
import { sendErrorText, sendMessage } from './api.ts'
import { Icon } from './Icon.tsx'
import type { QuickButton, SessionView } from './model.ts'
import { buttonKind } from './quickButtons.ts'

export function QuickButtons({
  session,
  buttons,
  onEdit,
}: {
  session: SessionView
  buttons: readonly QuickButton[]
  onEdit: () => void
}) {
  const [asking, setAsking] = useState<QuickButton | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = (button: QuickButton) => {
    setAsking(null)
    setError(null)
    sendMessage(session.id, button.text).catch((failure: Error) => setError(sendErrorText(failure.message)))
  }

  return (
    <div className="quick">
      <div className="quick-row" role="toolbar" aria-label="Мої кнопки">
        {buttons.map(button => (
          <button
            type="button"
            key={button.id}
            className={`quick-button quick-${buttonKind(button.text)}`}
            title={button.text}
            onClick={() => (button.confirm ? setAsking(button) : run(button))}
          >
            {button.label}
          </button>
        ))}
        <button
          type="button"
          className="ghost quick-edit"
          aria-label="Налаштувати кнопки"
          title="Налаштувати кнопки"
          onClick={onEdit}
        >
          {buttons.length === 0 ? (
            <>
              <Icon name="plus" />
              <span className="small">Кнопка</span>
            </>
          ) : (
            <Icon name="pencil" />
          )}
        </button>
      </div>
      {asking !== null && (
        <div className="quick-confirm small">
          <span>
            Запустити «{asking.label}»? <span className="mono muted">{asking.text.slice(0, 120)}</span>
          </span>
          <span className="quick-confirm-actions">
            <button type="button" className="ghost mini" onClick={() => run(asking)}>
              Запустити
            </button>
            <button type="button" className="ghost mini" onClick={() => setAsking(null)}>
              Скасувати
            </button>
          </span>
        </div>
      )}
      {error !== null && <p className="small text-fail">{error}</p>}
    </div>
  )
}
