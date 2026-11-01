// One-time carry-over of user data from the app's former name ("Flow Clone"). Electron derives the
// data folder from the app name, so after the rename the app would otherwise start empty.
// Files are copied, never moved, so the old folder stays intact as a fallback.
const fs = require('node:fs')
const path = require('node:path')

const LEGACY_NAME = 'Flow Clone'
const CARRIED_OVER = ['settings.json', 'flow.sqlite', 'flow.log', 'recordings']

// Returns the entries copied; entries that already exist in the new folder are left untouched.
function carryOverUserData(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return []
  fs.mkdirSync(toDir, { recursive: true })
  const copied = []
  for (const name of CARRIED_OVER) {
    const from = path.join(fromDir, name)
    const to = path.join(toDir, name)
    if (!fs.existsSync(from) || fs.existsSync(to)) continue
    fs.cpSync(from, to, { recursive: true })
    copied.push(name)
  }
  return copied
}

module.exports = { carryOverUserData, LEGACY_NAME, CARRIED_OVER }
