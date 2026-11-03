type FocusedElement = {
  tagName: string
  type?: string
  isContentEditable?: boolean
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'])

export function isTypingIn(element: FocusedElement | null): boolean {
  if (element === null) {
    return false
  }

  if (element.isContentEditable === true || element.tagName === 'TEXTAREA') {
    return true
  }

  return element.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(element.type ?? '')
}
