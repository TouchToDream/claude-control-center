const DAY_MS = 24 * 60 * 60 * 1000

export function resetLabel(resetsAt: string | undefined, now: number, timeZone?: string): string | null {
  const at = resetsAt === undefined ? Number.NaN : Date.parse(resetsAt)
  const left = at - now

  if (Number.isNaN(at) || left <= 0) {
    return null
  }

  if (left < DAY_MS) {
    const minutes = Math.max(1, Math.round(left / 60_000))
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60

    if (hours === 0) {
      return `оновиться через ${minutes} хв`
    }

    return rest === 0 ? `оновиться через ${hours} год` : `оновиться через ${hours} год ${rest} хв`
  }

  const day = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', timeZone }).format(at)
  const time = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(at)

  return `оновиться ${day} о ${time}`
}
