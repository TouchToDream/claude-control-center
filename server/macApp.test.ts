import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BUNDLE_ID, infoPlist, openArguments } from './macApp.ts'

test('the plist names the app, hides it from the Dock and claims the ccc scheme', () => {
  const plist = infoPlist('/r', '0.1.0')

  assert.equal(BUNDLE_ID, 'io.github.touchtodream.claude-control-center')
  assert.match(plist, /<key>CFBundleIdentifier<\/key>\s*<string>io\.github\.touchtodream\.claude-control-center<\/string>/)
  assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>ClaudeControlCenter<\/string>/)
  assert.match(plist, /<key>CFBundleName<\/key>\s*<string>Claude Control Center<\/string>/)
  assert.match(plist, /<key>LSUIElement<\/key>\s*<true\/>/)
  assert.match(plist, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>ccc<\/string>\s*<\/array>/)
  assert.match(plist, /<key>LSMinimumSystemVersion<\/key>\s*<string>14\.0<\/string>/)
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>0\.1\.0<\/string>/)
  assert.match(plist, /<key>CCCRepoPath<\/key>\s*<string>\/r<\/string>/)
})

test('a repo path with special characters is escaped', () => {
  assert.match(infoPlist('/a&b<c', '0.1.0'), /<string>\/a&amp;b&lt;c<\/string>/)
})

test('the app is opened by its scheme when installed, the browser otherwise', () => {
  assert.deepEqual(openArguments(true, 47821, 'k', 's1'), ['-g', 'ccc://session/s1'])
  assert.deepEqual(openArguments(true, 47821, 'k', null), ['-g', 'ccc://open'])
  assert.deepEqual(openArguments(false, 47821, 'k', 's1'), ['http://127.0.0.1:47821/?key=k#s1'])
  assert.deepEqual(openArguments(false, 47821, 'k', null), ['http://127.0.0.1:47821/?key=k'])
})
