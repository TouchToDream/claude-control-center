export type KeyValueStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const PREFIX = 'ccc.draft.'

export function loadDraft(store: KeyValueStore | null, sessionId: string): string {
  try {
    return store?.getItem(PREFIX + sessionId) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(store: KeyValueStore | null, sessionId: string, text: string): void {
  try {
    if (text === '') {
      store?.removeItem(PREFIX + sessionId)
    } else {
      store?.setItem(PREFIX + sessionId, text)
    }
  } catch {
    return
  }
}
