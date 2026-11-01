// Compiles the Swift helper into build/flow-helper (macOS only).
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

if (process.platform !== 'darwin') {
  console.log('[build-helper] skipped: macOS only')
  process.exit(0)
}

const root = path.join(__dirname, '..')
const out = path.join(root, 'build', 'flow-helper')
fs.mkdirSync(path.dirname(out), { recursive: true })

execFileSync(
  'swiftc',
  ['-O', '-swift-version', '5', path.join(root, 'helper', 'FlowHelper.swift'), '-o', out],
  { stdio: 'inherit' },
)
console.log(`[build-helper] built ${out}`)
