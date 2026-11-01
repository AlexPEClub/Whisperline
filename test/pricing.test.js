const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { transcriptionCost, cleanupCost } = require('../src/main/pricing')
const { Store } = require('../src/main/store')

test('transcription is priced per minute of audio', () => {
  assert.equal(transcriptionCost('gpt-4o-transcribe', 30_000), 0.003)
  assert.equal(transcriptionCost('gpt-4o-mini-transcribe', 120_000), 0.006)
  assert.equal(transcriptionCost('unknown-model', 60_000), 0)
})

test('cleanup is priced from token usage, including cache reads and writes', () => {
  const cost = cleanupCost('claude-opus-5-5', {
    input_tokens: 1_000,
    output_tokens: 500,
    cache_read_input_tokens: 10_000,
    cache_creation_input_tokens: 2_000,
  })
  // (1000 + 10000 * 0.1 + 2000 * 1.25) * $4/M + 500 * $20/M
  assert.ok(Math.abs(cost - 0.028) < 1e-12)
  assert.equal(cleanupCost('unknown-model', { input_tokens: 1_000, output_tokens: 1_000 }), 0)
})

test('stats sum costs for the month and overall, including failed dictations', () => {
  const store = new Store(':memory:')
  store.addHistory({ asrText: 'a', durationMs: 1_000, costUsd: 0.01, status: 'pasted' })
  store.addHistory({ asrText: '', durationMs: 1_000, costUsd: 0.002, status: 'empty' })
  store.db.prepare(`UPDATE history SET timestamp = ? WHERE status = 'empty'`).run(new Date(2020, 0, 15).getTime())
  const stats = store.stats()
  assert.ok(Math.abs(stats.costUsd - 0.012) < 1e-12)
  assert.ok(Math.abs(stats.monthCostUsd - 0.01) < 1e-12)
})

test('databases from before cost tracking are estimated at the default transcription price', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flow-store-')), 'flow.sqlite')
  const legacy = new DatabaseSync(file)
  legacy.exec(`CREATE TABLE history (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, asrText TEXT,
    formattedText TEXT, app TEXT, durationMs INTEGER, numWords INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL, error TEXT)`)
  legacy.prepare(`INSERT INTO history VALUES ('1', 1, 'hallo', NULL, NULL, 60000, 1, 'pasted', NULL)`).run()
  legacy.prepare(`INSERT INTO history VALUES ('2', 2, NULL, NULL, NULL, 60000, 0, 'error', 'offline')`).run()
  legacy.close()

  const store = new Store(file)
  assert.equal(store.stats().costUsd, 0.006)
})
