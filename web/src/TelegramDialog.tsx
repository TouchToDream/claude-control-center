import { useEffect, useState } from 'react'
import { loadTelegram, telegramAction } from './api.ts'
import type { NotifyEvent, TelegramChat, TelegramView } from './model.ts'

const EVENTS: { key: NotifyEvent; label: string; note: string }[] = [
  { key: 'ask', label: 'Чекає на відповідь', note: 'зі звуком' },
  { key: 'testsFailed', label: 'Тести впали', note: 'зі звуком' },
  { key: 'turnError', label: 'Хід завершився помилкою', note: 'зі звуком' },
  { key: 'crashed', label: 'Сесія несподівано закрилася', note: 'зі звуком' },
  { key: 'done', label: 'Завершила роботу, якщо хід довший за 2 хв', note: 'без звуку' },
  { key: 'testsPassed', label: 'Тести пройшли', note: 'без звуку' },
  { key: 'limit', label: 'Ліміт дійшов до 80% і 95%', note: 'без звуку' },
]

export function TelegramDialog({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<TelegramView | null>(null)
  const [token, setToken] = useState('')
  const [chats, setChats] = useState<TelegramChat[] | null>(null)
  const [manualChat, setManualChat] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void loadTelegram().then(setState)
  }, [])

  const run = (action: string, body: object, done?: (result: TelegramView) => void) => {
    setIsBusy(true)
    setError(null)
    setNotice(null)
    telegramAction(action, body)
      .then(result => {
        setState(result)
        done?.(result)
      })
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setIsBusy(false))
  }

  const saveToken = () => run('token', { token }, () => setToken(''))
  const findChats = () => run('chats', {}, result => setChats(result.chats ?? []))
  const pickChat = (chat: TelegramChat) => run('chat', { chatId: chat.id, chatTitle: chat.title }, () => setChats(null))
  const sendTest = () => run('test', {}, () => setNotice('Тестове повідомлення надіслано'))

  const hasBot = state?.botName !== null && state?.botName !== undefined

  return (
    <div className="overlay" role="presentation">
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label="Налаштування Telegram">
        <h2>Сповіщення в Telegram</h2>

        {state === null ? (
          <p className="small muted">Завантаження…</p>
        ) : (
          <>
            <section className="dialog-option">
              <h3>1. Бот</h3>
              {hasBot ? (
                <div className="tg-line">
                  <span className="small">
                    Підключено: <span className="mono">@{state.botName}</span>
                  </span>
                  <button type="button" className="action danger" disabled={isBusy} onClick={() => run('forget', {})}>
                    Від’єднати
                  </button>
                </div>
              ) : (
                <>
                  <p className="small muted">
                    У Telegram відкрий @BotFather, надішли /newbot і встав сюди токен. Він зберігається в Keychain цього
                    Mac, панель його більше не показує.
                  </p>
                  <div className="tg-line">
                    <input
                      className="field"
                      type="password"
                      autoComplete="off"
                      aria-label="Токен бота"
                      placeholder="123456789:AA…"
                      value={token}
                      onChange={event => setToken(event.target.value)}
                    />
                    <button type="button" className="action" disabled={isBusy || token.trim() === ''} onClick={saveToken}>
                      Зберегти
                    </button>
                  </div>
                </>
              )}
            </section>

            <section className="dialog-option">
              <h3>2. Чат</h3>
              {state.chatId !== null && (
                <p className="small">
                  Надсилаю в: {state.chatTitle ?? 'чат'} <span className="mono muted">{state.chatId}</span>
                </p>
              )}
              <p className="small muted">
                Напиши боту будь-що або додай його в групу чи канал, потім натисни «Знайти чат».
              </p>
              <button type="button" className="action" disabled={isBusy || !hasBot} onClick={findChats}>
                Знайти чат
              </button>
              {chats !== null && chats.length === 0 && (
                <p className="small muted">Чатів не знайдено. Напиши боту повідомлення й спробуй ще раз.</p>
              )}
              {chats !== null &&
                chats.map(chat => (
                  <button
                    type="button"
                    key={chat.id}
                    className="ghost tg-chat"
                    disabled={isBusy}
                    onClick={() => pickChat(chat)}
                  >
                    <span className="ellipsis">{chat.title}</span>
                    <span className="small muted mono">{chat.type}</span>
                  </button>
                ))}
              <details className="tg-manual">
                <summary className="small muted">Вказати id чату вручну</summary>
                <div className="tg-line">
                  <input
                    className="field"
                    aria-label="Id чату"
                    placeholder="-1001234567890"
                    value={manualChat}
                    onChange={event => setManualChat(event.target.value)}
                  />
                  <button
                    type="button"
                    className="action"
                    disabled={isBusy || !hasBot || manualChat.trim() === ''}
                    onClick={() => run('chat', { chatId: manualChat })}
                  >
                    Зберегти
                  </button>
                </div>
              </details>
            </section>

            <section className="dialog-option">
              <h3>3. Про що сповіщати</h3>
              <div className="tg-events">
                {EVENTS.map(event => (
                  <label key={event.key} className="tg-event small">
                    <input
                      type="checkbox"
                      checked={state.events[event.key]}
                      disabled={isBusy}
                      onChange={change => run('settings', { events: { [event.key]: change.target.checked } })}
                    />
                    <span>{event.label}</span>
                    <span className="muted">{event.note}</span>
                  </label>
                ))}
              </div>
              <p className="small muted">
                Проєкти вмикаються дзвіночком біля назви в лівій колонці. Без дзвіночка з проєкту нічого не надсилається.
                Про запит і завершення сповіщення приходить через 45 секунд: якщо ти вже відповів, воно не піде.
              </p>
            </section>

            <p className="small muted">
              Повідомлення йдуть через сервери Telegram: назва проєкту, сесії, гілка й статус. Команди й текст переписки не
              надсилаються, але назвою сесії може бути твоє перше повідомлення, якщо ти її не перейменував.
            </p>

            {state.lastError !== null && <p className="small text-fail">Остання помилка: {state.lastError}</p>}
            {error !== null && <p className="small text-fail">{error}</p>}
            {notice !== null && <p className="small text-chat">{notice}</p>}

            <div className="dialog-buttons">
              <button type="button" className="action" disabled={isBusy || !state.isReady} onClick={sendTest}>
                Надіслати тестове
              </button>
              <button type="button" className="ghost outline" onClick={onClose}>
                Готово
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
