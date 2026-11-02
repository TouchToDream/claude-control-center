export type QuickButton = {
  id: string
  label: string
  text: string
  confirm: boolean
}

const BUTTON_LIMIT = 12
const LABEL_LIMIT = 24
const TEXT_LIMIT = 4000
const ID_LIMIT = 64

function parseButton(input: unknown): QuickButton | null {
  if (typeof input !== 'object' || input === null) {
    return null
  }

  const { id, label, text, confirm } = input as Record<string, unknown>
  const cleanLabel = typeof label === 'string' ? label.trim() : ''
  const cleanText = typeof text === 'string' ? text.trim() : ''
  const isValid =
    typeof id === 'string' &&
    id !== '' &&
    id.length <= ID_LIMIT &&
    cleanLabel !== '' &&
    cleanLabel.length <= LABEL_LIMIT &&
    cleanText !== '' &&
    cleanText.length <= TEXT_LIMIT

  return isValid ? { id, label: cleanLabel, text: cleanText, confirm: confirm === true } : null
}

export function parseButtons(input: unknown): QuickButton[] | null {
  if (!Array.isArray(input) || input.length > BUTTON_LIMIT) {
    return null
  }

  const buttons = input.map(parseButton)
  const ids = new Set(buttons.map(button => button?.id))

  if (buttons.some(button => button === null) || ids.size !== buttons.length) {
    return null
  }

  return buttons as QuickButton[]
}
