const fs = require('node:fs')
const path = require('node:path')
const {
  app,
  BrowserWindow,
  ClipboardItem,
  Menu,
  Tray,
  clipboard,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
  systemPreferences,
} = require('electron')
const { Helper } = require('./helper')
const { HotkeyController } = require('./hotkeys')
const { Settings } = require('./settings')
const { Store } = require('./store')
const { transcribe, cleanup } = require('./pipeline')
const { applyReplacements } = require('./text')
const { transcriptionCost } = require('./pricing')
const { saveRecording } = require('./recordings')
const { carryOverUserData, LEGACY_NAME } = require('./migrate')

const OVERLAY_SIZE = { width: 200, height: 56 }
const MIN_RECORDING_MS = 350
const PROCESSING_TIMEOUT_MS = 60_000
// Loudest 50 ms RMS below this counts as silence. Speech on the built-in microphone peaks far
// above it; silent input (e.g. a revoked microphone grant) makes the transcriber invent text.
const SILENCE_PEAK_RMS = 0.005

let settings, store, helper, controller, tray
let overlay = null
let hub = null
let recording = null // { appName, startedAt }
let processingTimer = null

if (!app.requestSingleInstanceLock()) {
  fs.appendFileSync(path.join(app.getPath('userData'), 'flow.log'), `${new Date().toISOString()} [app] another instance holds the lock, quitting\n`)
  app.quit()
}

// Must run before settings, history and the log file are opened.
const carriedOver = carryOverUserData(path.join(app.getPath('appData'), LEGACY_NAME), app.getPath('userData'))

let logStream = null
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(' ')}`
  console.log(line)
  logStream?.write(line + '\n')
}

function rendererPath(file) {
  return path.join(__dirname, '..', 'renderer', file)
}

function preloadPath(file) {
  return path.join(__dirname, '..', 'preload', file)
}

// ---------- Overlay (floating pill + recorder) ----------

function createOverlay() {
  overlay = new BrowserWindow({
    ...OVERLAY_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath('overlay.js'),
      backgroundThrottling: false,
    },
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlay.setIgnoreMouseEvents(true)
  overlay.loadFile(rendererPath('overlay.html'))
}

function showOverlay() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  overlay.setBounds({
    x: Math.round(x + (width - OVERLAY_SIZE.width) / 2),
    y: Math.round(y + height - OVERLAY_SIZE.height - 24),
    ...OVERLAY_SIZE,
  })
  overlay.showInactive()
}

function setOverlay(state, detail) {
  overlay.webContents.send('overlay:state', { state, detail })
  if (state === 'hidden') overlay.hide()
}

// ---------- Hub window ----------

function openHub() {
  if (hub) {
    hub.show()
    hub.focus()
    return
  }
  hub = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f7f5f0',
    webPreferences: { preload: preloadPath('hub.js') },
  })
  hub.loadFile(rendererPath('hub.html'))
  app.dock?.show()
  hub.on('closed', () => {
    hub = null
    app.dock?.hide()
  })
}

function notifyHub() {
  hub?.webContents.send('hub:changed')
}

// ---------- Dictation flow ----------

async function onStart() {
  recording = { appName: null, startedAt: Date.now() }
  helper
    .request('frontmostApp')
    .then((r) => recording && (recording.appName = r.name))
    .catch(() => {})
  showOverlay()
  setOverlay('recording', { mode: 'ptt' })
  overlay.webContents.send('recorder:start', {
    deviceId: settings.get('micDeviceId'),
    sounds: settings.get('sounds'),
  })
}

function onLock() {
  setOverlay('recording', { mode: 'handsfree' })
}

function onStop() {
  setOverlay('processing')
  overlay.webContents.send('recorder:stop')
  processingTimer = setTimeout(() => finish('error', 'Zeitüberschreitung'), PROCESSING_TIMEOUT_MS)
}

function onCancel() {
  overlay.webContents.send('recorder:cancel')
  recording = null
  setOverlay('hidden')
}

function finish(result, message) {
  if (result !== 'ok') log('[dictation]', result, message ?? '')
  clearTimeout(processingTimer)
  recording = null
  controller.done()
  if (result === 'error') {
    setOverlay('error', { message })
    setTimeout(() => controller.state === 'idle' && setOverlay('hidden'), 2500)
  } else {
    setOverlay('hidden')
  }
  notifyHub()
}

async function onRecording(_event, { audio, mimeType, durationMs, peakLevel }) {
  if (!recording) return
  const { appName } = recording
  if (durationMs < MIN_RECORDING_MS) return finish('discarded')

  try {
    const file = saveRecording(path.join(app.getPath('userData'), 'recordings'), Buffer.from(audio), mimeType)
    log('[recording]', path.basename(file), `${durationMs} ms`, `peak ${peakLevel?.toFixed(4) ?? 'unknown'}`)
  } catch (err) {
    log('[recording] could not save:', err.message)
  }
  if (peakLevel !== null && peakLevel !== undefined && peakLevel < SILENCE_PEAK_RMS) {
    store.addHistory({ app: appName, durationMs, costUsd: 0, status: 'silent' })
    return finish('error', 'Kein Ton – Mikrofon prüfen')
  }

  const values = settings.all()
  const dictionary = store.listDictionary()
  let asrText = null
  let formattedText = null
  // Estimated spend; a failed transcription request is not billed, so it stays at 0.
  let costUsd = 0
  try {
    asrText = await transcribe({ audio: Buffer.from(audio), mimeType, settings: values, dictionary })
    costUsd += transcriptionCost(values.transcriptionModel, durationMs)
    if (!asrText) {
      store.addHistory({ asrText, app: appName, durationMs, costUsd, status: 'empty' })
      return finish('error', 'Nichts verstanden')
    }
    try {
      const cleaned = await cleanup({ transcript: asrText, appName, settings: values, dictionary })
      formattedText = cleaned?.text ?? null
      costUsd += cleaned?.costUsd ?? 0
    } catch (err) {
      log('[cleanup] failed, pasting raw transcript:', err.message)
    }
    const { text, used } = applyReplacements(formattedText ?? asrText, dictionary)
    formattedText = text
    store.markDictionaryUsed(used)
    await paste(text)
    store.addHistory({ asrText, formattedText, app: appName, durationMs, costUsd, status: 'pasted' })
    finish('ok')
  } catch (err) {
    log('[dictation]', err.stack ?? err.message)
    store.addHistory({ asrText, formattedText, app: appName, durationMs, costUsd, status: 'error', error: err.message })
    finish('error', err.userMessage ?? 'Fehler beim Diktat')
  }
}

async function paste(text) {
  const previous = settings.get('restoreClipboard') ? await snapshotClipboard() : null
  await clipboard.writeText(text)
  const res = await helper.request('paste')
  if (!res.ok) {
    const err = new Error(res.error)
    err.userMessage = 'Bedienungshilfen-Zugriff fehlt – Text liegt in der Zwischenablage'
    throw err
  }
  if (previous) setTimeout(() => restoreClipboard(previous).catch((e) => log('[clipboard]', e.message)), 600)
}

// Electron 44's clipboard is async and item-based; payloads are read eagerly so
// they survive overwriting the clipboard with the dictated text.
async function snapshotClipboard() {
  try {
    const items = await clipboard.read()
    return await Promise.all(
      items.map(async (item) =>
        Object.fromEntries(await Promise.all(item.types.map(async (type) => [type, await item.getType(type)]))),
      ),
    )
  } catch (err) {
    log('[clipboard] snapshot failed:', err.message)
    return null
  }
}

async function restoreClipboard(snapshot) {
  if (snapshot.length === 0) return clipboard.clear()
  await clipboard.write(snapshot.map((data) => new ClipboardItem(data)))
}

async function pasteLast() {
  const text = store.lastText()
  if (text) await paste(text).catch((err) => log('[paste-last]', err.message))
}

// ---------- Tray ----------

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Whisperline')
  refreshTrayMenu()
}

async function refreshTrayMenu() {
  const perms = await helper.request('permissions').catch(() => ({}))
  const ready = perms.accessibility && perms.inputMonitoring && perms.keyTap
  const keyLabel = { fn: 'Fn', leftOption: 'linke ⌥', rightOption: 'rechte ⌥', rightCommand: 'rechte ⌘', rightControl: 'rechte ⌃' }[
    settings.get('triggerKey')
  ]
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: ready ? `Bereit – ${keyLabel} halten zum Diktieren` : 'Berechtigungen fehlen', enabled: !ready, click: openHub },
      { type: 'separator' },
      { label: 'Freihand-Diktat starten/stoppen', click: () => controller.toggleHandsFree() },
      { label: 'Letztes Transkript einfügen', click: pasteLast },
      { label: 'Whisperline öffnen…', click: openHub },
      { type: 'separator' },
      { label: 'Beenden', role: 'quit' },
    ]),
  )
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.on('recorder:result', onRecording)
  ipcMain.on('recorder:error', (_e, message) => {
    log('[recorder]', message)
    if (controller.state !== 'idle') {
      controller.cancel()
      controller.done()
      finish('error', 'Mikrofon nicht verfügbar')
    }
  })

  ipcMain.handle('settings:get', () => settings.forRenderer())
  ipcMain.handle('settings:update', (_e, patch) => {
    const result = settings.update(patch)
    refreshTrayMenu()
    return result
  })
  ipcMain.handle('history:list', (_e, opts) => store.listHistory(opts))
  ipcMain.handle('history:delete', (_e, id) => store.deleteHistory(id))
  ipcMain.handle('stats:get', () => store.stats())
  ipcMain.handle('activity:get', (_e, since) => store.dailyWords(since))
  ipcMain.handle('dictionary:list', () => store.listDictionary())
  ipcMain.handle('dictionary:add', (_e, { phrase, replacement }) => store.addDictionary(phrase, replacement))
  ipcMain.handle('dictionary:remove', (_e, phrase) => store.removeDictionary(phrase))
  ipcMain.handle('clipboard:copy', (_e, text) => clipboard.writeText(text))
  ipcMain.handle('permissions:get', async () => ({
    ...(await helper.request('permissions').catch(() => ({}))),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    openaiKey: Boolean(settings.get('openaiKey') || process.env.OPENAI_API_KEY),
  }))
  ipcMain.handle('permissions:request', async (_e, kind) => {
    if (kind === 'microphone') return systemPreferences.askForMediaAccess('microphone')
    if (kind === 'accessibility') return helper.request('requestAccessibility')
    if (kind === 'inputMonitoring') {
      await helper.request('requestInputMonitoring')
      return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent')
    }
  })
  ipcMain.handle('dictation:toggle', () => controller.toggleHandsFree())
}

// ---------- Startup ----------

app.whenReady().then(async () => {
  app.dock?.hide()
  logStream = fs.createWriteStream(path.join(app.getPath('userData'), 'flow.log'), { flags: 'a' })
  if (carriedOver.length) log(`[app] carried over from "${LEGACY_NAME}":`, carriedOver.join(', '))
  settings = new Settings()
  store = new Store(path.join(app.getPath('userData'), 'flow.sqlite'))

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  controller = new HotkeyController()
  controller.on('start', onStart)
  controller.on('lock', onLock)
  controller.on('stop', onStop)
  controller.on('cancel', onCancel)

  helper = new Helper()
  helper.on('modifier', ({ key, down }) => {
    log('[helper] modifier', key, down ? 'down' : 'up', `(trigger: ${settings.get('triggerKey')})`)
    if (key !== settings.get('triggerKey')) return
    if (down) controller.keyDown()
    else controller.keyUp()
  })
  helper.on('escape', () => controller.cancel())
  helper.on('ready', (msg) => log('[helper] ready', JSON.stringify(msg)))
  helper.on('permissions', (msg) => {
    log('[helper] permissions', JSON.stringify(msg))
    refreshTrayMenu()
    notifyHub()
  })
  helper.on('error', (err) => log('[helper] error', err.message))
  helper.start()

  registerIpc()
  createOverlay()
  createTray()

  if (systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
    await systemPreferences.askForMediaAccess('microphone')
  }
  const perms = await helper.request('permissions').catch(() => ({}))
  const hasKey = Boolean(settings.get('openaiKey') || process.env.OPENAI_API_KEY)
  if (!perms.accessibility || !perms.inputMonitoring || !perms.keyTap || !hasKey) openHub()
})

app.on('second-instance', openHub)
app.on('window-all-closed', () => {}) // stay in the menu bar
app.on('before-quit', () => {
  log('[app] quitting')
  helper?.stop()
})
