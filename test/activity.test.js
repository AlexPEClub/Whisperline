const test = require('node:test')
const assert = require('node:assert/strict')
const { Store } = require('../src/main/store')

test('daily words group pasted dictations by local day', () => {
  const store = new Store(':memory:')
  const at = (y, m, d, h) => new Date(y, m, d, h).getTime()
  const add = (timestamp, text, status = 'pasted') => {
    const id = store.addHistory({ asrText: text, durationMs: 1_000, status })
    store.db.prepare(`UPDATE history SET timestamp = ? WHERE id = ?`).run(timestamp, id)
  }
  add(at(2026, 9, 5, 9), 'eins zwei drei')
  add(at(2026, 9, 5, 23), 'vier fünf')
  add(at(2026, 9, 6, 0), 'sechs')
  add(at(2026, 9, 6, 8), 'nicht gezählt', 'error')
  add(at(2026, 8, 1, 12), 'zu alt')

  assert.deepEqual(
    store.dailyWords(at(2026, 9, 1, 0)).map(({ day, words }) => ({ day, words })),
    [
      { day: '2026-10-05', words: 5 },
      { day: '2026-10-06', words: 1 },
    ],
  )
})
