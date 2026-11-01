// Local persistence: dictation history and the personal dictionary (SQLite).
const { DatabaseSync } = require('node:sqlite')
const crypto = require('node:crypto')
const { TRANSCRIPTION_PER_MINUTE } = require('./pricing')

class Store {
  constructor(file) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        asrText TEXT,
        formattedText TEXT,
        app TEXT,
        durationMs INTEGER,
        numWords INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        costUsd REAL
      );
      CREATE INDEX IF NOT EXISTS history_timestamp ON history(timestamp);
      CREATE TABLE IF NOT EXISTS dictionary (
        phrase TEXT PRIMARY KEY COLLATE NOCASE,
        replacement TEXT,
        frequencyUsed INTEGER NOT NULL DEFAULT 0,
        lastUsed INTEGER,
        createdAt INTEGER NOT NULL
      );
    `)
    this.#addCostColumn()
  }

  // Databases created before cost tracking get the column, with past dictations estimated at the
  // default transcription price. Their cleanup token usage was never recorded, so it is not included.
  #addCostColumn() {
    const columns = this.db.prepare(`PRAGMA table_info(history)`).all().map((column) => column.name)
    if (columns.includes('costUsd')) return
    this.db.exec(`ALTER TABLE history ADD COLUMN costUsd REAL`)
    this.db
      .prepare(`UPDATE history SET costUsd = durationMs / 60000.0 * ? WHERE asrText IS NOT NULL`)
      .run(TRANSCRIPTION_PER_MINUTE['gpt-4o-transcribe'])
  }

  addHistory({ asrText, formattedText, app, durationMs, costUsd, status, error }) {
    const id = crypto.randomUUID()
    const text = formattedText || asrText || ''
    const numWords = text.split(/\s+/).filter(Boolean).length
    this.db
      .prepare(
        `INSERT INTO history (id, timestamp, asrText, formattedText, app, durationMs, numWords, status, error, costUsd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        Date.now(),
        asrText ?? null,
        formattedText ?? null,
        app ?? null,
        durationMs ?? null,
        numWords,
        status,
        error ?? null,
        costUsd ?? null,
      )
    return id
  }

  listHistory({ limit = 200, query = '' } = {}) {
    if (query) {
      const like = `%${query}%`
      return this.db
        .prepare(
          `SELECT * FROM history WHERE formattedText LIKE ? OR asrText LIKE ? ORDER BY timestamp DESC LIMIT ?`,
        )
        .all(like, like, limit)
    }
    return this.db.prepare(`SELECT * FROM history ORDER BY timestamp DESC LIMIT ?`).all(limit)
  }

  deleteHistory(id) {
    this.db.prepare(`DELETE FROM history WHERE id = ?`).run(id)
  }

  lastText() {
    const row = this.db
      .prepare(`SELECT formattedText, asrText FROM history WHERE status = 'pasted' ORDER BY timestamp DESC LIMIT 1`)
      .get()
    return row ? row.formattedText || row.asrText : null
  }

  stats(now = new Date()) {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS dictations, COALESCE(SUM(numWords), 0) AS words, COALESCE(SUM(durationMs), 0) AS ms
         FROM history WHERE status = 'pasted'`,
      )
      .get()
    // Spend counts every billed request, including failed or empty dictations.
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const cost = this.db
      .prepare(
        `SELECT COALESCE(SUM(costUsd), 0) AS total,
                COALESCE(SUM(CASE WHEN timestamp >= ? THEN costUsd END), 0) AS month
         FROM history`,
      )
      .get(monthStart)
    const minutes = row.ms / 60000
    return {
      dictations: row.dictations,
      words: row.words,
      wpm: minutes > 0 ? Math.round(row.words / minutes) : 0,
      costUsd: cost.total,
      monthCostUsd: cost.month,
    }
  }

  // Words of pasted dictations per local calendar day ('YYYY-MM-DD'), from `since` (ms) on.
  dailyWords(since) {
    return this.db
      .prepare(
        `SELECT date(timestamp / 1000, 'unixepoch', 'localtime') AS day, SUM(numWords) AS words
         FROM history WHERE status = 'pasted' AND timestamp >= ?
         GROUP BY day ORDER BY day`,
      )
      .all(since)
  }

  listDictionary() {
    return this.db.prepare(`SELECT * FROM dictionary ORDER BY createdAt DESC`).all()
  }

  addDictionary(phrase, replacement) {
    this.db
      .prepare(
        `INSERT INTO dictionary (phrase, replacement, createdAt) VALUES (?, ?, ?)
         ON CONFLICT(phrase) DO UPDATE SET replacement = excluded.replacement`,
      )
      .run(phrase.trim(), replacement?.trim() || null, Date.now())
  }

  removeDictionary(phrase) {
    this.db.prepare(`DELETE FROM dictionary WHERE phrase = ?`).run(phrase)
  }

  markDictionaryUsed(phrases) {
    const stmt = this.db.prepare(
      `UPDATE dictionary SET frequencyUsed = frequencyUsed + 1, lastUsed = ? WHERE phrase = ?`,
    )
    for (const phrase of phrases) stmt.run(Date.now(), phrase)
  }
}

module.exports = { Store }
