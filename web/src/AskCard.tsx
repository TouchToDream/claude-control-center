import { useState } from 'react'
import { answerAsk } from './api.ts'
import type { Ask, SessionView } from './model.ts'

type Question = {
  question: string
  header?: string
  multiSelect?: boolean
  options?: { label: string; description?: string }[]
}

function agentLabel(ask: Ask, session: SessionView): string | null {
  if (ask.agentId === null) {
    return null
  }

  const agent = session.agents.find(item => item.id === ask.agentId)

  return `Субагент: ${agent?.description ?? ask.agentId}`
}

function Permission({ ask, session }: { ask: Ask; session: SessionView }) {
  const [error, setError] = useState<string | null>(null)
  const [isDenying, setIsDenying] = useState(false)
  const [reason, setReason] = useState('')
  const agent = agentLabel(ask, session)

  const decide = (decision: 'allow' | 'deny') => {
    setError(null)
    answerAsk(ask.id, decision === 'deny' && reason.trim() !== '' ? { decision, message: reason.trim() } : { decision })
      .catch(() => setError('Запит уже закрито або сервіс не відповідає'))
  }

  return (
    <div className="ask">
      <div className="ask-title">Дозвіл на {ask.tool}</div>
      {agent !== null && <div className="small ask-note">{agent}</div>}
      <pre className="ask-detail">{ask.tool === 'Bash' ? ask.summary : ask.detail}</pre>
      {!ask.answerable && (
        <p className="small ask-note">
          Чекає на відповідь у терміналі ({ask.blockedBy}). З панелі це не підтверджується.
        </p>
      )}
      {ask.answerable && isDenying && (
        <input
          className="field"
          aria-label="Причина відмови"
          placeholder="Що сказати Claude, необов’язково"
          value={reason}
          onChange={event => setReason(event.target.value)}
        />
      )}
      {ask.answerable && (
        <div className="ask-buttons">
          <button type="button" className="ghost ask-button" onClick={() => decide('allow')}>
            Дозволити
          </button>
          {isDenying ? (
            <button type="button" className="ghost ask-button" onClick={() => decide('deny')}>
              Підтвердити відмову
            </button>
          ) : (
            <button type="button" className="ghost ask-button" onClick={() => setIsDenying(true)}>
              Відхилити
            </button>
          )}
        </div>
      )}
      {error !== null && <p className="small text-fail">{error}</p>}
    </div>
  )
}

function QuestionForm({ ask, session }: { ask: Ask; session: SessionView }) {
  const questions = JSON.parse(ask.detail) as Question[]
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const agent = agentLabel(ask, session)

  const toggle = (question: Question, label: string) => {
    setPicked(current => {
      const chosen = current[question.question] ?? []

      if (question.multiSelect !== true) {
        return { ...current, [question.question]: [label] }
      }

      return {
        ...current,
        [question.question]: chosen.includes(label) ? chosen.filter(item => item !== label) : [...chosen, label],
      }
    })
  }

  const answerFor = (question: Question) =>
    custom[question.question]?.trim() || (picked[question.question] ?? []).join(', ')

  const isComplete = questions.every(question => answerFor(question) !== '')

  const submit = () => {
    const answers = Object.fromEntries(questions.map(question => [question.question, answerFor(question)]))

    answerAsk(ask.id, { answers }).catch(() => setError('Запит уже закрито або сервіс не відповідає'))
  }

  return (
    <div className="ask">
      {agent !== null && <div className="small ask-note">{agent}</div>}
      {questions.map(question => (
        <fieldset key={question.question} className="question">
          <legend className="ask-title">{question.question}</legend>
          <div className="options">
            {(question.options ?? []).map(option => {
              const isChosen = (picked[question.question] ?? []).includes(option.label)

              return (
                <button
                  type="button"
                  key={option.label}
                  className={`ghost option ${isChosen ? 'chosen' : ''}`}
                  aria-pressed={isChosen}
                  onClick={() => toggle(question, option.label)}
                >
                  <span className="option-label">{option.label}</span>
                  {option.description !== undefined && <span className="small option-note">{option.description}</span>}
                </button>
              )
            })}
          </div>
          <input
            className="field"
            aria-label={`Своя відповідь: ${question.question}`}
            placeholder="Своя відповідь"
            value={custom[question.question] ?? ''}
            onChange={event => setCustom(current => ({ ...current, [question.question]: event.target.value }))}
          />
        </fieldset>
      ))}
      <div className="ask-buttons">
        <button type="button" className="ghost ask-button" disabled={!isComplete} onClick={submit}>
          Відповісти
        </button>
      </div>
      {error !== null && <p className="small text-fail">{error}</p>}
    </div>
  )
}

export function AskCard({ ask, session }: { ask: Ask; session: SessionView }) {
  return ask.kind === 'question' ? (
    <QuestionForm ask={ask} session={session} />
  ) : (
    <Permission ask={ask} session={session} />
  )
}
