import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appPath, buildMacApp, hasSwift, isAppInstalled, openArguments } from './macApp.ts'
import { homeDirectory, loadSettings } from './settings.ts'

const LABEL = 'com.claude-control-center'
const PLUGIN = 'control-center@claude-control-center'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const home = homeDirectory()
const pidFile = join(home, 'service.pid')
const logFile = join(home, 'service.log')
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)

function runningPid(): number | null {
  if (!existsSync(pidFile)) {
    return null
  }

  const pid = Number(readFileSync(pidFile, 'utf8'))

  try {
    process.kill(pid, 0)

    return pid
  } catch {
    rmSync(pidFile, { force: true })

    return null
  }
}

function isManagedByLaunchd(): boolean {
  return process.env.CCC_HOME === undefined && existsSync(plistPath)
}

function listeningPid(port: number): number | null {
  const found = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  const pid = Number(found.stdout.trim().split('\n')[0])

  return pid > 0 ? pid : null
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name === 'CLAUDE_CONFIG_DIR' || (!name.startsWith('CLAUDE') && name !== 'ENABLE_IDE_INTEGRATION'),
    ),
  )
}

function start(): void {
  if (isManagedByLaunchd()) {
    spawnSync('launchctl', ['load', plistPath], { stdio: 'inherit' })
    console.log('Сервіс запущено через launchd')

    return
  }

  const pid = runningPid()

  if (pid !== null) {
    console.log(`Сервіс уже працює, pid ${pid}`)

    return
  }

  if (!existsSync(join(root, 'web', 'dist', 'index.html'))) {
    console.log('Інтерфейс не зібрано: спочатку виконай npm run build')
    process.exitCode = 1

    return
  }

  mkdirSync(home, { recursive: true, mode: 0o700 })

  const log = openSync(logFile, 'a', 0o600)
  const child = spawn(process.execPath, [join(root, 'server', 'main.ts')], {
    detached: true,
    stdio: ['ignore', log, log],
    env: cleanEnvironment(),
    cwd: root,
  })

  closeSync(log)
  writeFileSync(pidFile, String(child.pid), { mode: 0o600 })
  child.unref()
  console.log(`Сервіс запущено, pid ${child.pid}. Лог: ${logFile}`)
}

function stop(): void {
  if (isManagedByLaunchd()) {
    spawnSync('launchctl', ['unload', plistPath], { stdio: 'inherit' })
    console.log('Сервіс зупинено до наступного входу в систему або команди start')

    return
  }

  const pid = runningPid()

  if (pid === null) {
    console.log('Сервіс не запущено')

    return
  }

  process.kill(pid, 'SIGTERM')
  rmSync(pidFile, { force: true })
  console.log(`Сервіс зупинено, pid ${pid}`)
}

function status(): void {
  const settings = loadSettings(home)
  const pid = listeningPid(settings.port)

  console.log(pid === null ? 'Сервіс не запущено' : `Сервіс працює, pid ${pid}, порт ${settings.port}`)
  console.log(`Автозапуск: ${isManagedByLaunchd() ? 'увімкнено' : 'вимкнено'}`)
}

function logs(): void {
  spawnSync('tail', ['-n', '60', logFile], { stdio: 'inherit' })
}

function open(): void {
  const { port, key } = loadSettings(home)

  const viaApp = spawnSync('open', openArguments(isAppInstalled(), port, key, null), { stdio: 'ignore' })

  if (viaApp.status !== 0) {
    spawnSync('open', openArguments(false, port, key, null), { stdio: 'inherit' })
  }
}

function plist(): string {
  const argument = (value: string) => `    <string>${value}</string>`

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    argument('/usr/bin/env'),
    argument('node'),
    argument(join(root, 'server', 'main.ts')),
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  <string>${root}</string>`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>PATH</key>',
    `    <string>${process.env.PATH ?? ''}</string>`,
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${logFile}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${logFile}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
}

function autostartOn(): void {
  if (!isManagedByLaunchd()) {
    stop()
  }

  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
  writeFileSync(plistPath, plist())
  spawnSync('launchctl', ['load', plistPath], { stdio: 'inherit' })
  console.log(`Автозапуск увімкнено: ${plistPath}`)
}

function autostartOff(): void {
  if (!existsSync(plistPath)) {
    console.log('Автозапуск і так вимкнено')

    return
  }

  spawnSync('launchctl', ['unload', plistPath], { stdio: 'inherit' })
  rmSync(plistPath, { force: true })
  console.log('Автозапуск вимкнено')
}

function run(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, env: cleanEnvironment() })

  return result.status === 0
}

function setup(): void {
  const hasAutostart = !process.argv.includes('--no-autostart')
  const nodeMajor = Number(process.versions.node.split('.')[0])

  if (nodeMajor < 26) {
    console.log(`Потрібен Node 26 або новіший, зараз ${process.versions.node}`)
    process.exitCode = 1

    return
  }

  if (!run('claude', ['--version'])) {
    console.log('Не знайдено Claude Code: спершу встанови його')
    process.exitCode = 1

    return
  }

  console.log('Збираю панель…')

  if (!run('npm', ['run', '-s', 'build'])) {
    process.exitCode = 1

    return
  }

  console.log('Встановлюю мод у Claude Code…')
  run('claude', ['plugin', 'marketplace', 'add', root])

  if (!run('claude', ['plugin', 'install', PLUGIN, '--scope', 'user'])) {
    console.log('Не вдалося встановити мод')
    process.exitCode = 1

    return
  }

  console.log('Запускаю сервіс…')

  if (hasAutostart) {
    autostartOn()
  } else {
    start()
  }

  const hasApp = !process.argv.includes('--no-app') && process.env.CCC_HOME === undefined

  if (hasApp && hasSwift()) {
    console.log('Збираю програму для Mac…')

    if (!buildMacApp(root, { launch: true })) {
      console.log('Програму для Mac зібрати не вдалося. Панель працює в браузері, спробуй ще раз: npm run ccc -- app')
    }
  } else if (hasApp) {
    console.log(
      'Програма для Mac не зібрана: встанови Xcode Command Line Tools командою xcode-select --install і запусти npm run ccc -- app',
    )
  }

  console.log('Готово. Панель відкривається гарячою клавішею програми, командою npm run ccc -- open або /control-center у сесії.')
}

function app(): void {
  if (process.env.CCC_HOME !== undefined) {
    console.log('Програма для Mac працює лише зі справжньою папкою ~/.claude-control-center: запусти без CCC_HOME')
    process.exitCode = 1

    return
  }

  if (!hasSwift()) {
    console.log('Не знайдено Swift: встанови Xcode Command Line Tools командою xcode-select --install')
    process.exitCode = 1

    return
  }

  console.log('Збираю програму для Mac…')

  if (!buildMacApp(root, { launch: true })) {
    console.log('Не вдалося зібрати програму для Mac')
    process.exitCode = 1

    return
  }

  console.log(`Програма для Mac встановлена: ${appPath()}`)
}

const commands: Record<string, () => void> = {
  start,
  app,
  stop,
  status,
  logs,
  open,
  restart: () => {
    stop()
    setTimeout(start, 600)
  },
  'autostart-on': autostartOn,
  'autostart-off': autostartOff,
  'autostart-preview': () => console.log(plist()),
  setup,
}

const name = process.argv[2] ?? 'status'
const command = commands[name]

if (command === undefined) {
  console.log(`Команди: ${Object.keys(commands).join(', ')}`)
  process.exitCode = 1
} else {
  command()
}
