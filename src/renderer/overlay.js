// Floating pill UI and microphone recorder.
const BAR_COUNT = 11
const pill = document.getElementById('pill')
const barsEl = document.getElementById('bars')
const messageEl = document.getElementById('message')
const bars = Array.from({ length: BAR_COUNT }, () => barsEl.appendChild(document.createElement('i')))

let audioCtx = null
let session = null // { stream, recorder, chunks, startedAt, cancelled, stopRequested, rafId }

// ---------- UI ----------

window.flow.onState(({ state, detail }) => {
  pill.className = 'pill'
  if (state === 'hidden') return
  pill.classList.add('visible', state)
  if (state === 'recording' && detail?.mode === 'handsfree') pill.classList.add('handsfree')
  messageEl.textContent = state === 'error' ? detail?.message ?? 'Fehler' : ''
})

function renderLevels(current, analyser) {
  const data = new Uint8Array(analyser.fftSize)
  const history = new Array(BAR_COUNT).fill(0)
  const tick = () => {
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (const v of data) sum += ((v - 128) / 128) ** 2
    const rms = Math.min(1, Math.sqrt(sum / data.length) * 4)
    history.shift()
    history.push(rms)
    bars.forEach((bar, i) => {
      // Mirror around the centre so the newest level sits in the middle.
      const distance = Math.abs(i - (BAR_COUNT - 1) / 2)
      const level = history[BAR_COUNT - 1 - Math.round(distance * 2)] ?? 0
      bar.style.height = `${3 + level * 17}px`
    })
    if (current.stream?.active) current.rafId = requestAnimationFrame(tick)
  }
  tick()
}

// ---------- Sounds (synthesised) ----------

function chime(direction) {
  const ctx = getAudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const t = ctx.currentTime
  const [from, to] = direction === 'up' ? [520, 780] : [700, 440]
  osc.type = 'sine'
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + 0.09)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.12, t + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.15)
}

function getAudioContext() {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

// ---------- Recorder ----------

function pickMimeType() {
  for (const type of ['audio/webm;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

const MIC_TIMEOUT_MS = 5000

// getUserMedia can stay pending without ever settling. Fail fast instead, so the trigger key is not
// blocked until the main process gives up; a stream that still arrives late is closed right away.
function openMicrophone(constraints) {
  const request = navigator.mediaDevices.getUserMedia(constraints)
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`getUserMedia did not settle within ${MIC_TIMEOUT_MS} ms`)), MIC_TIMEOUT_MS),
  )
  return Promise.race([request, timeout]).catch((err) => {
    request.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => {})
    throw err
  })
}

window.flow.onRecorderStart(async ({ deviceId, sounds }) => {
  const current = { chunks: [], cancelled: false, stopRequested: false, sounds }
  session = current
  if (sounds) chime('up')
  try {
    const stream = await openMicrophone({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    current.stream = stream
    if (current.cancelled) return releaseStream(current)

    const ctx = getAudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    current.source = ctx.createMediaStreamSource(stream)
    current.source.connect(analyser)
    renderLevels(current, analyser)

    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    current.recorder = recorder
    recorder.ondataavailable = (e) => e.data.size && current.chunks.push(e.data)
    recorder.onstop = () => finishRecording(current)
    recorder.start(250)
    current.startedAt = performance.now()
    if (current.stopRequested) recorder.stop()
  } catch (err) {
    session = null
    window.flow.sendRecorderError(err.message)
  }
})

window.flow.onRecorderStop(() => {
  if (!session) return
  session.stopRequested = true
  if (session.sounds) chime('down')
  if (session.recorder?.state === 'recording') session.recorder.stop()
})

window.flow.onRecorderCancel(() => {
  if (!session) return
  session.cancelled = true
  if (session.recorder?.state === 'recording') session.recorder.stop()
  else releaseStream(session)
  session = null
})

// Loudest 50 ms window of the recording as RMS (0..1), decoded from the finished file rather than
// sampled from the level meter, whose animation frames macOS pauses for hidden windows.
// Returns null when the audio cannot be decoded, so the caller never blocks on a failed measurement.
async function measurePeakLevel(audio) {
  try {
    const buffer = await getAudioContext().decodeAudioData(audio.slice(0))
    const samples = buffer.getChannelData(0)
    const window = Math.max(1, Math.round(buffer.sampleRate * 0.05))
    let peak = 0
    for (let start = 0; start < samples.length; start += window) {
      const end = Math.min(start + window, samples.length)
      let sum = 0
      for (let i = start; i < end; i++) sum += samples[i] * samples[i]
      peak = Math.max(peak, Math.sqrt(sum / (end - start)))
    }
    return peak
  } catch {
    return null
  }
}

async function finishRecording(current) {
  releaseStream(current)
  if (session === current) session = null
  if (current.cancelled) return
  const durationMs = Math.round(performance.now() - current.startedAt)
  const blob = new Blob(current.chunks, { type: current.recorder.mimeType })
  const audio = await blob.arrayBuffer()
  window.flow.sendRecording({
    audio,
    mimeType: current.recorder.mimeType,
    durationMs,
    peakLevel: await measurePeakLevel(audio),
  })
}

function releaseStream(current) {
  cancelAnimationFrame(current.rafId)
  current.source?.disconnect()
  current.stream?.getTracks().forEach((track) => track.stop())
  bars.forEach((bar) => (bar.style.height = '3px'))
}
