import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const APP_NAME = 'Claude Control Center'
export const BUNDLE_ID = 'io.github.touchtodream.claude-control-center'
export const EXECUTABLE = 'ClaudeControlCenter'

const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

export function appPath(): string {
  return join(homedir(), 'Applications', `${APP_NAME}.app`)
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function infoPlist(repoRoot: string, version: string): string {
  const entry = (key: string, value: string) => `  <key>${key}</key>\n  <string>${escapeXml(value)}</string>`

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    entry('CFBundleIdentifier', BUNDLE_ID),
    entry('CFBundleExecutable', EXECUTABLE),
    entry('CFBundleName', APP_NAME),
    entry('CFBundleDisplayName', APP_NAME),
    entry('CFBundlePackageType', 'APPL'),
    entry('CFBundleShortVersionString', version),
    entry('CFBundleVersion', version),
    entry('LSMinimumSystemVersion', '14.0'),
    '  <key>LSUIElement</key>',
    '  <true/>',
    '  <key>CFBundleURLTypes</key>',
    '  <array>',
    '    <dict>',
    '      <key>CFBundleURLName</key>',
    `      <string>${BUNDLE_ID}</string>`,
    '      <key>CFBundleURLSchemes</key>',
    '      <array>',
    '        <string>ccc</string>',
    '      </array>',
    '    </dict>',
    '  </array>',
    entry('CCCRepoPath', repoRoot),
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
}

export function isAppInstalled(): boolean {
  return existsSync(appPath())
}

export function openArguments(isInstalled: boolean, port: number, key: string, sessionId: string | null): string[] {
  if (isInstalled) {
    return ['-g', sessionId === null ? 'ccc://open' : `ccc://session/${encodeURIComponent(sessionId)}`]
  }

  return [`http://127.0.0.1:${port}/?key=${key}${sessionId === null ? '' : `#${sessionId}`}`]
}

export function hasSwift(): boolean {
  return spawnSync('swift', ['--version'], { stdio: 'ignore' }).status === 0
}

export function buildMacApp(root: string, options: { launch: boolean }): boolean {
  const packagePath = join(root, 'mac')
  const swift = (...args: string[]) =>
    spawnSync('swift', ['build', '-c', 'release', '--package-path', packagePath, ...args], {
      encoding: 'utf8',
      stdio: args.length === 0 ? 'inherit' : 'pipe',
    })

  if (swift().status !== 0) {
    return false
  }

  const binary = join(swift('--show-bin-path').stdout.trim(), EXECUTABLE)
  const app = appPath()
  const contents = join(app, 'Contents')
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }

  rmSync(app, { recursive: true, force: true })
  mkdirSync(join(contents, 'MacOS'), { recursive: true })
  copyFileSync(binary, join(contents, 'MacOS', EXECUTABLE))
  writeFileSync(join(contents, 'Info.plist'), infoPlist(root, version))

  const signed = spawnSync('codesign', ['--force', '--sign', '-', '--identifier', BUNDLE_ID, app], { stdio: 'inherit' })

  if (signed.status !== 0) {
    return false
  }

  spawnSync(LSREGISTER, ['-f', app], { stdio: 'ignore' })

  if (options.launch) {
    spawnSync('pkill', ['-x', EXECUTABLE], { stdio: 'ignore' })
    spawnSync('sleep', ['0.5'])

    return spawnSync('open', [app], { stdio: 'inherit' }).status === 0
  }

  return true
}
