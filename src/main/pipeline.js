// Audio -> transcript (OpenAI) -> cleaned text (Claude).
const { default: OpenAI, toFile } = require('openai')
const { default: Anthropic } = require('@anthropic-ai/sdk')
const { cleanupSystemPrompt, cleanupUserMessage, transcriptionPrompt } = require('./text')
const { cleanupCost } = require('./pricing')

// Models that accept server-side refusal fallbacks with the "default" routing.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'])

class PipelineError extends Error {
  constructor(message, userMessage) {
    super(message)
    this.userMessage = userMessage
  }
}

async function transcribe({ audio, mimeType, settings, dictionary }) {
  const apiKey = settings.openaiKey || process.env.OPENAI_API_KEY
  if (!apiKey) throw new PipelineError('missing OpenAI key', 'OpenAI-API-Key fehlt (Einstellungen)')
  const client = new OpenAI({ apiKey })
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'
  try {
    const res = await client.audio.transcriptions.create({
      file: await toFile(audio, `speech.${extension}`, { type: mimeType }),
      model: settings.transcriptionModel,
      language: settings.language || undefined,
      prompt: transcriptionPrompt(dictionary),
      // Without it the recording is transcribed as one block, and quieter endings or passages after
      // pauses can drop out; "auto" normalizes loudness and splits at pauses. whisper-1 lacks it.
      chunking_strategy: settings.transcriptionModel === 'whisper-1' ? undefined : 'auto',
    })
    return res.text.trim()
  } catch (err) {
    throw new PipelineError(err.message, `Transkription fehlgeschlagen (${err.status ?? 'Netzwerk'})`)
  }
}

// Returns { text, costUsd }, or null when cleanup is disabled. `text` is null when Claude
// declined or returned nothing, so the caller can fall back to the raw transcript.
async function cleanup({ transcript, appName, settings, dictionary }) {
  const apiKey = settings.anthropicKey || process.env.ANTHROPIC_API_KEY
  if (!settings.cleanupEnabled || !apiKey) return null
  const client = new Anthropic({ apiKey })
  const model = settings.cleanupModel
  const params = {
    model,
    max_tokens: 8000,
    output_config: { effort: 'low' },
    system: cleanupSystemPrompt({ style: settings.style, dictionary }),
    messages: [{ role: 'user', content: cleanupUserMessage({ transcript, appName }) }],
  }
  const response = FALLBACK_MODELS.has(model)
    ? await client.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })
    : await client.messages.create(params)
  const costUsd = cleanupCost(response.model, response.usage)
  if (response.stop_reason === 'refusal') return { text: null, costUsd }
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
  return { text: text || null, costUsd }
}

module.exports = { transcribe, cleanup, PipelineError }
