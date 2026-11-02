import { useState } from 'react'
import { telegramAction } from './api.ts'
import { Icon } from './Icon.tsx'
import { ago, isLive, isRunning, repoKey, STATUS_LABEL } from './model.ts'
import type { SessionView, Snapshot, Status, Unbridged } from './model.ts'
import { unreadSessions } from './unread.ts'

const CLOSED_LIMIT = 5

const STATUS_ORDER: Record<Status, number> = {
  ask: 0,
  fail: 1,
  tests: 2,
  work: 3,
  waiting: 4,
  chat: 5,
  idle: 6,
  offline: 7,
}

const SHORT_STATUS: Partial<Record<Status, string>> = {
  ask: 'питає',
  fail: 'помилка',
  tests: 'тести',
  work: 'працює',
}

type RepoGroup = {
  key: string
  name: string
  live: SessionView[]
  closed: SessionView[]
}

function groupByRepo(sessions: readonly SessionView[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>()

  for (const session of sessions) {
    const key = repoKey(session)
    const group = groups.get(key) ?? { key, name: session.repoName, live: [], closed: [] }

    ;(isLive(session) ? group.live : group.closed).push(session)
    groups.set(key, group)
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      live: group.live.sort(
        (left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.startedAt - right.startedAt,
      ),
      closed: group.closed.sort((left, right) => closedAt(right) - closedAt(left)),
    }))
    .sort((left, right) => Number(right.live.length > 0) - Number(left.live.length > 0) || left.name.localeCompare(right.name))
}

function closedAt(session: SessionView): number {
  return session.endedAt ?? session.lastSeenAt
}

function lastActivity(session: SessionView): number {
  return Math.max(session.lastTurnEndAt ?? 0, session.lastTurnStartAt ?? 0, session.lastUserAt ?? 0, session.startedAt)
}

function UnreadDot() {
  return <span className="unread-dot" role="img" aria-label="Є непрочитані сповіщення" title="Є непрочитані сповіщення" />
}

function LiveRow({
  session,
  isSelected,
  hasUnread,
  clock,
  onOpen,
}: {
  session: SessionView
  isSelected: boolean
  hasUnread: boolean
  clock: number
  onOpen: (id: string) => void
}) {
  const short = SHORT_STATUS[session.status]

  return (
    <button
      type="button"
      className={`nav ${isSelected ? 'selected' : ''} ${session.status === 'idle' ? 'quiet' : ''}`}
      title={`${session.name} · ${STATUS_LABEL[session.status]}`}
      onClick={() => onOpen(session.id)}
    >
      <span className={`dot status-${session.status} ${isRunning(session) ? 'pulse' : ''}`} />
      <span className="nav-name ellipsis">{session.name}</span>
      {hasUnread && <UnreadDot />}
      {short === undefined ? (
        <span className="nav-meta mono muted">{ago(clock - lastActivity(session))}</span>
      ) : (
        <span className={`nav-meta text-${session.status}`}>{short}</span>
      )}
    </button>
  )
}

function ClosedRow({
  session,
  isSelected,
  hasUnread,
  clock,
  onOpen,
}: {
  session: SessionView
  isSelected: boolean
  hasUnread: boolean
  clock: number
  onOpen: (id: string) => void
}) {
  return (
    <button
      type="button"
      className={`nav closed ${isSelected ? 'selected' : ''}`}
      title={`${session.name} · закрита`}
      onClick={() => onOpen(session.id)}
    >
      <span className="dot hollow" />
      <span className="nav-name ellipsis">{session.name}</span>
      {hasUnread && <UnreadDot />}
      <span className="nav-meta mono">{ago(clock - closedAt(session))}</span>
    </button>
  )
}

function ClosedSessions({
  sessions,
  selected,
  unread,
  clock,
  onOpen,
}: {
  sessions: SessionView[]
  selected: string | null
  unread: ReadonlySet<string>
  clock: number
  onOpen: (id: string) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const shown = isExpanded ? sessions : sessions.slice(0, CLOSED_LIMIT)
  const hidden = sessions.length - shown.length

  return (
    <div className="repo-closed">
      <div className="repo-closed-label">Закриті · {sessions.length}</div>
      {shown.map(session => (
        <ClosedRow
          key={session.id}
          session={session}
          isSelected={session.id === selected}
          hasUnread={unread.has(session.id)}
          clock={clock}
          onOpen={onOpen}
        />
      ))}
      {hidden > 0 && (
        <button type="button" className="ghost more" onClick={() => setIsExpanded(true)}>
          Ще {hidden}
        </button>
      )}
    </div>
  )
}

function UnbridgedList({ entries }: { entries: Unbridged[] }) {
  if (entries.length === 0) {
    return null
  }

  return (
    <details className="unbridged">
      <summary>Без мосту · {entries.length}</summary>
      <p className="small muted">
        Ці сесії працюють, але мод у них не завантажено. Вони з’являться тут після /reload-plugins або перезапуску.
      </p>
      {entries.map(entry => (
        <div key={entry.sessionId} className="unbridged-row small">
          <span className="ellipsis">{entry.name ?? entry.sessionId.slice(0, 8)}</span>
          <span className="muted mono nowrap">pid {entry.pid}</span>
        </div>
      ))}
    </details>
  )
}

type Props = {
  snapshot: Snapshot
  selected: string | null
  clock: number
  onOpen: (id: string) => void
  onNewSession: (cwd: string) => void
}

export function Sidebar({ snapshot, selected, clock, onOpen, onNewSession }: Props) {
  const [showClosed, setShowClosed] = useState(false)
  const allGroups = groupByRepo(snapshot.sessions)
  const groups = showClosed ? allGroups : allGroups.filter(group => group.live.length > 0)
  const closedCount = allGroups.reduce((sum, group) => sum + group.closed.length, 0)
  const unread = unreadSessions(snapshot.alerts)

  return (
    <nav className="sidebar" aria-label="Репозиторії та сесії">
      <div className="sidebar-list">
        {groups.map(group => (
          <section key={group.key} className="repo">
            <div className="repo-head">
              <span className="repo-name">{group.name}</span>
              {group.live.length > 0 && <span className="repo-count mono">{group.live.length}</span>}
              {snapshot.telegram.isReady && (
                <button
                  type="button"
                  className={`ghost bell ${snapshot.telegram.projects.includes(group.key) ? 'on' : ''}`}
                  aria-pressed={snapshot.telegram.projects.includes(group.key)}
                  aria-label={`Сповіщення Telegram для ${group.name}`}
                  title={snapshot.telegram.projects.includes(group.key) ? 'Сповіщення увімкнено' : 'Сповіщення вимкнено'}
                  onClick={() =>
                    void telegramAction('project', {
                      repoKey: group.key,
                      enabled: !snapshot.telegram.projects.includes(group.key),
                    })
                  }
                >
                  <Icon name="bell" />
                </button>
              )}
              <button
                type="button"
                className="ghost add"
                aria-label={`Нова сесія в ${group.name}`}
                title="Нова сесія"
                onClick={() => onNewSession(group.key)}
              >
                <Icon name="plus" />
              </button>
            </div>
            {group.live.map(session => (
              <LiveRow
                key={session.id}
                session={session}
                isSelected={session.id === selected}
                hasUnread={unread.has(session.id)}
                clock={clock}
                onOpen={onOpen}
              />
            ))}
            {showClosed && group.closed.length > 0 && (
              <ClosedSessions sessions={group.closed} selected={selected} unread={unread} clock={clock} onOpen={onOpen} />
            )}
          </section>
        ))}
        {allGroups.length === 0 && (
          <p className="small muted empty-hint">
            Сесій із мостом поки немає. Запусти claude із встановленим модом, і вона з’явиться тут.
          </p>
        )}
      </div>
      {(closedCount > 0 || snapshot.unbridged.length > 0) && (
        <div className="sidebar-foot">
          {closedCount > 0 && (
            <button
              type="button"
              className="ghost foot-toggle"
              aria-pressed={showClosed}
              onClick={() => setShowClosed(value => !value)}
            >
              <span>Закриті сесії · {closedCount}</span>
              <span className={`switch ${showClosed ? 'on' : ''}`} aria-hidden="true" />
            </button>
          )}
          <UnbridgedList entries={snapshot.unbridged} />
        </div>
      )}
    </nav>
  )
}
