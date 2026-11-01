import { useCallback, useEffect, useMemo, useState } from 'react'
import { connect, loadRows, loadTimeline } from './api.ts'
import type { ServerMessage } from './api.ts'
import { Header } from './Header.tsx'
import type { OutboxItem, Row, Snapshot, TimelineEntry } from './model.ts'
import { NewSessionDialog } from './NewSessionDialog.tsx'
import { Overview } from './Overview.tsx'
import { SessionScreen } from './SessionScreen.tsx'
import { Sidebar } from './Sidebar.tsx'
import { TelegramDialog } from './TelegramDialog.tsx'

const TIMELINE_REFRESH_MS = 20_000

function mergeRows(current: readonly Row[], added: readonly Row[]): Row[] {
  const known = new Set(current.map(row => row.seq))

  return [...current, ...added.filter(row => !known.has(row.seq))].sort((left, right) => left.seq - right.seq)
}

function mergeOutbox(current: readonly OutboxItem[], item: OutboxItem): OutboxItem[] {
  return current.some(known => known.id === item.id)
    ? current.map(known => (known.id === item.id ? item : known))
    : [...current, item]
}

function selectedFromHash(): string | null {
  const id = location.hash.replace(/^#/, '')

  return id === '' ? null : id
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [selected, setSelected] = useState<string | null>(selectedFromHash)
  const [rows, setRows] = useState<Row[]>([])
  const [outbox, setOutbox] = useState<OutboxItem[]>([])
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null)
  const [isTelegramOpen, setIsTelegramOpen] = useState(false)
  const [clock, setClock] = useState(Date.now())

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type === 'state') {
        setSnapshot(message.state)
      }

      if (message.type === 'rows') {
        setRows(current => {
          const own = message.rows.filter(row => row.sessionId === selectedFromHash())

          return own.length === 0 ? current : mergeRows(current, own)
        })
      }

      if (message.type === 'outbox' && message.item.sessionId === selectedFromHash()) {
        setOutbox(current => mergeOutbox(current, message.item))
      }
    },
    [],
  )

  useEffect(() => connect(handleMessage, setIsConnected), [handleMessage])

  useEffect(() => {
    const onHash = () => setSelected(selectedFromHash())

    window.addEventListener('hashchange', onHash)

    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const refresh = () => void loadTimeline().then(setTimeline)

    refresh()

    const timer = window.setInterval(refresh, TIMELINE_REFRESH_MS)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setRows([])
    setOutbox([])

    if (selected !== null) {
      void loadRows(selected).then(loaded => {
        setRows(loaded.rows)
        setOutbox(loaded.outbox)
      })
    }
  }, [selected])

  const open = useCallback((id: string | null) => {
    location.hash = id ?? ''
  }, [])

  const session = useMemo(
    () => snapshot?.sessions.find(candidate => candidate.id === selected) ?? null,
    [snapshot, selected],
  )

  const waiting = snapshot?.sessions.filter(item => ['ask', 'fail'].includes(item.status)).length ?? 0

  useEffect(() => {
    document.title = waiting > 0 ? `(${waiting}) Центр керування` : 'Центр керування'
  }, [waiting])

  if (snapshot === null) {
    return <div className="loading">{isConnected ? 'Завантаження…' : 'Підключення до сервісу…'}</div>
  }

  return (
    <div className="app">
      <Header
        snapshot={snapshot}
        isConnected={isConnected}
        onHome={() => open(null)}
        onTelegram={() => setIsTelegramOpen(true)}
      />
      <div className="columns">
        <Sidebar
          snapshot={snapshot}
          selected={selected}
          clock={clock}
          onOpen={open}
          onNewSession={setNewSessionCwd}
        />
        <main className="main">
          {session === null ? (
            <Overview snapshot={snapshot} timeline={timeline} clock={clock} onOpen={open} />
          ) : (
            <SessionScreen
              key={session.id}
              session={session}
              snapshot={snapshot}
              rows={rows}
              outbox={outbox}
              clock={clock}
              onRows={setRows}
            />
          )}
        </main>
      </div>
      {isTelegramOpen && <TelegramDialog onClose={() => setIsTelegramOpen(false)} />}
      {newSessionCwd !== null && (
        <NewSessionDialog cwd={newSessionCwd} onClose={() => setNewSessionCwd(null)} />
      )}
    </div>
  )
}
