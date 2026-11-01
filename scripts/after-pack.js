// Signs the packaged app with a stable local identity so macOS privacy grants
// (Accessibility, Input Monitoring, Microphone) survive rebuilds. Ad-hoc
// signatures pin grants to the binary hash, which changes on every build.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

// First identity found in the keychain wins. "Flow Clone Local" is the certificate name from
// before the rename; keeping it means existing installs keep their privacy grants.
const IDENTITIES = [process.env.WHISPERLINE_SIGN_IDENTITY, 'Whisperline Local', 'Flow Clone Local'].filter(Boolean)

function findIdentity() {
  const out = execFileSync('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' })
  return IDENTITIES.find((name) => out.includes(`"${name}"`))
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const identity = findIdentity() ?? '-'
  if (identity === '-') {
    console.warn(`[after-pack] no signing identity found (${IDENTITIES.join(', ')}), ad-hoc signing (grants reset on every build)`)
  }
  // --deep only covers nested bundles, so sign the bare helper executable explicitly first.
  const helper = path.join(appPath, 'Contents', 'Resources', 'flow-helper')
  execFileSync('codesign', ['--force', '--sign', identity, '--identifier', 'dev.flowclone.helper', helper], { stdio: 'inherit' })
  execFileSync('codesign', ['--force', '--deep', '--sign', identity, appPath], { stdio: 'inherit' })
  console.log(`[after-pack] signed ${appPath} with ${identity}`)
}
