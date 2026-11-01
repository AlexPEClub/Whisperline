// User settings persisted as JSON; API keys are encrypted with the OS keychain.
const fs = require('node:fs')
const path = require('node:path')
const { app, safeStorage } = require('electron')

const SECRET_KEYS = ['openaiKey', 'anthropicKey']

const DEFAULTS = {
  triggerKey: 'fn', // fn | leftOption | rightOption | rightCommand | rightControl
  openaiKey: '',
  anthropicKey: '',
  transcriptionModel: 'gpt-4o-transcribe',
  cleanupEnabled: true,
  cleanupModel: 'claude-opus-5-5',
  style: 'casual', // formal | casual | very-casual
  language: '', // empty = auto-detect
  micDeviceId: '',
  sounds: true,
  restoreClipboard: true,
}

class Settings {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json')
    this.values = { ...DEFAULTS, ...this.#read() }
  }

  get(key) {
    return this.values[key]
  }

  all() {
    return { ...this.values }
  }

  // Values with keys masked, for the renderer.
  forRenderer() {
    const copy = this.all()
    for (const key of SECRET_KEYS) copy[key] = copy[key] ? '••••' + copy[key].slice(-4) : ''
    return copy
  }

  update(patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULTS)) continue
      if (SECRET_KEYS.includes(key) && typeof value === 'string' && value.startsWith('••••')) continue
      this.values[key] = value
    }
    this.#write()
    return this.forRenderer()
  }

  #read() {
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      return {}
    }
    // A key that cannot be decrypted (e.g. encrypted under the app's former name) is dropped on its
    // own, so the remaining settings survive and the user only has to enter that key again.
    for (const key of SECRET_KEYS) {
      if (!raw[key] || !safeStorage.isEncryptionAvailable()) continue
      try {
        raw[key] = safeStorage.decryptString(Buffer.from(raw[key], 'base64'))
      } catch {
        delete raw[key]
      }
    }
    return raw
  }

  #write() {
    const out = { ...this.values }
    for (const key of SECRET_KEYS) {
      if (out[key] && safeStorage.isEncryptionAvailable()) {
        out[key] = safeStorage.encryptString(out[key]).toString('base64')
      }
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(out, null, 2))
  }
}

module.exports = { Settings, DEFAULTS }
