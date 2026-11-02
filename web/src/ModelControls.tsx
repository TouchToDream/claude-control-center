import { chooseModel } from './api.ts'
import { Dropdown } from './Dropdown.tsx'
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
  const sessionModel = modelLabel(session.model) ?? 'Модель'
  const sessionEffort = session.effort ?? 'Effort'

  const choose = (nextModel: string | null, nextEffort: string | null) => {
    void chooseModel(session.id, nextModel, nextEffort)
  }

  return (
    <>
      <Dropdown
        label={MODELS.find(item => item.value === model)?.label ?? sessionModel}
        ariaLabel="Модель сесії"
        title={title}
        options={[{ value: null, label: `Як у сесії · ${sessionModel}` }, ...MODELS]}
        value={model}
        isChanged={model !== null}
        isDisabled={!isAvailable}
        onChange={value => choose(value, effort)}
      />
      <Dropdown
        label={effort ?? sessionEffort}
        ariaLabel="Effort сесії"
        title={title}
        options={[{ value: null, label: `Як у сесії · ${sessionEffort}` }, ...EFFORTS.map(item => ({ value: item, label: item }))]}
        value={effort}
        isChanged={effort !== null}
        isDisabled={!isAvailable}
        onChange={value => choose(model, value)}
      />
    </>
  )
}
