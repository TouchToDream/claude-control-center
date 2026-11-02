export function unreadSessions(alerts: readonly { sessionId: string | null }[] | undefined): Set<string> {
  return new Set((alerts ?? []).flatMap(alert => (alert.sessionId === null ? [] : [alert.sessionId])))
}
