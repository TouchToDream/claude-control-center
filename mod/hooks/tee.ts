const WRAPPERS = new Set(['php', 'npx', 'bunx', 'env', 'time', 'timeout', 'nice', 'exec'])
const FLAGS_WITH_VALUE = new Set(['-d', '-c'])
const RUNNERS = new Set(['phpunit', 'paratest', 'pest', 'vitest', 'jest', 'phpstan'])
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'composer'])
const FILE_REDIRECT = /(?:^|\s)(?:[12]?>>?|&>>?)\s*[^\s&]/

type Segment = { text: string; separator: string }

function segments(command: string): Segment[] {
  const parts: Segment[] = []
  let current = ''
  let quote: string | null = null

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string
    const next = command[index + 1]
    const pair = char + (next ?? '')

    if (char === '\\' && quote !== "'") {
      current += pair
      index += 1
    } else if (quote !== null) {
      quote = char === quote ? null : quote
      current += char
    } else if (char === '"' || char === "'") {
      quote = char
      current += char
    } else if (pair === '&&' || pair === '||') {
      parts.push({ text: current, separator: pair })
      current = ''
      index += 1
    } else if (char === ';' || char === '|' || char === '\n') {
      parts.push({ text: current, separator: char })
      current = ''
    } else {
      current += char
    }
  }

  return [...parts, { text: current, separator: '' }]
}

function isRunner(segment: string): boolean {
  let words = segment.trim().split(/\s+/)
  const base = (word: string | undefined) => (word ?? '').split('/').at(-1) ?? ''

  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) {
    words = words.slice(1)
  }

  while (WRAPPERS.has(base(words[0]))) {
    words = words.slice(1)

    while ((words[0] ?? '').startsWith('-') || /^\d+[smh]?$/.test(words[0] ?? '') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) {
      words = words.slice(FLAGS_WITH_VALUE.has(words[0] ?? '') ? 2 : 1)
    }
  }

  const [head, second, third] = [base(words[0]), words[1], words[2]]
  const isScript = PACKAGE_MANAGERS.has(head) && (second === 'test' || (second === 'run' && third === 'test'))
  const isAnalyse = head === 'composer' && (second === 'analyse' || second === 'analyze')

  return RUNNERS.has(head) || (head === 'artisan' && second === 'test') || isScript || isAnalyse
}

export function withOutputCopy(command: string, file: string): string | null {
  const parts = segments(command)
  const index = parts.findIndex(part => isRunner(part.text))
  const runner = parts[index]
  const after = parts[index + 1]
  const isPiped = runner?.separator === '|' && after !== undefined && !/^\s*tee\b/.test(after.text)

  if (runner === undefined || !isPiped || FILE_REDIRECT.test(runner.text.replace(/\d?>&\d/g, ''))) {
    return null
  }

  const head = parts.slice(0, index).map(part => part.text + part.separator).join('')
  const tail = parts.slice(index + 1).map(part => part.text + part.separator).join('')

  return `${head}${runner.text.trimEnd()} | tee ${file} |${tail}`
}
