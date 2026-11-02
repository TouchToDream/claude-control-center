import { useEffect, useState } from 'react'
import { saveButtons } from './api.ts'
import type { QuickButton } from './model.ts'
import { buttonKind, KIND_LABEL, moveButton } from './quickButtons.ts'

const BUTTON_LIMIT = 12

export function ButtonsDialog({ buttons, onClose }: { buttons: readonly QuickButton[]; onClose: () => void }) {
  const [list, setList] = useState<QuickButton[]>(() => buttons.map(button => ({ ...button })))
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const change = (id: string, update: Partial<QuickButton>) =>
    setList(current => current.map(button => (button.id === id ? { ...button, ...update } : button)))

  const add = () => setList(current => [...current, { id: crypto.randomUUID(), label: '', text: '', confirm: false }])

  const save = () => {
    setIsSaving(true)
    setError(null)
    saveButtons(list)
      .then(onClose)
      .catch(() => setError('Перевір кнопки: у кожної потрібна назва до 24 символів і текст'))
      .finally(() => setIsSaving(false))
  }

  return (
    <div className="overlay" role="presentation">
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label="Мої кнопки">
        <h2>Мої кнопки</h2>
        <p className="small muted">
          Текст кнопки — те саме, що ти написав би в поле вводу: <span className="mono">/скіл аргументи</span>,{' '}
          <span className="mono">!команда терміналу</span> або звичайний промпт. Кнопка надсилає його в сесію, яку ти
          зараз дивишся. Набір спільний для всіх проєктів.
        </p>

        <div className="buttons-list">
          {list.map((button, index) => (
            <div key={button.id} className="button-edit">
              <div className="button-edit-row">
                <input
                  className="field"
                  aria-label="Назва кнопки"
                  placeholder="Назва, наприклад CR High"
                  maxLength={24}
                  value={button.label}
                  onChange={event => change(button.id, { label: event.target.value })}
                />
                <span className="small muted nowrap">{KIND_LABEL[buttonKind(button.text)]}</span>
                <button type="button" className="ghost mini" aria-label="Вище" disabled={index === 0} onClick={() => setList(current => moveButton(current, index, -1))}>
                  ↑
                </button>
                <button
                  type="button"
                  className="ghost mini"
                  aria-label="Нижче"
                  disabled={index === list.length - 1}
                  onClick={() => setList(current => moveButton(current, index, 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="ghost mini danger"
                  aria-label={`Видалити ${button.label}`}
                  onClick={() => setList(current => current.filter(other => other.id !== button.id))}
                >
                  Видалити
                </button>
              </div>
              <textarea
                className="field mono"
                rows={2}
                aria-label="Що надсилає кнопка"
                placeholder="/code-review high"
                value={button.text}
                onChange={event => change(button.id, { text: event.target.value })}
              />
              <label className="tg-event small">
                <input type="checkbox" checked={button.confirm} onChange={event => change(button.id, { confirm: event.target.checked })} />
                <span>Питати перед запуском</span>
              </label>
            </div>
          ))}
        </div>

        <button type="button" className="action" disabled={list.length >= BUTTON_LIMIT} onClick={add}>
          Додати кнопку
        </button>

        {error !== null && <p className="small text-fail">{error}</p>}

        <div className="dialog-buttons">
          <button type="button" className="ghost outline" onClick={onClose}>
            Скасувати
          </button>
          <button type="button" className="primary" disabled={isSaving} onClick={save}>
            Зберегти
          </button>
        </div>
      </div>
    </div>
  )
}
