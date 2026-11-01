import { useState } from 'react'
import { closeSession, renameSession, resumeSession } from './api.ts'
import { Icon } from './Icon.tsx'
import type { SessionView } from './model.ts'
import { isRunning } from './model.ts'

const NAME_LIMIT = 80

export function RenameForm({ session, onDone }: { session: SessionView; onDone: () => void }) {
  const [name, setName] = useState(session.name)
  const [error, setError] = useState<string | null>(null)
  const clean = name.trim()

  const submit = () => {
    if (clean === '') {
      return
    }

    renameSession(session.id, clean)
      .then(onDone)
      .catch(() => setError('Не вдалося перейменувати'))
  }

  return (
    <form
      className="rename-form"
      onSubmit={event => {
        event.preventDefault()
        submit()
      }}
    >
      <input
        className="field"
        aria-label="Нова назва сесії"
        autoFocus
        maxLength={NAME_LIMIT}
        value={name}
        onChange={event => setName(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            onDone()
          }
        }}
      />
      <button type="submit" className="primary" disabled={clean === ''}>
        Зберегти
      </button>
      <button type="button" className="ghost outline" onClick={onDone}>
        Скасувати
      </button>
      {error !== null && <p className="small text-fail">{error}</p>}
    </form>
  )
}

export function CloseDialog({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)

  const confirm = () => {
    closeSession(session.id)
      .then(onClose)
      .catch(() => setError('Не вдалося закрити сесію'))
  }

  return (
    <div className="overlay" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Закрити сесію">
        <h2>Закрити «{session.name}»?</h2>
        <p className="small muted">
          {session.isBackground
            ? 'Фонову сесію буде зупинено. '
            : 'Claude Code у цьому терміналі завершить роботу, вкладка терміналу лишиться. '}
          Переписка збережеться, сесію можна буде продовжити з панелі.
        </p>
        {isRunning(session) && !session.isBackground && (
          <p className="small text-ask">Сесія зараз працює. Вона закриється, щойно завершить поточний хід.</p>
        )}
        {isRunning(session) && session.isBackground && (
          <p className="small text-fail">Фонова сесія зупиниться одразу, поточний хід обірветься.</p>
        )}
        {error !== null && <p className="small text-fail">{error}</p>}
        <div className="dialog-buttons">
          <button type="button" className="ghost outline" onClick={onClose}>
            Скасувати
          </button>
          <button type="button" className="primary" onClick={confirm}>
            Закрити сесію
          </button>
        </div>
      </div>
    </div>
  )
}

function CopyLine({ text }: { text: string }) {
  const [isCopied, setIsCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setIsCopied(true)
      window.setTimeout(() => setIsCopied(false), 1500)
    })
  }

  return (
    <div className="copy-line">
      <code className="mono">{text}</code>
      <button type="button" className="action" onClick={copy}>
        <Icon name={isCopied ? 'check' : 'copy'} />
        {isCopied ? 'Скопійовано' : 'Копіювати'}
      </button>
    </div>
  )
}

function quoted(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`
}

type ResumeResult = { id: string | null; output: string; error: string | null }

export function ResumeDialog({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const [isStarting, setIsStarting] = useState(false)
  const [result, setResult] = useState<ResumeResult | null>(null)
  const attachId = result?.id ?? session.id.slice(0, 8)

  const start = () => {
    setIsStarting(true)
    resumeSession(session.id)
      .then(setResult)
      .catch(() => setResult({ id: null, output: '', error: 'Сесія вже відкрита або сервіс не відповідає' }))
      .finally(() => setIsStarting(false))
  }

  return (
    <div className="overlay" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Продовжити сесію">
        <h2>Продовжити «{session.name}»</h2>

        <section className="dialog-option">
          <h3>У терміналі IDE</h3>
          <p className="small muted">Встав цю команду в термінал. Сесія повернеться в панель під тим самим записом.</p>
          <CopyLine text={`cd ${quoted(session.cwd)} && claude --resume ${session.id}`} />
        </section>

        <section className="dialog-option">
          <h3>У фоні</h3>
          {result === null && (
            <>
              <p className="small muted">
                Панель запустить її без термінала. Потім її можна відкрити в IDE командою, яку панель покаже.
              </p>
              <button type="button" className="action" disabled={isStarting} onClick={start}>
                <Icon name="play" />
                {isStarting ? 'Запуск…' : 'Запустити у фоні'}
              </button>
            </>
          )}
          {result !== null && result.error === null && (
            <>
              <p className="small muted">Сесію запущено. Щоб відкрити її в терміналі IDE:</p>
              <CopyLine text={`claude attach ${attachId}`} />
            </>
          )}
          {result !== null && result.error !== null && (
            <p className="small text-fail">Не вдалося запустити: {result.error}</p>
          )}
        </section>

        <div className="dialog-buttons">
          <button type="button" className="ghost outline" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  )
}
