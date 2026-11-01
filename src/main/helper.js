// Spawns the native helper and exposes its JSON-lines protocol.
const { spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const readline = require('node:readline')
const { app } = require('electron')

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'flow-helper')
    : path.join(__dirname, '..', '..', 'build', 'flow-helper')
}

class Helper extends EventEmitter {
  constructor() {
    super()
    this.nextId = 1
    this.pending = new Map()
    this.child = null
    this.stopped = false
  }

  start() {
    this.child = spawn(helperPath(), [], { stdio: ['pipe', 'pipe', 'inherit'] })
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => this.#onLine(line))
    this.child.on('error', (err) => this.emit('error', err))
    this.child.on('exit', (code) => {
      for (const { reject } of this.pending.values()) reject(new Error('helper exited'))
      this.pending.clear()
      if (this.stopped) return
      console.error(`[helper] exited with ${code}, restarting`)
      setTimeout(() => this.start(), 1000)
    })
  }

  stop() {
    this.stopped = true
    this.child?.kill()
  }

  request(cmd, timeoutMs = 3000) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`helper ${cmd} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      })
      this.child.stdin.write(JSON.stringify({ id, cmd }) + '\n')
    })
  }

  #onLine(line) {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.type === 'reply') {
      this.pending.get(msg.id)?.resolve(msg)
      this.pending.delete(msg.id)
    } else {
      this.emit(msg.type, msg)
    }
  }
}

module.exports = { Helper }
