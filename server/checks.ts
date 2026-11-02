import { matchesAnyCommand, splitCommand } from './status.ts'
import type { CheckKind, Settings, TestProgress } from './types.ts'

const TOOLS: [RegExp, string][] = [
  [/\bartisan test\b/, 'artisan test'],
  [/\bparatest\b/, 'ParaTest'],
  [/\bphpunit\b/, 'PHPUnit'],
  [/\bpest\b/, 'Pest'],
  [/\bvitest\b/, 'Vitest'],
  [/\bjest\b/, 'Jest'],
  [/\bpytest\b/, 'pytest'],
  [/\bpint\b/, 'Pint'],
  [/php-cs-fixer/, 'PHP CS Fixer'],
  [/\beslint\b|\bexpo lint\b/, 'ESLint'],
  [/\bprettier\b/, 'Prettier'],
  [/\bbiome\b/, 'Biome'],
  [/\bphpstan\b|\bcomposer analy[sz]e\b/, 'PHPStan'],
  [/\bpsalm\b/, 'Psalm'],
  [/\b(?:vue-)?tsc\b|\btypecheck\b/, 'TypeScript'],
]
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'composer', 'npx', 'bunx'])
const PHPSTAN_BAR = /(\d+)\/(\d+) \[[^\]]*\]\s+\d+%/g

export function checkKind(command: string, settings: Settings): CheckKind | null {
  if (matchesAnyCommand(command, settings.testCommands)) {
    return 'tests'
  }

  if (matchesAnyCommand(command, settings.analysisCommands)) {
    return 'analysis'
  }

  return matchesAnyCommand(command, settings.lintCommands) ? 'lint' : null
}

export function commandPatterns(kind: CheckKind, settings: Settings): string[] {
  return { tests: settings.testCommands, lint: settings.lintCommands, analysis: settings.analysisCommands }[kind]
}

export function checkVerdict(tool: string, output: string): { failed: boolean; summary: string } | null {
  const summary = summarizeCheck(tool, output)
  const isClean = summary !== null && /^(?:без |виправлено)/.test(summary)

  if (summary === null || (tool === 'TypeScript' && !/Found \d+ errors?|error TS\d+/.test(output))) {
    return null
  }

  return { failed: !isClean, summary }
}

export function toolName(command: string): string {
  const known = TOOLS.find(([pattern]) => pattern.test(command))

  if (known !== undefined) {
    return known[1]
  }

  const words = command.trim().split(/\s+/).filter(word => !word.startsWith('-'))
  const [first = '', second = '', third = ''] = words
  const script = second === 'run' ? third : second

  return PACKAGE_MANAGERS.has(first) && script !== '' ? `${first} ${script}` : first
}

export function describeCheck(command: string, settings: Settings): { kind: CheckKind; tool: string } | null {
  const kind = checkKind(command, settings)

  if (kind === null) {
    return null
  }

  const patterns = commandPatterns(kind, settings)
  const part = splitCommand(command)
    .map(piece => piece.replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '').replace(/\s*\d?>.*$/, ''))
    .find(piece => matchesAnyCommand(piece, patterns))

  return { kind, tool: toolName(part ?? command) }
}

function count(pattern: RegExp, output: string): number | null {
  const found = pattern.exec(output)

  return found?.[1] === undefined ? null : Number(found[1])
}

export function summarizeCheck(tool: string, output: string): string | null {
  switch (tool) {
    case 'PHPStan': {
      const errors = count(/Found (\d+) errors?/, output)

      if (errors !== null) {
        return `помилок: ${errors}`
      }

      return /\[OK\] No errors/.test(output) ? 'без помилок' : null
    }
    case 'Pint': {
      const fixed = count(/(\d+) style issues? fixed/, output)
      const issues = count(/(\d+) style issues?/, output)

      if (fixed !== null) {
        return `виправлено: ${fixed}`
      }

      if (issues !== null) {
        return `порушень стилю: ${issues}`
      }

      return /^\s*PASS\b/m.test(output) ? 'без порушень' : null
    }
    case 'TypeScript': {
      const found = count(/Found (\d+) errors?/, output)
      const listed = output.match(/error TS\d+/g)?.length ?? 0

      if (found !== null) {
        return `помилок: ${found}`
      }

      return listed > 0 ? `помилок: ${listed}` : null
    }
    case 'ESLint': {
      const problems = count(/✖ (\d+) problems?/, output)

      return problems === null ? null : `проблем: ${problems}`
    }
    case 'Psalm': {
      const errors = count(/(\d+) errors? found/, output)

      return errors === null ? null : `помилок: ${errors}`
    }
    default:
      return null
  }
}

export function parseCheckProgress(tool: string, output: string): Omit<TestProgress, 'updatedAt'> | null {
  if (tool !== 'PHPStan') {
    return null
  }

  const last = [...output.matchAll(PHPSTAN_BAR)].at(-1)

  if (last?.[1] === undefined || last[2] === undefined) {
    return null
  }

  return { runner: 'PHPStan', unit: 'files', total: Number(last[2]), done: Number(last[1]), failed: 0, suites: [] }
}
