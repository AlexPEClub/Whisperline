const $ = (sel) => document.querySelector(sel)
const KEY_LABELS = { fn: 'Fn', leftOption: 'linke ⌥', rightOption: 'rechte ⌥', rightCommand: 'rechte ⌘', rightControl: 'rechte ⌃' }

// Dictations cost fractions of a cent, so small amounts keep four decimals.
function formatUsd(value) {
  const digits = value > 0 && value < 1 ? 4 : 2
  return `${value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: digits })} $`
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

// ---------- Navigation ----------

for (const button of document.querySelectorAll('nav button')) {
  button.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b === button))
    document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${button.dataset.view}`))
  })
}

$('#toggle-dictation').addEventListener('click', () => window.flow.toggleDictation())

// ---------- Permissions ----------

async function renderPermissions() {
  const p = await window.flow.getPermissions()
  const missing = []
  if (p.microphone !== 'granted') missing.push(['microphone', 'Mikrofon'])
  if (!p.inputMonitoring || !p.keyTap) missing.push(['inputMonitoring', 'Eingabeüberwachung (Taste erkennen)'])
  if (!p.accessibility) missing.push(['accessibility', 'Bedienungshilfen (Text einfügen)'])
  const banner = $('#permissions')
  banner.hidden = missing.length === 0 && p.openaiKey
  banner.replaceChildren(
    ...(missing.length
      ? [
          el('p', { textContent: 'Whisperline braucht noch Zugriff auf:' }),
          ...missing.map(([kind, label]) =>
            el('button', { textContent: label, onclick: () => window.flow.requestPermission(kind) }),
          ),
        ]
      : []),
    p.openaiKey ? '' : el('p', { textContent: 'Trage unter Einstellungen deinen OpenAI-API-Key ein (für die Transkription).' }),
  )
}

// ---------- Home ----------

function dayLabel(ts) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Heute'
  if (d.toDateString() === yesterday.toDateString()) return 'Gestern'
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
}

async function renderHome() {
  const [stats, history, settings] = await Promise.all([
    window.flow.getStats(),
    window.flow.listHistory({ query: $('#search').value.trim() }),
    window.flow.getSettings(),
  ])
  $('#stat-words').textContent = stats.words.toLocaleString('de-DE')
  $('#stat-dictations').textContent = stats.dictations.toLocaleString('de-DE')
  $('#stat-wpm').textContent = stats.wpm
  $('#stat-cost-month').textContent = formatUsd(stats.monthCostUsd)
  $('#stat-cost-total').textContent = formatUsd(stats.costUsd)
  const key = KEY_LABELS[settings.triggerKey]
  $('#hint').replaceChildren(
    'Halte ',
    el('kbd', { textContent: key }),
    ' gedrückt und sprich. Kurz tippen für Freihand-Modus, ',
    el('kbd', { textContent: 'esc' }),
    ' bricht ab.',
  )

  const list = $('#history')
  if (history.length === 0) {
    list.replaceChildren(el('div', { className: 'empty', textContent: 'Noch keine Diktate.' }))
    return
  }
  const nodes = []
  let lastDay = null
  for (const entry of history) {
    const day = dayLabel(entry.timestamp)
    if (day !== lastDay) nodes.push(el('div', { className: 'day', textContent: day }))
    lastDay = day
    nodes.push(renderEntry(entry))
  }
  list.replaceChildren(...nodes)
}

// ---------- Activity ----------

const ACTIVITY_WEEKS = 53
const WEEKDAY_LABELS = ['Mo', '', 'Mi', '', 'Fr', '', '']

function localDay(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// 0 = no words; 1–4 split the busiest day into quarters, like GitHub's contribution calendar.
function activityLevel(words, max) {
  return words ? Math.max(1, Math.ceil((words / max) * 4)) : 0
}

async function renderActivity() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // Columns are Monday-first weeks; the last column holds the current week.
  const start = new Date(today)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (ACTIVITY_WEEKS - 1) * 7)
  const rows = await window.flow.getActivity(start.getTime())
  const wordsByDay = new Map(rows.map((row) => [row.day, row.words]))
  const max = Math.max(0, ...wordsByDay.values())

  const nodes = [el('span'), ...WEEKDAY_LABELS.map((label) => el('span', { className: 'weekday', textContent: label }))]
  const day = new Date(start)
  let total = 0
  let lastMonth = start.getMonth() // the partial first month stays unlabeled
  for (let week = 0; week < ACTIVITY_WEEKS; week++) {
    const month = day.getMonth()
    const label = month !== lastMonth ? day.toLocaleDateString('de-DE', { month: 'short' }) : ''
    nodes.push(el('span', { className: 'month', textContent: label }))
    lastMonth = month
    for (let weekday = 0; weekday < 7; weekday++) {
      const words = wordsByDay.get(localDay(day)) ?? 0
      total += words
      const cell = el('span', {
        className: day > today ? 'cell future' : 'cell',
        ariaLabel: `${words.toLocaleString('de-DE')} Wörter am ${day.toLocaleDateString('de-DE', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}`,
      })
      cell.dataset.level = activityLevel(words, max)
      nodes.push(cell)
      day.setDate(day.getDate() + 1)
    }
  }
  const grid = $('#activity-grid')
  grid.ariaLabel = `Diktierte Wörter pro Tag, letzte ${ACTIVITY_WEEKS} Wochen`
  grid.replaceChildren(...nodes)
  $('#activity-total').textContent = `${total.toLocaleString('de-DE')} Wörter im letzten Jahr`
}

$('#activity-grid').addEventListener('mouseover', (e) => {
  const tooltip = $('#activity-tooltip')
  const cell = e.target.closest('.cell:not(.future)')
  if (!cell) return (tooltip.hidden = true)
  const box = cell.getBoundingClientRect()
  const origin = $('.activity').getBoundingClientRect()
  tooltip.textContent = cell.ariaLabel
  tooltip.style.left = `${box.left + box.width / 2 - origin.left}px`
  tooltip.style.top = `${box.top - origin.top}px`
  tooltip.hidden = false
})
$('#activity-grid').addEventListener('mouseleave', () => ($('#activity-tooltip').hidden = true))

function renderEntry(entry) {
  const text = entry.formattedText || entry.asrText
  const failed = entry.status !== 'pasted'
  const statusText = {
    empty: 'Nichts verstanden',
    silent: 'Kein Ton – Mikrofon prüfen',
    error: entry.error ?? 'Fehler',
  }[entry.status]
  const meta = [
    entry.app,
    entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)} s` : null,
    entry.costUsd ? formatUsd(entry.costUsd) : null,
    statusText,
  ]
    .filter(Boolean)
    .join(' · ')
  return el('div', { className: `entry${failed ? ' failed' : ''}` }, [
    el('time', {
      textContent: new Date(entry.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    }),
    el('div', {}, [
      el('div', { className: 'text', textContent: text || '—' }),
      el('div', { className: 'meta', textContent: meta }),
    ]),
    el('div', { className: 'actions' }, [
      text ? el('button', { textContent: 'Kopieren', onclick: () => window.flow.copy(text) }) : '',
      entry.asrText && entry.asrText !== text
        ? el('button', { textContent: 'Original', title: entry.asrText, onclick: () => window.flow.copy(entry.asrText) })
        : '',
      el('button', {
        textContent: 'Löschen',
        onclick: async () => {
          await window.flow.deleteHistory(entry.id)
          renderHome()
        },
      }),
    ]),
  ])
}

let searchTimer
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(renderHome, 150)
})

// ---------- Dictionary ----------

async function renderDictionary() {
  const entries = await window.flow.listDictionary()
  $('#dictionary').replaceChildren(
    ...(entries.length
      ? entries.map((d) =>
          el('span', { className: 'chip' }, [
            d.phrase,
            d.replacement ? el('small', { textContent: `→ ${d.replacement}` }) : '',
            el('button', {
              textContent: '✕',
              title: 'Entfernen',
              onclick: async () => {
                await window.flow.removeDictionary(d.phrase)
                renderDictionary()
              },
            }),
          ]),
        )
      : [el('p', { className: 'sub', textContent: 'Noch keine Einträge.' })]),
  )
}

$('#dict-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  await window.flow.addDictionary({ phrase: $('#dict-phrase').value, replacement: $('#dict-replacement').value })
  e.target.reset()
  $('#dict-phrase').focus()
  renderDictionary()
})

// ---------- Settings ----------

async function renderSettings() {
  const form = $('#settings')
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
  $('#mics').replaceChildren(
    el('option', { value: '', textContent: 'Systemstandard' }),
    ...devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
      .map((d) => el('option', { value: d.deviceId, textContent: d.label || 'Mikrofon' })),
  )
  const settings = await window.flow.getSettings()
  for (const field of form.elements) {
    if (!field.name || !(field.name in settings)) continue
    if (field.type === 'checkbox') field.checked = settings[field.name]
    else field.value = settings[field.name]
  }
}

let savedTimer
$('#settings').addEventListener('change', async (e) => {
  const field = e.target
  if (!field.name) return
  const value = field.type === 'checkbox' ? field.checked : field.value.trim()
  const settings = await window.flow.updateSettings({ [field.name]: value })
  if (field.type === 'password') field.value = settings[field.name]
  $('#saved').hidden = false
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => ($('#saved').hidden = true), 1500)
  renderHome()
})

// ---------- Boot ----------

function refresh() {
  renderPermissions()
  renderHome()
  renderActivity()
}

window.flow.onChanged(refresh)
window.addEventListener('focus', renderPermissions)
refresh()
renderDictionary()
renderSettings()
