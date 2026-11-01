// Provider list prices (USD, as of October 2026) used to estimate what each dictation costs.
// Update these when OpenAI or Anthropic change their prices.

// OpenAI bills transcription by tokens; these are its published per-minute estimates.
const TRANSCRIPTION_PER_MINUTE = {
  'gpt-transcribe': 0.0045,
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
  'whisper-1': 0.006,
}

// Per million tokens.
const CLEANUP_PER_MTOK = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
}

// Cache reads cost 0.1x and 5-minute cache writes 1.25x the base input price.
const CACHE_READ_FACTOR = 0.1
const CACHE_WRITE_FACTOR = 1.25

function transcriptionCost(model, durationMs) {
  const perMinute = TRANSCRIPTION_PER_MINUTE[model]
  if (perMinute === undefined || !durationMs) return 0
  return (durationMs / 60_000) * perMinute
}

// `model` is the model that actually served the request (a refusal fallback can differ from the setting).
function cleanupCost(model, usage) {
  const price = CLEANUP_PER_MTOK[model]
  if (!price || !usage) return 0
  const input =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) * CACHE_READ_FACTOR +
    (usage.cache_creation_input_tokens ?? 0) * CACHE_WRITE_FACTOR
  return (input * price.input + (usage.output_tokens ?? 0) * price.output) / 1_000_000
}

module.exports = { TRANSCRIPTION_PER_MINUTE, CLEANUP_PER_MTOK, transcriptionCost, cleanupCost }
