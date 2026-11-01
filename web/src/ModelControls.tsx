import { chooseModel } from './api.ts'
import type { SessionView } from './model.ts'
import { canChooseModel, modelLabel } from './model.ts'

const MODELS = [
  { value: 'fable', label: 'Fable' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
]

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export function ModelControls({ session }: { session: SessionView }) {
  const { model, effort } = session.override
  const isAvailable = canChooseModel(session)
  const title = isAvailable
    ? 'Діє лише на цю сесію, з наступного запиту. Глобальні налаштування не змінюються.'
    : 'Виконай у цій сесії /reload-plugins'

  const choose = (nextModel: string | null, nextEffort: string | null) => {
    void chooseModel(session.id, nextModel, nextEffort)
  }

  return (
    <>
      <select
        className={`picker ${model === null ? '' : 'changed'}`}
        aria-label="Модель сесії"
        title={title}
        disabled={!isAvailable}
        value={model ?? ''}
        onChange={event => choose(event.target.value === '' ? null : event.target.value, effort)}
      >
        <option value="">{model === null ? (modelLabel(session.model) ?? 'Модель') : 'Як у сесії'}</option>
        {MODELS.map(item => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <select
        className={`picker ${effort === null ? '' : 'changed'}`}
        aria-label="Effort сесії"
        title={title}
        disabled={!isAvailable}
        value={effort ?? ''}
        onChange={event => choose(model, event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{effort === null ? (session.effort ?? 'Effort') : 'Як у сесії'}</option>
        {EFFORTS.map(item => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </>
  )
}
