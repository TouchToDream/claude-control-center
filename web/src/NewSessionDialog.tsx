import { useState } from 'react'
import { startBackground } from './api.ts'

type Result = { id: string | null; output: string; error: string | null }

export function NewSessionDialog({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [prompt, setPrompt] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const start = () => {
    setIsStarting(true)
    startBackground(cwd, prompt)
      .then(setResult)
      .catch(() => setResult({ id: null, output: '', error: 'Сервіс не прийняв запит' }))
      .finally(() => setIsStarting(false))
  }

  const attach = result?.id === null || result === null ? null : `claude attach ${result.id}`

  return (
    <div className="overlay" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Нова сесія">
        <h2>Нова фонова сесія</h2>
        <p className="small muted">
          Запускає <span className="mono">claude --bg</span> у теці {cwd}. Це фонова сесія, а не термінал IDE. Її можна
          підключити в термінал командою, яку панель покаже після запуску. Перше повідомлення витрачає токени.
        </p>
        {result === null ? (
          <>
            <label className="small muted">
              Перше повідомлення
              <textarea className="field" rows={4} value={prompt} onChange={event => setPrompt(event.target.value)} />
            </label>
            <div className="dialog-buttons">
              <button type="button" className="ghost outline" onClick={onClose}>
                Скасувати
              </button>
              <button type="button" className="primary" disabled={isStarting || prompt.trim() === ''} onClick={start}>
                {isStarting ? 'Запуск…' : 'Запустити'}
              </button>
            </div>
          </>
        ) : (
          <>
            {attach !== null && (
              <>
                <p className="small">Сесію запущено. Щоб відкрити її в терміналі IDE, виконай:</p>
                <pre className="mono command">{attach}</pre>
              </>
            )}
            {result.error !== null && <p className="small text-fail">Не вдалося запустити: {result.error}</p>}
            {attach === null && result.error === null && <pre className="mono command">{result.output}</pre>}
            <div className="dialog-buttons">
              <button type="button" className="primary" onClick={onClose}>
                Закрити
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
