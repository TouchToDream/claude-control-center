import { useEffect, useMemo, useState } from 'react'
import { loadDiff, openFileInIde } from './api.ts'
import { Icon } from './Icon.tsx'
import type { SessionView } from './model.ts'

type DiffLine = {
  kind: 'hunk' | 'add' | 'remove' | 'context'
  text: string
  oldLine: number | null
  newLine: number | null
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let isInHunk = false

  for (const text of diff.split('\n')) {
    const hunk = HUNK.exec(text)

    if (hunk !== null) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      isInHunk = true
      lines.push({ kind: 'hunk', text, oldLine: null, newLine: null })
    } else if (!isInHunk || text.startsWith('\\')) {
      continue
    } else if (text.startsWith('+')) {
      lines.push({ kind: 'add', text: text.slice(1), oldLine: null, newLine })
      newLine += 1
    } else if (text.startsWith('-')) {
      lines.push({ kind: 'remove', text: text.slice(1), oldLine, newLine: null })
      oldLine += 1
    } else if (text.startsWith(' ')) {
      lines.push({ kind: 'context', text: text.slice(1), oldLine, newLine })
      oldLine += 1
      newLine += 1
    }
  }

  return lines
}

type Props = {
  session: SessionView
  path: string
  onPath: (path: string) => void
  onClose: () => void
}

export function DiffDialog({ session, path, onPath, onClose }: Props) {
  const [diff, setDiff] = useState<string | null>(null)
  const [isTruncated, setIsTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lines = useMemo(() => parseDiff(diff ?? ''), [diff])
  const firstLine = lines.find(line => line.newLine !== null)?.newLine ?? null

  useEffect(() => {
    let isCurrent = true

    setDiff(null)
    setError(null)
    loadDiff(session.id, path)
      .then(result => {
        if (isCurrent) {
          setDiff(result.diff)
          setIsTruncated(result.isTruncated)
        }
      })
      .catch(() => isCurrent && setError('Не вдалося прочитати зміни'))

    return () => {
      isCurrent = false
    }
  }, [session.id, path])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const open = (line: number | null) => {
    openFileInIde(session.id, path, line).catch(() => setError('Не вдалося відкрити файл'))
  }

  return (
    <div className="overlay" role="presentation">
      <div className="diff-dialog" role="dialog" aria-modal="true" aria-label={`Зміни у ${path}`}>
        <div className="diff-head">
          <h2 className="mono ellipsis" title={path}>
            {path}
          </h2>
          <button type="button" className="action" onClick={() => open(firstLine)}>
            Відкрити в IDE
          </button>
          <button type="button" className="action" aria-label="Закрити перегляд" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="diff-body">
          <nav className="diff-files" aria-label="Змінені файли">
            {session.files.map(file => (
              <button
                type="button"
                key={file.path}
                className={`diff-file mono ${file.path === path ? 'selected' : ''}`}
                title={file.path}
                onClick={() => onPath(file.path)}
              >
                <span className="ellipsis">{file.path.split('/').at(-1)}</span>
                <span className="muted nowrap">{file.isNew ? 'новий' : `+${file.added} −${file.removed}`}</span>
              </button>
            ))}
          </nav>
          <div className="diff-view mono">
            {error !== null && <p className="small text-fail diff-note">{error}</p>}
            {diff === null && error === null && <p className="small muted diff-note">Завантаження…</p>}
            {diff !== null && lines.length === 0 && (
              <p className="small muted diff-note">
                {diff.includes('Binary files') ? 'Двійковий файл, текстового порівняння немає.' : 'Змін більше немає.'}
              </p>
            )}
            {lines.map((line, index) =>
              line.kind === 'hunk' ? (
                <div key={index} className="diff-hunk">
                  {line.text}
                </div>
              ) : (
                <button
                  type="button"
                  key={index}
                  className={`diff-line diff-${line.kind}`}
                  title="Відкрити цей рядок в IDE"
                  onClick={() => open(line.newLine ?? line.oldLine)}
                >
                  <span className="diff-number">{line.oldLine ?? ''}</span>
                  <span className="diff-number">{line.newLine ?? ''}</span>
                  <span className="diff-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ''}</span>
                  <span className="diff-text">{line.text}</span>
                </button>
              ),
            )}
            {isTruncated && <p className="small muted diff-note">Показано лише початок: файл завеликий. Решта є в IDE.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
