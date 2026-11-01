# Whisperline

Push-to-talk dictation for macOS. Hold a key, speak, release – the transcribed and cleaned-up text
is pasted into whatever app you are using.

Whisperline lives in the menu bar. It records with your microphone, transcribes with OpenAI and
optionally lets Claude remove filler words, fix punctuation and apply your preferred style before
pasting. You bring your own API keys.

> The user interface is currently in German.

## Features

- **Hold to talk**: hold the trigger key while speaking, release to transcribe and paste.
- **Hands-free mode**: tap the key briefly to keep recording, press it again to stop. `esc` cancels.
- **Choice of trigger key**: Fn/Globe, left or right Option, right Command or right Control.
- **Text cleanup with Claude** (optional): removes filler words and self-corrections, fixes
  punctuation, adapts to a formal, casual or very casual style and to the app you dictate into.
- **Personal dictionary**: names and terms that should be spelled correctly, with optional
  replacements (for example "my email" → your address).
- **History** with search, word count, words per minute, an activity calendar and an estimate of
  what each dictation cost.
- **Silence detection**: recordings without sound are not sent for transcription, so the model
  cannot invent text from silence.
- **Recent recordings kept locally** (the last 20) to check a transcript against what was said.

## Requirements

- macOS on Apple Silicon (developed and tested on macOS 27)
- [Node.js](https://nodejs.org) 22 or newer
- Xcode Command Line Tools for the Swift helper: `xcode-select --install`
- An [OpenAI API key](https://platform.openai.com/api-keys) for transcription
- Optional: an [Anthropic API key](https://console.anthropic.com) for text cleanup

## Build and run

```bash
git clone https://github.com/AlexPEClub/Whisperline.git
cd Whisperline
npm install        # also compiles the Swift helper (build/flow-helper)
npm run pack       # builds dist/mac-arm64/Whisperline.app
open dist/mac-arm64/Whisperline.app
```

Other scripts:

```bash
npm start          # run in development mode
npm test           # unit tests
npm run dist       # build a DMG
```

### Code signing (recommended)

macOS ties its privacy permissions to the app's code signature. Without a stable signature the
app is signed ad hoc, and you have to grant the permissions again after every build.

To avoid that, create a self-signed code signing certificate once:

1. Open **Keychain Access** → menu **Keychain Access → Certificate Assistant → Create a Certificate…**
2. Name: `Whisperline Local`, Identity Type: **Self Signed Root**, Certificate Type: **Code Signing**
3. Build again with `npm run pack`.

The build picks up the certificate automatically. To use a different certificate, set
`WHISPERLINE_SIGN_IDENTITY` to its name.

## Setup

1. Open Whisperline from the menu bar icon → **Whisperline öffnen…**
2. Under **Einstellungen** (settings), enter your OpenAI API key and, optionally, your Anthropic
   API key. Alternatively, set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in the environment.
3. Grant the permissions macOS asks for:
   - **Microphone** – to record your voice
   - **Input Monitoring** – to detect the trigger key in any app
   - **Accessibility** – to paste the text with ⌘V
4. If you use Fn as the trigger key: System Settings → Keyboard → "Press 🌐 key to" → "Do Nothing".

## Privacy and costs

- Audio is sent to **OpenAI** for transcription. If text cleanup is enabled, the transcript is sent
  to **Anthropic**. Nothing is sent anywhere else.
- API keys are encrypted with the macOS keychain. Settings, history, the dictionary and the last
  20 recordings are stored locally in `~/Library/Application Support/Whisperline`.
- API usage is billed to your own accounts. The app shows an estimate based on list prices; your
  provider's invoice is what counts.

## How it works

```
helper/FlowHelper.swift   native helper: global key events (CGEventTap), ⌘V paste, frontmost app – JSON over stdio
src/main/hotkeys.js       state machine: hold = push-to-talk, tap = hands-free, esc = cancel
src/main/pipeline.js      OpenAI transcription → optional Claude cleanup
src/main/store.js         SQLite (node:sqlite): history and dictionary
src/main/recordings.js    keeps the most recent recordings on disk
src/renderer/overlay.*    floating pill with level meter, microphone recording (MediaRecorder/Opus)
src/renderer/hub.*        home (stats, activity, history), dictionary, settings
```

The bundle identifier is `dev.flowclone.app` for historical reasons: the project started under the
name "Flow Clone", and changing the identifier would reset the macOS permissions of existing installs.

## License

[MIT](LICENSE)
