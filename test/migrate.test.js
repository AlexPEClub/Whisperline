const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { carryOverUserData } = require('../src/main/migrate')

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flow-migrate-'))
}

test('user data is copied from the former folder and the original stays intact', () => {
  const from = tempDir()
  const to = path.join(tempDir(), 'Whisperline')
  fs.writeFileSync(path.join(from, 'settings.json'), '{"language":"de"}')
  fs.writeFileSync(path.join(from, 'flow.sqlite'), 'db')
  fs.mkdirSync(path.join(from, 'recordings'))
  fs.writeFileSync(path.join(from, 'recordings', 'a.webm'), 'audio')
  fs.writeFileSync(path.join(from, 'Cookies'), 'browser state')

  assert.deepEqual(carryOverUserData(from, to), ['settings.json', 'flow.sqlite', 'recordings'])
  assert.equal(fs.readFileSync(path.join(to, 'settings.json'), 'utf8'), '{"language":"de"}')
  assert.equal(fs.readFileSync(path.join(to, 'recordings', 'a.webm'), 'utf8'), 'audio')
  assert.equal(fs.existsSync(path.join(to, 'Cookies')), false)
  assert.equal(fs.existsSync(path.join(from, 'settings.json')), true)
})

test('existing data in the new folder is never overwritten', () => {
  const from = tempDir()
  const to = tempDir()
  fs.writeFileSync(path.join(from, 'settings.json'), 'old')
  fs.writeFileSync(path.join(to, 'settings.json'), 'new')
  assert.deepEqual(carryOverUserData(from, to), [])
  assert.equal(fs.readFileSync(path.join(to, 'settings.json'), 'utf8'), 'new')
})

test('nothing happens without a former folder', () => {
  assert.deepEqual(carryOverUserData(path.join(tempDir(), 'missing'), tempDir()), [])
})
