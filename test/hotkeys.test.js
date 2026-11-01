const test = require('node:test')
const assert = require('node:assert/strict')
const { HotkeyController } = require('../src/main/hotkeys')

function setup() {
  let t = 0
  const c = new HotkeyController({ holdThresholdMs: 300, now: () => t })
  const events = []
  for (const name of ['start', 'lock', 'stop', 'cancel']) c.on(name, () => events.push(name))
  return { c, events, advance: (ms) => (t += ms) }
}

test('holding the key is push-to-talk', () => {
  const { c, events, advance } = setup()
  c.keyDown()
  advance(1200)
  c.keyUp()
  assert.deepEqual(events, ['start', 'stop'])
  assert.equal(c.state, 'processing')
})

test('a short tap locks hands-free until the next press', () => {
  const { c, events, advance } = setup()
  c.keyDown()
  advance(120)
  c.keyUp()
  assert.deepEqual(events, ['start', 'lock'])
  advance(5000)
  c.keyDown()
  assert.deepEqual(events, ['start', 'lock', 'stop'])
  c.keyUp()
  assert.equal(c.state, 'processing')
})

test('escape cancels and returns to idle', () => {
  const { c, events } = setup()
  c.keyDown()
  c.cancel()
  c.keyUp()
  assert.deepEqual(events, ['start', 'cancel'])
  assert.equal(c.state, 'idle')
})

test('presses are ignored while processing until done()', () => {
  const { c, events, advance } = setup()
  c.keyDown()
  advance(500)
  c.keyUp()
  c.keyDown()
  c.keyUp()
  assert.deepEqual(events, ['start', 'stop'])
  c.done()
  c.keyDown()
  assert.deepEqual(events, ['start', 'stop', 'start'])
})

test('repeated key-down without key-up is ignored', () => {
  const { c, events } = setup()
  c.keyDown()
  c.keyDown()
  assert.deepEqual(events, ['start'])
})

test('toggleHandsFree starts and stops from the UI', () => {
  const { c, events } = setup()
  c.toggleHandsFree()
  c.toggleHandsFree()
  assert.deepEqual(events, ['start', 'lock', 'stop'])
})
