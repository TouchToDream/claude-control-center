type Linked = { id: string; continuedFrom?: string | null }

const CHAIN_LIMIT = 20

export function latestOf(sessions: readonly Linked[], id: string | null): string | null {
  let current = id

  for (let step = 0; current !== null && step < CHAIN_LIMIT; step += 1) {
    const next = sessions.find(session => session.continuedFrom === current)

    if (next === undefined) {
      return current
    }

    current = next.id
  }

  return current
}

export function isContinued(sessions: readonly Linked[], id: string): boolean {
  return sessions.some(session => session.continuedFrom === id)
}
