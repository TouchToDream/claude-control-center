import type { KeyValueStore } from './drafts.ts'

export function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
