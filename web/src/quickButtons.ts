export type ButtonKind = 'command' | 'shell' | 'prompt'

export const KIND_LABEL: Record<ButtonKind, string> = { command: 'команда', shell: 'термінал', prompt: 'промпт' }

export function buttonKind(text: string): ButtonKind {
  const trimmed = text.trim()

  if (trimmed.startsWith('/')) {
    return 'command'
  }

  return trimmed.startsWith('!') ? 'shell' : 'prompt'
}

export function moveButton<T>(list: readonly T[], index: number, step: -1 | 1): T[] {
  const target = index + step

  if (target < 0 || target >= list.length) {
    return [...list]
  }

  const next = [...list]
  const [moved] = next.splice(index, 1)

  next.splice(target, 0, moved as T)

  return next
}
