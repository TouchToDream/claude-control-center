export function shellCommand(text: string): string | null {
  const trimmed = text.trim()

  return trimmed.startsWith('!') ? trimmed.slice(1).trim() : null
}
