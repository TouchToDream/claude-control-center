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

type StoredAttachment = {
  key: string
  name: string
  status: 'uploading' | 'ready' | 'failed'
  path: string | null
  url: string | null
  isImage: boolean
  error: string | null
}

const ATTACHMENTS = 'ccc.attachments.'

export function loadAttachments(store: KeyValueStore | null, sessionId: string): StoredAttachment[] {
  try {
    const stored = JSON.parse(store?.getItem(ATTACHMENTS + sessionId) ?? '[]') as unknown

    return Array.isArray(stored) ? (stored as StoredAttachment[]).filter(item => item.status === 'ready') : []
  } catch {
    return []
  }
}

export function saveAttachments(store: KeyValueStore | null, sessionId: string, list: readonly StoredAttachment[]): void {
  const ready = list.filter(item => item.status === 'ready')

  try {
    if (ready.length === 0) {
      store?.removeItem(ATTACHMENTS + sessionId)
    } else {
      store?.setItem(ATTACHMENTS + sessionId, JSON.stringify(ready))
    }
  } catch {
    return
  }
}
