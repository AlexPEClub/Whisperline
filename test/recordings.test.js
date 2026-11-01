const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { saveRecording, recordingName } = require('../src/main/recordings')

test('recording names sort chronologically and keep the container format', () => {
  assert.equal(recordingName(new Date('2026-10-26T09:14:03.512Z'), 'audio/webm;codecs=opus'), '2026-10-26T09-14-03-512.webm')
  assert.equal(recordingName(new Date('2026-10-26T09:14:03.512Z'), 'audio/mp4'), '2026-10-26T09-14-03-512.mp4')
})

test('only the newest recordings are kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-recordings-'))
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'unrelated')
  for (let i = 0; i < 5; i++) {
    saveRecording(dir, Buffer.from([i]), 'audio/webm', { date: new Date(Date.UTC(2026, 9, 26, 9, 0, i)), keep: 3 })
  }
  assert.deepEqual(fs.readdirSync(dir).sort(), [
    '2026-10-26T09-00-02-000.webm',
    '2026-10-26T09-00-03-000.webm',
    '2026-10-26T09-00-04-000.webm',
    'notes.txt',
  ])
  assert.deepEqual(fs.readFileSync(path.join(dir, '2026-10-26T09-00-04-000.webm')), Buffer.from([4]))
})
