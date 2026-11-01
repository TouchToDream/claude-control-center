import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { createKeychain } from './secrets.ts'
import { homeDirectory, loadSettings } from './settings.ts'
import { Store } from './store.ts'

const home = homeDirectory()
const settings = loadSettings(home)
const store = new Store(join(home, 'data.sqlite'))
const webRoot = resolve(fileURLToPath(new URL('../web/dist', import.meta.url)))
const app = createApp({ store, settings, webRoot, secrets: createKeychain(home) })

store.prune(Date.now())

const port = await app.listen()

console.log(`Центр керування слухає http://127.0.0.1:${port}`)

const stop = async () => {
  await app.close()
  store.close()
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
