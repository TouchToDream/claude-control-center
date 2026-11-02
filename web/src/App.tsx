import { useCallback, useEffect, useMemo, useState } from 'react'
import { connect, loadRows, loadTimeline, report } from './api.ts'
import { installAppBridge, isInApp } from './appBridge.ts'
import { loadDraft } from './drafts.ts'
import type { ServerMessage } from './api.ts'
import { Header } from './Header.tsx'
import type { OutboxItem, Row, Snapshot, TimelineEntry } from './model.ts'
import { NewSessionDialog } from './NewSessionDialog.tsx'
import { Overview } from './Overview.tsx'
import { nextSelection } from './selection.ts'
import { SessionScreen } from './SessionScreen.tsx'
import { Sidebar } from './Sidebar.tsx'
import { browserStore } from './storage.ts'
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

const IS_IN_APP = isInApp()

function isPageInView(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

function openRequested(sessionId: string | null, onlyIfNoDraft: boolean): void {
  const current = selectedFromHash()
  const draft = current === null ? '' : loadDraft(browserStore(), current)
  const next = nextSelection(current, sessionId, onlyIfNoDraft, draft)

  if (next !== current) {
    location.hash = next ?? ''
  }
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
  const [isSessionsOpen, setIsSessionsOpen] = useState(false)
  const [clock, setClock] = useState(Date.now())
  const [isAppShown, setIsAppShown] = useState(false)
  const [isPageVisible, setIsPageVisible] = useState(isPageInView)
  const isVisible = IS_IN_APP ? isAppShown : isPageVisible

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

  useEffect(() => installAppBridge({ onShow: openRequested, onShown: setIsAppShown }), [])

  useEffect(() => {
    const stopFileDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
      }
    }

    window.addEventListener('dragover', stopFileDrop)
    window.addEventListener('drop', stopFileDrop)

    return () => {
      window.removeEventListener('dragover', stopFileDrop)
      window.removeEventListener('drop', stopFileDrop)
    }
  }, [])

  useEffect(() => {
    const update = () => setIsPageVisible(isPageInView())

    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)

    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  useEffect(() => report({ type: 'viewing', sessionId: selectedFromHash(), isVisible }), [selected, isVisible])

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
    setIsSessionsOpen(false)
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
    <div className={`app ${isSessionsOpen ? 'sessions-open' : ''}`}>
      <Header
        snapshot={snapshot}
        isConnected={isConnected}
        onHome={() => open(null)}
        onTelegram={() => setIsTelegramOpen(true)}
        isSessionsOpen={isSessionsOpen}
        onSessions={() => setIsSessionsOpen(value => !value)}
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
      {isTelegramOpen && <TelegramDialog macAlerts={snapshot.macAlerts} onClose={() => setIsTelegramOpen(false)} />}
      {newSessionCwd !== null && (
        <NewSessionDialog cwd={newSessionCwd} onClose={() => setNewSessionCwd(null)} />
      )}
    </div>
  )
}
