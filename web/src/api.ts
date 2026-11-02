import type { MacAlertsView, MacEvent, OutboxItem, UploadView, Row, SessionCommand, Snapshot, TelegramView, TimelineEntry } from './model.ts'

export type ServerMessage =
  | { type: 'state'; state: Snapshot }
  | { type: 'rows'; rows: Row[] }
  | { type: 'outbox'; item: OutboxItem }

export type ViewingMessage = { type: 'viewing'; sessionId: string | null; isVisible: boolean }

let openSocket: WebSocket | null = null
let lastViewing: ViewingMessage | null = null

export function report(message: ViewingMessage): void {
  lastViewing = message

  if (openSocket?.readyState === WebSocket.OPEN) {
    openSocket.send(JSON.stringify(message))
  }
}

async function post(path: string, body: unknown): Promise<Response> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({ error: 'unknown' }))) as { error?: string }

    throw new Error(error ?? 'unknown')
  }

  return response
}

export function sendMessage(sessionId: string, text: string): Promise<Response> {
  return post(`/api/panel/sessions/${sessionId}/messages`, { text })
}

export function cancelOutbox(id: string): Promise<Response> {
  return post(`/api/panel/outbox/${id}/cancel`, {})
}

export function forceOutbox(id: string, mode: 'inject' | 'interrupt'): Promise<Response> {
  return post(`/api/panel/outbox/${id}/force`, { mode })
}

export async function loadCommands(sessionId: string): Promise<SessionCommand[]> {
  const response = await fetch(`/api/panel/sessions/${sessionId}/commands`)
  const { commands } = (await response.json()) as { commands: SessionCommand[] }

  return commands
}

export async function loadDiff(sessionId: string, path: string): Promise<{ diff: string; isTruncated: boolean }> {
  const response = await fetch(`/api/panel/sessions/${sessionId}/diff?path=${encodeURIComponent(path)}`)

  if (!response.ok) {
    throw new Error('diff_failed')
  }

  return response.json()
}

export function openFileInIde(sessionId: string, path: string, line: number | null): Promise<Response> {
  return post(`/api/panel/sessions/${sessionId}/open`, { path, line })
}

export function dismissOutbox(id: string): Promise<Response> {
  return post(`/api/panel/outbox/${id}/dismiss`, {})
}

export function abortTurn(sessionId: string): Promise<Response> {
  return post(`/api/panel/sessions/${sessionId}/abort`, {})
}

export function renameSession(sessionId: string, name: string): Promise<Response> {
  return post(`/api/panel/sessions/${sessionId}/rename`, { name })
}

export function chooseModel(sessionId: string, model: string | null, effort: string | null): Promise<Response> {
  return post(`/api/panel/sessions/${sessionId}/model`, { model, effort })
}

export function closeSession(sessionId: string): Promise<Response> {
  return post(`/api/panel/sessions/${sessionId}/close`, {})
}

export function answerAsk(id: string, answer: unknown): Promise<Response> {
  return post(`/api/panel/asks/${id}/answer`, answer)
}

export async function startBackground(
  cwd: string,
  prompt: string,
): Promise<{ id: string | null; output: string; error: string | null }> {
  const response = await post('/api/panel/background-sessions', { cwd, prompt })

  return response.json()
}

export async function resumeSession(
  sessionId: string,
): Promise<{ id: string | null; output: string; error: string | null }> {
  const response = await post(`/api/panel/sessions/${sessionId}/resume`, {})

  return response.json()
}

export async function uploadFile(sessionId: string, file: File): Promise<UploadView> {
  const response = await fetch(`/api/panel/sessions/${encodeURIComponent(sessionId)}/uploads`, {
    method: 'POST',
    headers: {
      'content-type': file.type === '' ? 'application/octet-stream' : file.type,
      'x-file-name': encodeURIComponent(file.name === '' ? 'file' : file.name),
    },
    body: file,
  })

  if (!response.ok) {
    throw new Error(response.status === 413 ? 'too_large' : 'upload_failed')
  }

  return ((await response.json()) as { upload: UploadView }).upload
}

export async function saveMacAlerts(changes: {
  enabled?: boolean
  events?: Partial<Record<MacEvent, boolean>>
}): Promise<MacAlertsView> {
  return (await (await post('/api/panel/mac-alerts', changes)).json()) as MacAlertsView
}

export async function loadTelegram(): Promise<TelegramView> {
  const response = await fetch('/api/panel/telegram')

  return response.json()
}

export async function telegramAction(action: string, body: object): Promise<TelegramView> {
  const response = await post(`/api/panel/telegram/${action}`, body)

  return response.json()
}

export async function loadRows(sessionId: string): Promise<{ rows: Row[]; outbox: OutboxItem[] }> {
  const response = await fetch(`/api/panel/sessions/${sessionId}/rows`)

  return response.json()
}

export async function loadOlderRows(sessionId: string, beforeSeq: number): Promise<Row[]> {
  const response = await fetch(`/api/panel/sessions/${sessionId}/rows?before=${beforeSeq}`)
  const { rows } = (await response.json()) as { rows: Row[] }

  return rows
}

export async function loadTimeline(): Promise<TimelineEntry[]> {
  const response = await fetch('/api/panel/timeline')
  const { entries } = (await response.json()) as { entries: TimelineEntry[] }

  return entries
}

export function connect(
  onMessage: (message: ServerMessage) => void,
  onStatus: (isConnected: boolean) => void,
): () => void {
  let socket: WebSocket | null = null
  let isStopped = false
  let retry: number | undefined

  const open = () => {
    const current = new WebSocket(`ws://${location.host}/ws`)

    socket = current
    current.onopen = () => {
      openSocket = current
      onStatus(true)

      if (lastViewing !== null) {
        current.send(JSON.stringify(lastViewing))
      }
    }
    current.onmessage = event => onMessage(JSON.parse(String(event.data)) as ServerMessage)
    current.onclose = () => {
      if (openSocket === current) {
        openSocket = null
      }

      onStatus(false)

      if (!isStopped) {
        retry = window.setTimeout(open, 1500)
      }
    }
  }

  open()

  return () => {
    isStopped = true
    window.clearTimeout(retry)
    socket?.close()
  }
}
