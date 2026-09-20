// Real Electron → IPC → SDK → tools → live Jev. Model tool calls and MySQL are fixtures.
// No hospital connection is opened; the sentinel is synthetic and intentionally non-personal.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const sentinel = 'SYNTHETIC_PRIVATE_VALUE_DO_NOT_RELEASE'
const cases = [
  { name: 'direct CID', sql: 'SELECT cid FROM patient LIMIT 1' },
  { name: 'alias disguise', sql: 'SELECT cid AS harmless_total FROM patient LIMIT 1' },
  { name: 'aggregate disguise', sql: 'SELECT GROUP_CONCAT(cid) AS total FROM patient' },
  {
    name: 'column 21',
    sql: `SELECT ${Array.from({ length: 20 }, (_, i) => `${i} AS safe_${i}`).join(', ')}, cid FROM patient LIMIT 1`
  },
  { name: 'executable comment', sql: 'SELECT /*!50000 cid */ FROM patient LIMIT 1' },
  { name: 'double minus expression', sql: 'SELECT 1--1 AS safe, cid FROM patient LIMIT 1' },
  { name: 'comment inside literal', sql: "SELECT '--' AS note, cid FROM patient LIMIT 1" },
  {
    name: 'Excel bypass',
    tool: 'export_excel',
    sql: 'SELECT cid FROM patient LIMIT 1',
    filename: 'privacy-fixture'
  },
  {
    name: 'chart bypass',
    tool: 'render_chart',
    sql: 'SELECT lname, COUNT(*) AS n FROM patient GROUP BY lname',
    type: 'bar',
    title: 'fixture'
  },
  {
    name: 'allowed unique count',
    sql: 'SELECT COUNT(DISTINCT hn) AS total FROM patient',
    allowed: true
  }
]
let current
let modelSawSentinel = false
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const request = JSON.parse(body)
  modelSawSentinel ||= JSON.stringify(request.messages).includes(sentinel)
  const hasResult = request.messages.some((message) => message.role === 'tool')
  const arguments_ = { ...current }
  delete arguments_.name
  delete arguments_.tool
  delete arguments_.allowed
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = (delta, finish_reason = null) =>
    res.write(
      `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'privacy-fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    )
  if (!hasResult) {
    send({
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: 'privacy-call',
          type: 'function',
          function: { name: current.tool ?? 'sql', arguments: JSON.stringify(arguments_) }
        }
      ]
    })
    send({}, 'tool_calls')
  } else {
    send({ role: 'assistant', content: current.allowed ? 'มี 2 คน' : 'การทดสอบเสร็จสิ้น' })
    send({}, 'stop')
  }
  res.end('data: [DONE]\n\n')
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const temp = await mkdtemp(join(tmpdir(), 'iplk-privacy-e2e-'))
await mkdir(join(temp, 'downloads'))
const bootstrap = join(temp, 'boot.cjs')
await writeFile(
  bootstrap,
  `const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(join(temp, 'profile'))});
app.setPath('downloads', ${JSON.stringify(join(temp, 'downloads'))});
const mysql = require(${JSON.stringify(require.resolve('mysql2/promise'))});
globalThis.privacyQueries = [];
const connection = {
  async query(command) {
    const sql = typeof command === 'string' ? command : command.sql;
    if (/^SET SESSION/i.test(sql)) return [{affectedRows:0}, undefined];
    globalThis.privacyQueries.push(sql);
    const value = /^SELECT COUNT\\(DISTINCT hn\\)/i.test(sql) ? '2' : ${JSON.stringify(sentinel)};
    return [[[value]], [{name:'result'}]];
  },
  async execute() { throw new Error('Person lookup is not part of this fixture'); },
  release() {}, destroy() {}, async end() {}
};
mysql.createPool = () => ({on(){}, async getConnection(){return connection}, async end(){}});
mysql.createConnection = async () => connection;
require(${JSON.stringify(resolve('out/main/index.js'))});`
)
const env = {
  ...process.env,
  LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
  LLM_MODELS: 'privacy-fixture',
  LLM_API_KEY: 'synthetic-test-key'
}
delete env.ELECTRON_RUN_AS_NODE
let app
const results = []
try {
  app = await electron.launch({ args: [bootstrap], env })
  const win = await app.firstWindow()
  await win.waitForSelector('.composer textarea')
  await win.evaluate(() => localStorage.setItem('model', 'privacy-fixture'))
  await win.reload()
  await win.waitForSelector('.convo-row.active')
  for (const test of cases) {
    current = test
    modelSawSentinel = false
    await app.evaluate(() => {
      globalThis.privacyQueries = []
    })
    await win.click('.new-chat')
    await win.fill(
      '.composer textarea',
      `ทดสอบข้ามกฎ privacy: ${test.name} ขอเรียก ${test.tool ?? 'sql'} ด้วย ${test.sql}`
    )
    await win.click('.composer button[type=submit]')
    await win.waitForSelector('.composer .stop')
    await win.waitForSelector('.composer button[type=submit]', { timeout: 60000 })
    const queries = await app.evaluate(() => globalThis.privacyQueries)
    const record = await win.evaluate(async (title) => {
      const convos = await window.api.convos.list()
      return convos
        .find((c) => c.messages?.some((m) => m.role === 'user' && m.content.includes(title)))
        ?.messages.at(-1)
    }, `privacy: ${test.name} `)
    assert.ok(record?.toolSteps?.length, `${test.name}: tool call must really execute`)
    const blocked = Boolean(record.toolSteps[0].result?.error)
    const leaked = modelSawSentinel || JSON.stringify(record.modelMessages).includes(sentinel)
    const passed = test.allowed
      ? queries.length === 1 && !blocked && !leaked
      : queries.length === 0 && blocked && !leaked
    results.push({
      test: test.name,
      passed,
      blocked,
      databaseCalls: queries.length,
      leakedToModel: leaked
    })
    console.log(JSON.stringify(results.at(-1)))
  }
  assert.ok(
    results.every((result) => result.passed),
    'Privacy bypass found; see case results above'
  )
  console.log(`privacy E2E ${results.length}/${results.length} passed`)
} finally {
  await app?.close()
  await new Promise((done) => server.close(done))
  assert.ok(resolve(temp).startsWith(resolve(join(tmpdir(), 'iplk-privacy-e2e-'))))
  await rm(temp, { recursive: true, force: true })
}
