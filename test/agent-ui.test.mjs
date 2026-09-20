// Offline Electron integration: real renderer/preload/turn owner, deterministic runner.
// Run after npm run build. User history, hospital data and model credentials are not used.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron as electron } from 'playwright-core'

const temp = await mkdtemp(join(tmpdir(), 'iplk-agent-ui-'))
const bootstrap = join(temp, 'boot.cjs')
await writeFile(
  bootstrap,
  `const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(join(temp, 'profile'))});
globalThis.testModules = Promise.all([import(${JSON.stringify(pathToFileURL(resolve('src/main/agent-turn.mjs')).href)}), import(${JSON.stringify(pathToFileURL(resolve('src/main/tool-run.mjs')).href)})]);
require(${JSON.stringify(resolve('out/main/index.js'))});`
)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ args: [bootstrap], cwd: temp, env })
  const win = await app.firstWindow()
  await win.waitForSelector('.composer textarea')
  await app.evaluate(
    async ({ ipcMain }) => {
      const [{ createAgentTurns }, { collectToolRun }] = await globalThis.testModules
      const turns = createAgentTurns({
        buildSystem: async () => 'offline prompt',
        run: (_messages, options) =>
          collectToolRun(
            async () => ({
              fullStream: (async function* () {
                yield { type: 'text-delta', text: 'Partial fixture answer' }
                yield {
                  type: 'tool-call',
                  toolCallId: 'done',
                  toolName: 'sql',
                  input: { sql: 'SELECT fixture' }
                }
                yield {
                  type: 'tool-result',
                  toolCallId: 'done',
                  output: { columns: ['count'], rows: [['7']], rowCount: 1 }
                }
                yield {
                  type: 'tool-call',
                  toolCallId: 'pending',
                  toolName: 'sql',
                  input: { sql: 'SELECT pending' }
                }
                if (!options.signal.aborted)
                  await new Promise((done) =>
                    options.signal.addEventListener('abort', done, { once: true })
                  )
                yield { type: 'abort' }
              })(),
              text: '',
              responseMessages: []
            }),
            options
          ),
        enrich: async (answer) => answer
      })
      ipcMain.removeHandler('agent:send')
      ipcMain.removeHandler('agent:stop')
      ipcMain.handle('agent:send', (event, request) =>
        turns.send(request, (type, payload) => event.sender.send(`agent:${type}`, payload))
      )
      ipcMain.handle('agent:stop', (_event, id) => turns.stop(id))
    },
    {
      turnsUrl: pathToFileURL(resolve('src/main/agent-turn.mjs')).href,
      runUrl: pathToFileURL(resolve('src/main/tool-run.mjs')).href
    }
  )
  await win.waitForSelector('.convo-row.active')
  await win.fill('.composer textarea', 'Original conversation')
  await win.click('.composer button[type=submit]')
  await win.getByText('Partial fixture answer', { exact: true }).waitFor()
  await win.click('.new-chat')
  await win.waitForFunction(() => document.querySelectorAll('.convo-row').length === 2)
  assert.equal(
    await win.locator('.msg').count(),
    0,
    'Progress must not appear in the new conversation'
  )
  assert.equal(await win.locator('.composer .stop').isDisabled(), true)
  // Simulate a late push from an unrelated turn through the real Electron transport.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('agent:delta', {
      turnId: 'stale',
      conversationId: 'stale',
      value: 'WRONG TURN'
    })
  })
  await win.getByRole('button', { name: 'Original conversation', exact: true }).click()
  await win.getByText('Partial fixture answer', { exact: true }).waitFor()
  assert.ok(!(await win.locator('body').innerText()).includes('WRONG TURN'))
  await win.click('.composer .stop')
  await win.waitForSelector('.composer button[type=submit]')
  const assistant = await win.locator('.msg.assistant').last().innerText()
  assert.match(assistant, /หยุดแล้ว/)
  assert.match(assistant, /Partial fixture answer/)
  assert.equal(await win.locator('.result td').first().innerText(), '7')
  const saved = await win.evaluate(() => window.api.convos.list())
  const original = saved.find((convo) => convo.title === 'Original conversation')
  assert.equal(original.messages.at(-1).status, 'stopped')
  assert.equal(original.messages.at(-1).toolSteps.length, 1)
  assert.ok(!JSON.stringify(original.messages.at(-1).modelMessages).includes('pending'))
  console.log(
    'agent UI ok: conversation ownership, stale events, stop, completed result, persisted replay'
  )
} finally {
  await app?.close()
  assert.ok(resolve(temp).startsWith(resolve(join(tmpdir(), 'iplk-agent-ui-'))))
  await rm(temp, { recursive: true, force: true })
}
