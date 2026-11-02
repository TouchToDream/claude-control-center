import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

export const UPLOAD_LIMIT = 20 * 1024 * 1024

const NAME_LIMIT = 80
const SESSION_ID = /^[A-Za-z0-9-]+$/
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}
const OTHER_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
}

export type Upload = {
  name: string
  path: string
  size: number
  isImage: boolean
  url: string
}

export function safeFileName(name: string): string {
  const cleaned = basename(name)
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^[._]+/, '')

  if (cleaned === '') {
    return 'file'
  }

  const extension = extname(cleaned).slice(0, 10)
  const stem = cleaned.slice(0, cleaned.length - extname(cleaned).length)

  return stem.slice(0, NAME_LIMIT - extension.length) + extension
}

export function mediaType(file: string): string {
  const extension = extname(file).toLowerCase()

  return IMAGE_TYPES[extension] ?? OTHER_TYPES[extension] ?? 'application/octet-stream'
}

export function saveUpload(root: string, sessionId: string, name: string, bytes: Buffer, now: number): Upload {
  if (!SESSION_ID.test(sessionId)) {
    throw new Error('bad session id')
  }

  const folder = join(root, sessionId)
  const safe = safeFileName(name)
  const file = `${now.toString(36)}-${randomBytes(3).toString('hex')}-${safe}`
  const path = join(folder, file)

  mkdirSync(folder, { recursive: true, mode: 0o700 })
  writeFileSync(path, bytes, { mode: 0o600 })

  return {
    name: safe,
    path,
    size: bytes.length,
    isImage: mediaType(file).startsWith('image/'),
    url: `/api/panel/uploads/${sessionId}/${encodeURIComponent(file)}`,
  }
}

export function uploadPath(root: string, sessionId: string, file: string): string | null {
  const isSafe = SESSION_ID.test(sessionId) && file === basename(file) && !file.startsWith('.')
  const path = join(root, sessionId, file)

  return isSafe && existsSync(path) && statSync(path).isFile() ? path : null
}

export function pruneUploads(root: string, cutoff: number): number {
  if (!existsSync(root)) {
    return 0
  }

  let removed = 0

  for (const folder of readdirSync(root, { withFileTypes: true })) {
    if (!folder.isDirectory()) {
      continue
    }

    const path = join(root, folder.name)

    for (const file of readdirSync(path)) {
      const filePath = join(path, file)

      if (statSync(filePath).mtimeMs < cutoff) {
        rmSync(filePath, { force: true })
        removed += 1
      }
    }

    if (readdirSync(path).length === 0) {
      rmdirSync(path)
    }
  }

  return removed
}
