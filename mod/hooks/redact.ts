const PATTERNS: readonly RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b\d{6,}:AA[A-Za-z0-9_-]{30,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
]

const ASSIGNED =
  /\b([A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|apikey|auth[_-]?key|private[_-]?key|access[_-]?key)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;&]{6,})/gi

const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi

const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi

export function redact(text: string): string {
  let out = text

  for (const pattern of PATTERNS) {
    out = out.replace(pattern, '[приховано]')
  }

  return out
    .replace(ASSIGNED, '$1$2[приховано]')
    .replace(BEARER, '$1 [приховано]')
    .replace(URL_PASSWORD, '$1[приховано]@')
}

export function clip(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }

  return `${text.slice(0, limit)}\n… обрізано ${text.length - limit} симв.`
}
