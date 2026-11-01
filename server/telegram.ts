const API_URL = 'https://api.telegram.org'
const TIMEOUT_MS = 10_000

export type TelegramChat = {
  id: string
  title: string
  type: string
}

export type TelegramApi = {
  getBotName: (token: string) => Promise<string>
  findChats: (token: string) => Promise<TelegramChat[]>
  send: (token: string, chatId: string, text: string, isSilent: boolean) => Promise<void>
}

export class TelegramError extends Error {
  readonly retryAfterSeconds: number | null

  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message)
    this.retryAfterSeconds = retryAfterSeconds
  }
}

type Reply = {
  ok: boolean
  description?: string
  parameters?: { retry_after?: number }
  result?: unknown
}

type RawChat = { id: number; title?: string; first_name?: string; username?: string; type: string }
type RawUpdate = { [key: string]: { chat?: RawChat } | number | undefined }

function chatTitle(chat: RawChat): string {
  return chat.title ?? chat.first_name ?? chat.username ?? String(chat.id)
}

export function chatsFromUpdates(updates: readonly RawUpdate[]): TelegramChat[] {
  const chats = new Map<string, TelegramChat>()

  for (const update of updates) {
    for (const value of Object.values(update)) {
      const chat = typeof value === 'object' ? value?.chat : undefined

      if (chat !== undefined) {
        chats.set(String(chat.id), { id: String(chat.id), title: chatTitle(chat), type: chat.type })
      }
    }
  }

  return [...chats.values()]
}

export function createTelegramApi(baseUrl = API_URL): TelegramApi {
  const call = async (token: string, method: string, body: object): Promise<unknown> => {
    let reply: Reply

    try {
      const response = await fetch(`${baseUrl}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      reply = (await response.json()) as Reply
    } catch {
      throw new TelegramError('Немає зв’язку з Telegram')
    }

    if (!reply.ok) {
      throw new TelegramError(reply.description ?? 'Telegram відхилив запит', reply.parameters?.retry_after ?? null)
    }

    return reply.result
  }

  return {
    getBotName: async token => {
      const bot = (await call(token, 'getMe', {})) as { username: string }

      return bot.username
    },
    findChats: async token => chatsFromUpdates((await call(token, 'getUpdates', { limit: 100 })) as RawUpdate[]),
    send: async (token, chatId, text, isSilent) => {
      await call(token, 'sendMessage', { chat_id: chatId, text, disable_notification: isSilent })
    },
  }
}
