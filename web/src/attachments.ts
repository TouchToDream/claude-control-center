const MARKER = /^\[Вкладення: (.+)\]$/
const UPLOAD = /\/\.claude-control-center\/uploads\/([A-Za-z0-9-]+)\/([^/]+)$/
const IMAGE = /\.(png|jpe?g|gif|webp)$/i

export function composeMessage(text: string, paths: readonly string[]): string {
  const body = text.trim()
  const lines = paths.map(path => `[Вкладення: ${path}]`).join('\n')

  if (lines === '') {
    return body
  }

  return body === '' ? lines : `${body}\n\n${lines}`
}

export function splitAttachments(message: string): { text: string; paths: string[] } {
  const paths: string[] = []
  const rest: string[] = []

  for (const line of message.split('\n')) {
    const found = MARKER.exec(line)

    if (found?.[1] === undefined) {
      rest.push(line)
    } else {
      paths.push(found[1])
    }
  }

  return { text: rest.join('\n').trim(), paths }
}

export function previewUrl(path: string): string | null {
  const found = UPLOAD.exec(path)

  if (found?.[1] === undefined || found[2] === undefined || !IMAGE.test(found[2])) {
    return null
  }

  return `/api/panel/uploads/${found[1]}/${encodeURIComponent(found[2])}`
}

export function shortLabel(message: string, limit: number): string {
  const { text, paths } = splitAttachments(message)
  const shown = text.slice(0, limit)

  return paths.length === 0 ? shown : `${shown} · вкладень: ${paths.length}`
}

export function restoreAttachments(paths: readonly string[]) {
  return paths.map(path => {
    const url = previewUrl(path)

    return {
      key: path,
      name: path.split('/').at(-1) ?? path,
      status: 'ready' as const,
      path,
      url,
      isImage: url !== null,
      error: null,
    }
  })
}
