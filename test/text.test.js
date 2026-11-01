const test = require('node:test')
const assert = require('node:assert/strict')
const { applyReplacements, cleanupSystemPrompt, cleanupUserMessage, transcriptionPrompt } = require('../src/main/text')

test('replacements match whole words case-insensitively', () => {
  const dict = [{ phrase: 'my email', replacement: 'info@example.com' }, { phrase: 'cat', replacement: null }]
  const { text, used } = applyReplacements('Send it to My Email, not my emailing list.', dict)
  assert.equal(text, 'Send it to info@example.com, not my emailing list.')
  assert.deepEqual(used, ['my email'])
})

test('replacements respect non-ASCII word boundaries', () => {
  const { text } = applyReplacements('Grüße an Lisa und Lisabeth', [{ phrase: 'Lisa', replacement: 'Liza' }])
  assert.equal(text, 'Grüße an Liza und Lisabeth')
})

test('system prompt carries style and vocabulary', () => {
  const prompt = cleanupSystemPrompt({ style: 'formal', dictionary: [{ phrase: 'Whisperline' }] })
  assert.match(prompt, /Style: Formal/)
  assert.match(prompt, /Preferred spellings for names and terms: Whisperline\./)
})

test('user message wraps transcript and app context', () => {
  const msg = cleanupUserMessage({ transcript: 'hallo welt', appName: 'Slack' })
  assert.equal(msg, 'The text will be pasted into: Slack.\n<transcript>\nhallo welt\n</transcript>')
})

test('transcription prompt is omitted for an empty dictionary', () => {
  assert.equal(transcriptionPrompt([]), undefined)
  assert.equal(transcriptionPrompt([{ phrase: 'a', replacement: 'B' }]), 'Vocabulary: B.')
})
