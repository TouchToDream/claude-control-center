import type { TestSuiteProgress } from './types.ts'

export type ParsedProgress = {
  runner: string
  unit: 'tests' | 'files'
  total: number
  done: number
  failed: number
  suites: TestSuiteProgress[]
  isFinal: boolean
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g
const DOT_ROW = /^([.FESRWDNIT?]+)\s+(\d+)\s*\/\s*(\d+)\s*\(\s*\d+%\)\s*$/
const DOT_PARTIAL = /^[.FESRWDNIT?]+$/
const PHPUNIT_OK = /^OK \((\d+) tests?,/m
const PHPUNIT_SUMMARY = /^Tests: (\d+), Assertions: \d+(.*)$/m
const COLLISION_CLASS = /^\s+(PASS|FAIL|WARN)\s+(\S.*?)\s*$/
const COLLISION_PASSED = /^\s*[✓!\-…]\s/
const COLLISION_FAILED = /^\s*[⨯×]\s/
const COLLISION_SUMMARY = /^\s*Tests:\s+(.*\b(?:passed|failed)\b.*)$/m
const JEST_FILE = /^(PASS|FAIL)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)/
const JEST_SUMMARY = /^Tests:\s+(.*)\b(\d+) total\s*$/m
const SUITE_LIMIT = 12

export function parseTestOutput(raw: string): ParsedProgress | null {
  const text = raw.replace(ANSI, '')

  return parseAgentJson(text) ?? parseJest(text) ?? parsePhpunit(text) ?? parseCollision(text)
}

function parseAgentJson(text: string): ParsedProgress | null {
  for (const line of text.split('\n').reverse()) {
    if (!line.startsWith('{"tool":')) {
      continue
    }

    try {
      const result = JSON.parse(line) as { tool: string; tests?: number; failed?: number; errors?: number }

      if (result.tests !== undefined) {
        return {
          runner: result.tool,
          unit: 'tests',
          total: result.tests,
          done: result.tests,
          failed: (result.failed ?? 0) + (result.errors ?? 0),
          suites: [],
          isFinal: true,
        }
      }
    } catch {
      return null
    }
  }

  return null
}

function parsePhpunit(text: string): ParsedProgress | null {
  const lines = text.split('\n')
  const hasHeader = /^(PHPUnit|ParaTest) /m.test(text)
  let total = 0
  let done = 0
  let failed = 0

  for (const line of lines) {
    const row = DOT_ROW.exec(line)

    if (row !== null) {
      done = Number(row[2])
      total = Number(row[3])
      failed += countFailures(row[1] ?? '')
    } else if (hasHeader && DOT_PARTIAL.test(line.trim()) && done < total + 1) {
      done += line.trim().length
      failed += countFailures(line)
    }
  }

  const summary = PHPUNIT_SUMMARY.exec(text)
  const passed = PHPUNIT_OK.exec(text)

  if (summary !== null) {
    const tests = Number(summary[1])
    const failures = sumMatches(summary[2] ?? '', /(?:Errors|Failures): (\d+)/g)

    return { runner: 'phpunit', unit: 'tests', total: tests, done: tests, failed: failures, suites: [], isFinal: true }
  }

  if (passed !== null) {
    const tests = Number(passed[1])

    return { runner: 'phpunit', unit: 'tests', total: tests, done: tests, failed: 0, suites: [], isFinal: true }
  }

  if (total === 0 && !hasHeader) {
    return null
  }

  return { runner: 'phpunit', unit: 'tests', total, done, failed, suites: [], isFinal: false }
}

function parseCollision(text: string): ParsedProgress | null {
  const suites = new Map<string, TestSuiteProgress>()
  let current: TestSuiteProgress | null = null
  let done = 0
  let failed = 0

  for (const line of text.split('\n')) {
    const classLine = COLLISION_CLASS.exec(line)

    if (classLine !== null) {
      current = { name: shortClass(classLine[2] ?? ''), total: 0, done: 0, failed: 0 }
      suites.set(current.name, current)
    } else if (COLLISION_PASSED.test(line) || COLLISION_FAILED.test(line)) {
      const isFailed = COLLISION_FAILED.test(line)

      done += 1
      failed += isFailed ? 1 : 0

      if (current !== null) {
        current.total += 1
        current.done += 1
        current.failed += isFailed ? 1 : 0
      }
    }
  }

  if (done === 0 && suites.size === 0) {
    return null
  }

  const summary = COLLISION_SUMMARY.exec(text)

  if (summary === null) {
    return { runner: 'artisan', unit: 'tests', total: 0, done, failed, suites: keepSuites(suites), isFinal: false }
  }

  const counts = summary[1] ?? ''
  const tests = sumMatches(counts, /(\d+) (?:passed|failed|skipped|incomplete|risky|todo)/g)
  const failures = sumMatches(counts, /(\d+) failed/g)

  return { runner: 'artisan', unit: 'tests', total: tests, done: tests, failed: failures, suites: keepSuites(suites), isFinal: true }
}

function parseJest(text: string): ParsedProgress | null {
  const summary = JEST_SUMMARY.exec(text)
  const isJest = /^Test Suites:/m.test(text)

  if (summary !== null && isJest) {
    const total = Number(summary[2])
    const failed = sumMatches(summary[1] ?? '', /(\d+) failed/g)

    return { runner: 'jest', unit: 'tests', total, done: total, failed, suites: [], isFinal: true }
  }

  let done = 0
  let failed = 0

  for (const line of text.split('\n')) {
    const file = JEST_FILE.exec(line)

    if (file !== null) {
      done += 1
      failed += file[1] === 'FAIL' ? 1 : 0
    }
  }

  return done === 0
    ? null
    : { runner: 'jest', unit: 'files', total: 0, done, failed, suites: [], isFinal: false }
}

function countFailures(row: string): number {
  return [...row].filter(mark => mark === 'F' || mark === 'E').length
}

function sumMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].reduce((sum, match) => sum + Number(match[1]), 0)
}

function shortClass(name: string): string {
  return name.split('\\').at(-1) ?? name
}

function keepSuites(suites: Map<string, TestSuiteProgress>): TestSuiteProgress[] {
  const all = [...suites.values()]
  const failedFirst = [...all.filter(suite => suite.failed > 0), ...all.filter(suite => suite.failed === 0).reverse()]

  return failedFirst.slice(0, SUITE_LIMIT)
}
