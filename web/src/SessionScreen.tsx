import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  abortTurn,
  cancelOutbox,
  dismissOutbox,
  forceOutbox,
  loadCommands,
  loadOlderRows,
  sendErrorText,
  sendMessage,
  uploadFile,
} from './api.ts'
import { ButtonsDialog } from './ButtonsDialog.tsx'
import { QuickButtons } from './QuickButtons.tsx'
import { composeMessage, previewUrl, restoreAttachments, shortLabel, splitAttachments } from './attachments.ts'
import { AskCard } from './AskCard.tsx'
import { DiffDialog } from './DiffDialog.tsx'
import { loadAttachments, loadDraft, saveAttachments, saveDraft } from './drafts.ts'
import { isTypingIn } from './focus.ts'
import { Icon } from './Icon.tsx'
import type { Attachment, OutboxItem, Row, SessionCommand, SessionView, Snapshot } from './model.ts'
import { ago, canForceMessage, canUseShell, dropReason, isRunning, STATUS_LABEL } from './model.ts'
import { ModelControls } from './ModelControls.tsx'
import { CloseDialog, RenameForm, ResumeDialog } from './SessionActions.tsx'
import { Progress } from './Progress.tsx'
import { shellCommand } from './shell.ts'
import { browserStore } from './storage.ts'
import { ChecksPanel } from './ChecksPanel.tsx'

const HISTORY_PAGE = 400
const MARKDOWN_PLUGINS = [remarkGfm]
const PINNED_DISTANCE = 120

const AssistantText = memo(function AssistantText({ text }: { text: string }) {
  return (
    <div className="row-assistant">
      <Markdown remarkPlugins={MARKDOWN_PLUGINS}>{text}</Markdown>
    </div>
  )
})

function RowAttachments({ paths }: { paths: readonly string[] }) {
  return (
    <div className="row-attachments">
      {paths.map(path => {
        const url = previewUrl(path)
        const name = path.split('/').at(-1) ?? path

        return url === null ? (
          <span key={path} className="attachment-name mono small" title={path}>
            {name}
          </span>
        ) : (
          <a key={path} href={url} target="_blank" rel="noreferrer" title={name}>
            <img className="attachment-preview" src={url} alt={name} />
          </a>
        )
      })}
    </div>
  )
}

function RowItem({ row }: { row: Row }) {
  if (row.kind === 'user') {
    const { text, paths } = splitAttachments(row.text)
    const isShell = shellCommand(text) !== null

    return (
      <div className="row-user">
        <div className={`bubble ${isShell ? 'shell' : ''}`}>
          {row.viaPanel && <div className="small muted">з панелі</div>}
          {text}
          {paths.length > 0 && <RowAttachments paths={paths} />}
        </div>
      </div>
    )
  }

  if (row.kind === 'assistant') {
    return <AssistantText text={row.text} />
  }

  if (row.kind === 'tool') {
    return (
      <div className="row-tool mono">
        <span className="muted">{row.tool}</span>
        {row.text !== row.tool && <span>{row.text}</span>}
      </div>
    )
  }

  if (row.kind === 'result') {
    return (
      <details className={`row-result ${row.isError ? 'failed' : ''}`} open={row.toolUseId?.startsWith('shell-') === true}>
        <summary className="small muted">{row.isError ? 'Помилка інструмента' : 'Результат'}</summary>
        <pre className="mono">{row.text}</pre>
      </details>
    )
  }

  if (row.kind === 'peer') {
    return <div className="row-peer small">Між сесіями · {row.text}</div>
  }

  return <div className="row-notice small muted">{row.text}</div>
}

function Conversation({
  session,
  rows,
  onRows,
}: {
  session: SessionView
  rows: readonly Row[]
  onRows: (update: (current: Row[]) => Row[]) => void
}) {
  const [showAgents, setShowAgents] = useState(false)
  const [hasOlder, setHasOlder] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const isPinned = useRef(true)
  const visible = useMemo(
    () => rows.filter(row => showAgents || row.agentId === null),
    [rows, showAgents],
  )
  const agentRows = rows.length - rows.filter(row => row.agentId === null).length

  const scrollToEnd = () => {
    const box = scroller.current

    if (box !== null && isPinned.current) {
      box.scrollTop = box.scrollHeight
    }
  }

  const rememberPosition = () => {
    const box = scroller.current

    if (box !== null) {
      isPinned.current = box.scrollHeight - box.scrollTop - box.clientHeight < PINNED_DISTANCE
    }
  }

  useLayoutEffect(scrollToEnd, [visible])

  useLayoutEffect(() => {
    const box = scroller.current

    if (box === null) {
      return undefined
    }

    const observer = new ResizeObserver(scrollToEnd)

    observer.observe(box)

    return () => observer.disconnect()
  }, [])

  const loadOlder = () => {
    const first = rows[0]

    if (first === undefined) {
      return
    }

    void loadOlderRows(session.id, first.seq).then(older => {
      setHasOlder(older.length === HISTORY_PAGE)
      onRows(current => [...older, ...current])
    })
  }

  return (
    <div className="conversation" ref={scroller} onScroll={rememberPosition}>
      {rows.length >= HISTORY_PAGE && hasOlder && (
        <button type="button" className="ghost toggle small" onClick={loadOlder}>
          Показати раніші
        </button>
      )}
      {agentRows > 0 && (
        <button type="button" className="ghost toggle small" onClick={() => setShowAgents(value => !value)}>
          {showAgents ? 'Сховати субагентів' : `Показати рядки субагентів: ${agentRows}`}
        </button>
      )}
      {visible.length === 0 && (
        <p className="small muted">
          Тут з’явиться переписка. Рядки, написані до підключення мосту, панель не бачить.
        </p>
      )}
      {visible.map(row => (
        <RowItem key={row.seq} row={row} />
      ))}
    </div>
  )
}

function isSuperseded(item: OutboxItem, outbox: readonly OutboxItem[]): boolean {
  return outbox.some(
    later => later.text === item.text && later.status === 'delivered' && later.createdAt > item.createdAt,
  )
}

function typedText(item: OutboxItem): string {
  return item.kind === 'bash' ? `!${item.text}` : item.text
}

function QueuedNote({
  session,
  item,
  onEdit,
}: {
  session: SessionView
  item: OutboxItem
  onEdit: (text: string) => void
}) {
  const isExit = item.text === '/exit'
  const isOnItsWay = item.status === 'claimed' || item.kind !== 'message'
  const canForce = canForceMessage(session) && item.kind !== 'bash' && !item.text.startsWith('/') && session.turnId !== null

  if (isOnItsWay) {
    return (
      <div className="outbox small">
        <span>
          Надсилається: «{shortLabel(typedText(item), 100)}»
          {!canForceMessage(session) && (
            <span className="muted"> Щоб скасовувати й редагувати чергу, виконай у цій сесії /reload-plugins.</span>
          )}
        </span>
      </div>
    )
  }

  return (
    <div className="outbox small">
      <span>
        {isExit ? 'Сесія закриється, щойно завершить поточний хід.' : `У черзі: «${shortLabel(typedText(item), 100)}»`}
      </span>
      <span className="outbox-actions">
        {canForce && (
          <>
            <button
              type="button"
              className="ghost mini"
              title="Модель прочитає це на наступному кроці, робота не перерветься"
              onClick={() => void forceOutbox(item.id, 'inject')}
            >
              Вставити в хід
            </button>
            <button
              type="button"
              className="ghost mini"
              title="Хід зупиниться, повідомлення піде одразу. Команда, що вже виконується, може лишитися працювати у фоні"
              onClick={() => void forceOutbox(item.id, 'interrupt')}
            >
              Зупинити й надіслати
            </button>
          </>
        )}
        {!item.text.startsWith('/') && (
          <button
            type="button"
            className="ghost mini"
            onClick={() => void cancelOutbox(item.id).then(() => onEdit(typedText(item)))}
          >
            Редагувати
          </button>
        )}
        <button type="button" className="ghost mini" onClick={() => void cancelOutbox(item.id)}>
          Скасувати
        </button>
      </span>
    </div>
  )
}

function OutboxNotes({
  session,
  outbox,
  onEdit,
}: {
  session: SessionView
  outbox: readonly OutboxItem[]
  onEdit: (text: string) => void
}) {
  const open = outbox.filter(item => {
    const isPending = item.status === 'queued' || item.status === 'claimed'
    const isFailed = item.status === 'dropped' && !isSuperseded(item, outbox)

    return item.kind !== 'abort' && !item.text.startsWith('/rename ') && (isPending || isFailed)
  })

  const retry = (item: OutboxItem) => {
    void dismissOutbox(item.id)
    void sendMessage(session.id, typedText(item))
  }

  return (
    <>
      {open.slice(-4).map(item =>
        item.status === 'dropped' ? (
          <div key={item.id} className="outbox failed small">
            <span>
              Не доставлено: {dropReason(item.reason)}
              <span className="muted"> «{shortLabel(typedText(item), 80)}»</span>
            </span>
            <span className="outbox-actions">
              <button type="button" className="ghost mini" onClick={() => retry(item)}>
                Надіслати ще раз
              </button>
              <button type="button" className="ghost mini" onClick={() => void dismissOutbox(item.id)}>
                Прибрати
              </button>
            </span>
          </div>
        ) : (
          <QueuedNote key={item.id} session={session} item={item} onEdit={onEdit} />
        ),
      )}
    </>
  )
}

function ClosedNote({ session, clock }: { session: SessionView; clock: number }) {
  const text =
    session.endedAt === null
      ? 'Немає зв’язку із сесією. Вона з’явиться знову, щойно мод відповість.'
      : `Сесію закрито ${ago(clock - session.endedAt)} тому. Переписка збережена.`

  return <div className="closed-note small muted">{text}</div>
}

const MENU_LIMIT = 8

function matchingCommands(draft: string, commands: readonly SessionCommand[]): SessionCommand[] {
  const typed = /^\/(\S*)$/.exec(draft)?.[1]

  if (typed === undefined) {
    return []
  }

  const query = typed.toLowerCase()
  const matches = commands.filter(command => command.name.toLowerCase().includes(query))

  return matches
    .sort((left, right) => Number(right.name.toLowerCase().startsWith(query)) - Number(left.name.toLowerCase().startsWith(query)))
    .slice(0, MENU_LIMIT)
}

const UPLOAD_LIMIT = 20 * 1024 * 1024

function hasFiles(event: React.DragEvent): boolean {
  return [...event.dataTransfer.types].includes('Files')
}

function AttachmentChip({ item, onRemove }: { item: Attachment; onRemove: () => void }) {
  const extension = item.name.split('.').at(-1)?.toUpperCase() ?? ''

  return (
    <div className={`attachment ${item.status}`} title={item.error ?? item.name}>
      {item.isImage && item.url !== null ? (
        <img className="attachment-thumb" src={item.url} alt="" />
      ) : (
        <span className="attachment-type mono">{extension.slice(0, 4)}</span>
      )}
      <span className="attachment-label">
        <span className="ellipsis small">{item.name}</span>
        {item.status === 'uploading' && <span className="small muted">завантаження…</span>}
        {item.status === 'failed' && <span className="small text-fail">{item.error}</span>}
      </span>
      <button type="button" className="ghost attachment-remove" aria-label={`Прибрати ${item.name}`} onClick={onRemove}>
        <Icon name="close" />
      </button>
    </div>
  )
}

type ComposerProps = {
  session: SessionView
  draft: string
  onDraft: (text: string) => void
  attachments: Attachment[]
  onAttachments: (update: (current: Attachment[]) => Attachment[]) => void
  focusRequest: number
}

function Composer({ session, draft, onDraft, attachments, onAttachments, focusRequest }: ComposerProps) {
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const ready = attachments.filter(item => item.status === 'ready' && item.path !== null)
  const isUploading = attachments.some(item => item.status === 'uploading')
  const command = shellCommand(draft)
  const isShell = command !== null
  const canSend = isShell ? command !== '' : !isUploading && (draft.trim() !== '' || ready.length > 0)
  const [commands, setCommands] = useState<SessionCommand[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const [isMenuClosed, setIsMenuClosed] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const matches = isMenuClosed ? [] : matchingCommands(draft, commands)
  const active = Math.min(highlighted, Math.max(matches.length - 1, 0))

  useEffect(() => {
    void loadCommands(session.id).then(setCommands)
  }, [session.id, draft.startsWith('/')])

  useEffect(() => {
    const textarea = field.current

    if (textarea === null || isTypingIn(document.activeElement as HTMLElement | null)) {
      return
    }

    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [focusRequest])

  const change = (key: string, update: Partial<Attachment>) =>
    onAttachments(current => current.map(item => (item.key === key ? { ...item, ...update } : item)))

  const addFiles = (files: readonly File[]) => {
    for (const file of files) {
      const key = crypto.randomUUID()
      const name = file.name === '' ? 'знімок.png' : file.name
      const isTooLarge = file.size > UPLOAD_LIMIT

      onAttachments(current => [
        ...current,
        {
          key,
          name,
          status: isTooLarge ? 'failed' : 'uploading',
          path: null,
          url: null,
          isImage: file.type.startsWith('image/'),
          error: isTooLarge ? 'більше 20 МБ' : null,
        },
      ])

      if (!isTooLarge) {
        uploadFile(session.id, file)
          .then(upload => change(key, { status: 'ready', name: upload.name, path: upload.path, url: upload.url, isImage: upload.isImage }))
          .catch((failure: Error) =>
            change(key, { status: 'failed', error: failure.message === 'too_large' ? 'більше 20 МБ' : 'не завантажився' }),
          )
      }
    }
  }

  const submit = () => {
    if (!canSend) {
      return
    }

    const text = isShell ? draft.trim() : composeMessage(draft, ready.map(item => item.path as string))
    const kept = draft

    onDraft('')
    setError(null)

    if (!isShell) {
      onAttachments(() => [])
    }

    sendMessage(session.id, text).catch((failure: Error) => {
      onDraft(kept)

      if (!isShell) {
        onAttachments(() => ready)
      }

      setError(sendErrorText(failure.message))
    })
  }

  const accept = (command: SessionCommand) => {
    onDraft(`/${command.name} `)
    setIsMenuClosed(true)
    field.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const choice = matches[active]

    if (choice !== undefined && event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((active + 1) % matches.length)
    } else if (choice !== undefined && event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((active - 1 + matches.length) % matches.length)
    } else if (choice !== undefined && event.key === 'Escape') {
      setIsMenuClosed(true)
    } else if (choice !== undefined && event.key === 'Tab') {
      event.preventDefault()
      accept(choice)
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()

      const isExact = choice !== undefined && draft === `/${choice.name}`

      if (choice !== undefined && !isExact) {
        accept(choice)
      } else {
        submit()
      }
    }
  }

  return (
    <div
      className={`composer ${isDragging ? 'dragging' : ''} ${isShell ? 'shell' : ''}`}
      onDragOver={event => {
        if (hasFiles(event)) {
          event.preventDefault()
          setIsDragging(true)
        }
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={event => {
        event.preventDefault()
        setIsDragging(false)
        addFiles([...event.dataTransfer.files])
      }}
    >
      {error !== null && <p className="small text-fail">{error}</p>}
      {isShell && (
        <p className="shell-label small">
          <span className="shell-badge mono">Термінал</span>
          {canUseShell(session)
            ? 'Команда виконається в сесії, як ! у Claude Code, через ті самі правила дозволів.'
            : 'У цій сесії старий мод: виконай у ній /reload-plugins, тоді команди з ! запрацюють.'}
        </p>
      )}
      {attachments.length > 0 && !isShell && (
        <div className="attachments">
          {attachments.map(item => (
            <AttachmentChip
              key={item.key}
              item={item}
              onRemove={() => onAttachments(current => current.filter(other => other.key !== item.key))}
            />
          ))}
        </div>
      )}
      {matches.length > 0 && (
        <div className="command-menu" role="listbox" aria-label="Команди сесії">
          {matches.map((command, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              key={command.name}
              className={`command-item ${index === active ? 'active' : ''}`}
              onMouseEnter={() => setHighlighted(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => accept(command)}
            >
              <span className="mono">/{command.name}</span>
              <span className="small muted ellipsis">{command.description}</span>
            </button>
          ))}
        </div>
      )}
      <div className="composer-row">
        <button
          type="button"
          hidden={isShell}
          className="action attach"
          aria-label="Додати файл або скріншот"
          title="Додати файл або скріншот. Можна вставити з буфера чи перетягнути"
          onClick={() => picker.current?.click()}
        >
          <Icon name="clip" />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={event => {
            addFiles([...(event.target.files ?? [])])
            event.target.value = ''
          }}
        />
        <textarea
          ref={field}
          rows={2}
          aria-label="Повідомлення в сесію"
          placeholder={`Написати в «${session.name}». Enter надсилає, / показує команди`}
          value={draft}
          onChange={event => {
            onDraft(event.target.value)
            setHighlighted(0)
            setIsMenuClosed(false)
          }}
          onKeyDown={onKeyDown}
          onPaste={event => {
            const files = [...event.clipboardData.files]

            if (files.length > 0) {
              event.preventDefault()
              addFiles(files)
            }
          }}
        />
        <button type="button" className="primary" disabled={!canSend} onClick={submit}>
          Надіслати
        </button>
      </div>
    </div>
  )
}

function SidePanel({
  session,
  snapshot,
  clock,
  onFile,
  onClose,
}: {
  session: SessionView
  snapshot: Snapshot
  clock: number
  onFile: (path: string) => void
  onClose: () => void
}) {
  const agents = session.agents.filter(agent => ['pending', 'running', 'waiting'].includes(agent.status))
  const context = session.contextPercent
  const [isClearing, setIsClearing] = useState(false)
  const isLive = session.status !== 'offline'

  return (
    <aside className="side">
      <button type="button" className="action narrow-side side-close" onClick={onClose}>
        Сховати деталі
      </button>
      <Progress session={session} clock={clock} />

      <div className="side-row small muted">
        <span>Контекст</span>
        <span className="mono">{context === null ? '—' : `${context}%`}</span>
      </div>
      <div className="track context">
        <div className="fill violet" style={{ width: `${context ?? 0}%` }} />
      </div>
      {isLive && !isClearing && (
        <div className="context-actions">
          <button
            type="button"
            className="action context-button"
            title="Стиснути розмову в коротке зведення (/compact)"
            onClick={() => void sendMessage(session.id, '/compact')}
          >
            Compact
          </button>
          <button
            type="button"
            className="action context-button"
            title="Почати розмову з чистого контексту (/clear)"
            onClick={() => setIsClearing(true)}
          >
            Clear
          </button>
        </div>
      )}
      {isLive && isClearing && (
        <div className="context-confirm small">
          <span>Очистити контекст? Сесія забуде розмову, файли й гілка лишаться.</span>
          <span className="context-actions">
            <button
              type="button"
              className="action context-button danger"
              onClick={() => {
                setIsClearing(false)
                void sendMessage(session.id, '/clear')
              }}
            >
              Clear
            </button>
            <button type="button" className="action context-button" onClick={() => setIsClearing(false)}>
              Скасувати
            </button>
          </span>
        </div>
      )}

      <div className="side-label small muted">Агенти: {agents.length + 1}</div>
      <div className="agents">
        <div className="agent">
          <span className={`dot status-${session.status} ${isRunning(session) ? 'pulse' : ''}`} />
          <div>
            <div>Основний</div>
            <div className="small muted">{session.activity}</div>
          </div>
        </div>
        {agents.map(agent => (
          <div key={agent.id} className="agent">
            <span className="dot status-work pulse" />
            <div>
              <div>{agent.type}</div>
              <div className="small muted">{agent.description}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="side-label small muted">Змінені файли: {session.files.length}</div>
      {session.files.slice(0, 40).map(file => (
        <button type="button" key={file.path} className="file mono small" title="Показати зміни" onClick={() => onFile(file.path)}>
          <span>{file.path}</span>
          <span className="muted nowrap">{file.isNew ? 'новий' : `+${file.added} −${file.removed}`}</span>
        </button>
      ))}

      <div className="side-label small muted section-gap">Де відкрита</div>
      <div className="small">
        {session.terminal ?? 'Термінал не визначено'}
        {session.pid !== null && <span className="muted mono"> · pid {session.pid}</span>}
      </div>
      <div className="small muted ellipsis" title={session.cwd}>
        {session.cwd}
      </div>
      {session.model !== null && <div className="small muted mono">{session.model}</div>}

      <ChecksPanel checks={snapshot.checks} repoRoot={session.repoRoot} clock={clock} />
    </aside>
  )
}

type Props = {
  session: SessionView
  snapshot: Snapshot
  rows: readonly Row[]
  outbox: readonly OutboxItem[]
  clock: number
  onRows: (update: (current: Row[]) => Row[]) => void
  focusRequest: number
}

export function SessionScreen({ session, snapshot, rows, outbox, clock, onRows, focusRequest }: Props) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isResuming, setIsResuming] = useState(false)
  const [draft, setDraft] = useState(() => loadDraft(browserStore(), session.id))
  const [attachments, setAttachments] = useState<Attachment[]>(() => loadAttachments(browserStore(), session.id))
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const [isSideOpen, setIsSideOpen] = useState(false)
  const [isEditingButtons, setIsEditingButtons] = useState(false)
  const asks = snapshot.asks.filter(ask => ask.sessionId === session.id)

  useEffect(() => saveDraft(browserStore(), session.id, draft), [session.id, draft])
  useEffect(() => saveAttachments(browserStore(), session.id, attachments), [session.id, attachments])
  const isOffline = session.status === 'offline'
  const canResume = session.endedAt !== null

  return (
    <div className={`session ${isSideOpen ? 'side-open' : ''}`}>
      <div className="session-main">
        <div className="session-head">
          <div className="session-name">
            <h1 className="ellipsis" title={session.name}>
              {session.name}
            </h1>
            <span className={`pill pill-${session.status}`}>
              <span className={`dot status-${session.status} ${isRunning(session) ? 'pulse' : ''}`} />
              {session.endedAt === null ? STATUS_LABEL[session.status] : 'закрита'}
            </span>
          </div>
          <div className="session-meta mono small muted ellipsis" title={`${session.repoName} · ${session.branch ?? 'без гілки'}`}>
            {session.repoName} · {session.branch ?? 'без гілки'}
          </div>
          {!isOffline && (
            <div className="session-controls">
              <ModelControls session={session} />
            </div>
          )}
          <div className="session-actions">
            <button
              type="button"
              className="action narrow-side"
              aria-expanded={isSideOpen}
              onClick={() => setIsSideOpen(value => !value)}
            >
              Деталі
            </button>
            {session.turnId !== null && (
              <button type="button" className="action warn" onClick={() => void abortTurn(session.id)}>
                <Icon name="stop" />
                Зупинити
              </button>
            )}
            {!isOffline && (
              <>
                <button type="button" className="action" onClick={() => setIsRenaming(value => !value)}>
                  <Icon name="pencil" />
                  Перейменувати
                </button>
                <button type="button" className="action danger" onClick={() => setIsClosing(true)}>
                  <Icon name="close" />
                  Закрити
                </button>
              </>
            )}
            {canResume && (
              <button type="button" className="action accent" onClick={() => setIsResuming(true)}>
                <Icon name="play" />
                Продовжити сесію
              </button>
            )}
          </div>
          {isRenaming && !isOffline && <RenameForm session={session} onDone={() => setIsRenaming(false)} />}
        </div>
        <Conversation session={session} rows={rows} onRows={onRows} />
        <div className="session-bottom">
          {asks.map(ask => (
            <AskCard key={ask.id} ask={ask} session={session} />
          ))}
          <OutboxNotes
            session={session}
            outbox={outbox}
            onEdit={message => {
              const { text, paths } = splitAttachments(message)

              setDraft(text)
              setAttachments(restoreAttachments(paths))
            }}
          />
          {!isOffline && (
            <QuickButtons session={session} buttons={snapshot.buttons ?? []} onEdit={() => setIsEditingButtons(true)} />
          )}
          {isOffline ? (
            <ClosedNote session={session} clock={clock} />
          ) : (
            <Composer
              session={session}
              draft={draft}
              onDraft={setDraft}
              attachments={attachments}
              onAttachments={setAttachments}
              focusRequest={focusRequest}
            />
          )}
        </div>
      </div>
      <SidePanel
        session={session}
        snapshot={snapshot}
        clock={clock}
        onFile={setDiffPath}
        onClose={() => setIsSideOpen(false)}
      />
      {diffPath !== null && (
        <DiffDialog session={session} path={diffPath} onPath={setDiffPath} onClose={() => setDiffPath(null)} />
      )}
      {isEditingButtons && <ButtonsDialog buttons={snapshot.buttons ?? []} onClose={() => setIsEditingButtons(false)} />}
      {isClosing && <CloseDialog session={session} onClose={() => setIsClosing(false)} />}
      {isResuming && <ResumeDialog session={session} onClose={() => setIsResuming(false)} />}
    </div>
  )
}
