// Keeps the most recent dictation recordings on disk so a bad transcript can be checked
// against what was actually recorded. Recordings never leave the machine.
const fs = require('node:fs')
const path = require('node:path')

const KEEP_RECORDINGS = 20

// Sortable, filesystem-safe name from the recording time: 2026-10-26T09-14-03-512.webm
function recordingName(date, mimeType) {
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'
  return `${date.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '')}.${extension}`
}

function saveRecording(dir, audio, mimeType, { date = new Date(), keep = KEEP_RECORDINGS } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, recordingName(date, mimeType))
  fs.writeFileSync(file, audio)
  const names = fs.readdirSync(dir).filter((name) => /\.(webm|mp4)$/.test(name)).sort()
  for (const name of names.slice(0, Math.max(0, names.length - keep))) fs.rmSync(path.join(dir, name))
  return file
}

module.exports = { saveRecording, recordingName, KEEP_RECORDINGS }
