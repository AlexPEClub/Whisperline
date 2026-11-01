// Dictation trigger state machine.
//
//   hold trigger key  -> push-to-talk: recording stops when the key is released
//   tap trigger key   -> hands-free lock: recording continues until the next press
//   Escape            -> cancel the current recording
//
// Emits: start, lock, stop, cancel. The owner calls done() once a stopped
// recording has been processed so the next dictation can begin.
const { EventEmitter } = require('node:events')

class HotkeyController extends EventEmitter {
  constructor({ holdThresholdMs = 300, now = Date.now } = {}) {
    super()
    this.holdThresholdMs = holdThresholdMs
    this.now = now
    this.state = 'idle' // idle | pressing | handsfree | processing
    this.pressedAt = 0
    this.keyIsDown = false
  }

  keyDown() {
    if (this.keyIsDown) return
    this.keyIsDown = true
    if (this.state === 'idle') {
      this.state = 'pressing'
      this.pressedAt = this.now()
      this.emit('start')
    } else if (this.state === 'handsfree') {
      this.#stop()
    }
  }

  keyUp() {
    if (!this.keyIsDown) return
    this.keyIsDown = false
    if (this.state !== 'pressing') return
    if (this.now() - this.pressedAt < this.holdThresholdMs) {
      this.state = 'handsfree'
      this.emit('lock')
    } else {
      this.#stop()
    }
  }

  // Starts a hands-free dictation from the UI (tray, deeplink).
  startHandsFree() {
    if (this.state !== 'idle') return
    this.state = 'handsfree'
    this.emit('start')
    this.emit('lock')
  }

  toggleHandsFree() {
    if (this.state === 'idle') this.startHandsFree()
    else if (this.state === 'handsfree') this.#stop()
  }

  cancel() {
    if (this.state !== 'pressing' && this.state !== 'handsfree') return
    this.state = 'idle'
    this.emit('cancel')
  }

  done() {
    if (this.state === 'processing') this.state = 'idle'
  }

  #stop() {
    this.state = 'processing'
    this.emit('stop')
  }
}

module.exports = { HotkeyController }
