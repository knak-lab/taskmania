// =============================================================
//  Outlook の予定（読み取り専用）
//
//  Outlook Web の「カレンダーを公開」で作った ICS リンクを GAS が読み、
//  指定期間の予定を { date, start, end, title, location } の形で返す。
//  画面は kkr > work のカレンダーに表示するだけで、Outlook へは書き込まない。
//
//  スクリプトプロパティ（ICS のリンクは知っていれば誰でも予定を読めるので、画面側のコードには置かない）
//    OUTLOOK_ICS_URL   : 公開した ICS のリンク（https://outlook.office365.com/owa/calendar/…/calendar.ics）
//    OUTLOOK_ICS_OWNER : 上のリンクが誰の予定表か（担当者名。未設定なら「永井」）
//    OUTLOOK_CALENDARS : ほかの人の予定表。1行に「担当者名=ICSのリンク」（例: 田之上=https://…/calendar.ics）
//  画面では担当ボタンと連動し、「全員」かその担当者を選んでいるときだけ表示する
//
//  時刻はすべて日本時間として扱う（UTC 指定の時刻だけ +9 時間する）。
//  ICS は1日ごとの区切りに分け、繰り返し予定（RRULE）も展開する。
//  見えるのは全体を見られる人（scope "full"）だけ。仕事用メンバーには返さない。
// =============================================================

const OUTLOOK_CACHE_SEC_ = 600 // 同じ期間の問い合わせは10分間キャッシュ
const DAY_MS_ = 24 * 60 * 60 * 1000
const JST_MS_ = 9 * 60 * 60 * 1000

// 読む予定表の一覧 [{ who, url }]。who は担当者名（画面の担当ボタンと同じ名前）
function outlookCalendars_() {
  const props = PropertiesService.getScriptProperties()
  const list = []
  const first = String(props.getProperty('OUTLOOK_ICS_URL') || '').trim()
  if (first) list.push({ who: String(props.getProperty('OUTLOOK_ICS_OWNER') || '永井').trim(), url: first })
  String(props.getProperty('OUTLOOK_CALENDARS') || '').split(/[\r\n]+/).forEach(function (line) {
    const eq = line.indexOf('=')
    if (eq <= 0) return
    const who = line.slice(0, eq).trim()
    const url = line.slice(eq + 1).trim()
    if (who && /^(https?|webcal):\/\//i.test(url)) list.push({ who: who, url: url })
  })
  return list
}

function outlookEvents_(from, to) {
  const cals = outlookCalendars_()
  if (!cals.length) return { events: [], outlook: 'unset' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to))) return { events: [], outlook: 'bad_range' }
  const cache = CacheService.getScriptCache()
  const key = 'ol2_' + from + '_' + to + '_' + Utilities.base64EncodeWebSafe(cals.map(function (c) { return c.who }).join(','), Utilities.Charset.UTF_8)
  const hit = cache.get(key)
  if (hit) return JSON.parse(hit)
  const events = []
  let failed = false
  cals.forEach(function (c) {
    let res
    try {
      res = UrlFetchApp.fetch(c.url.replace(/^webcal:/i, 'https:'), { muteHttpExceptions: true, followRedirects: true })
    } catch (e) {
      console.warn('[outlook] ' + c.who + ' の取得に失敗: ' + e)
      failed = true
      return
    }
    if (res.getResponseCode() !== 200) {
      console.warn('[outlook] ' + c.who + ' HTTP ' + res.getResponseCode())
      failed = true
      return
    }
    expandIcs_(res.getContentText('UTF-8'), dateStrToMs_(from), dateStrToMs_(to) + DAY_MS_).forEach(function (ev) {
      ev.who = c.who
      ev.id = c.who + '|' + ev.id
      events.push(ev)
    })
  })
  const result = { events: events, outlook: failed ? 'fetch_failed' : 'ok' }
  if (!failed) { try { cache.put(key, JSON.stringify(result), OUTLOOK_CACHE_SEC_) } catch (_) { /* 大きすぎるときはキャッシュしない */ } }
  return result
}

// GASエディタで実行して、ICSリンクが読めるか・何件取れるかを確かめる
function outlookSelfCheck() {
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')
  const r = outlookEvents_(today, Utilities.formatDate(new Date(Date.now() + 14 * DAY_MS_), 'Asia/Tokyo', 'yyyy-MM-dd'))
  Logger.log('予定表: ' + outlookCalendars_().map(function (c) { return c.who }).join(', '))
  Logger.log('状態: ' + r.outlook + ' / 今日から2週間の予定: ' + r.events.length + '件')
  r.events.slice(0, 10).forEach(function (e) { Logger.log(e.who + ' ' + e.date + ' ' + (e.start || '終日') + ' ' + e.title) })
}

// ---- ここから ICS の読み取り ----
// 日付・時刻は「日本時間の壁時計を UTC として数えたミリ秒」(以下 wall ms)で扱う。日本は夏時間が無いのでこれで足りる

function dateStrToMs_(s) {
  return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
}

function pad2_(n) { return (n < 10 ? '0' : '') + n }
function msToDateStr_(ms) {
  const d = new Date(ms)
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate())
}
function msToTime_(ms) {
  const d = new Date(ms)
  return pad2_(d.getUTCHours()) + ':' + pad2_(d.getUTCMinutes())
}

// 20261119 / 20261119T093000 / 20261119T003000Z → { ms, allDay }
function parseIcsDate_(value, params) {
  const m = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0))
  if (!m[4]) return { ms: ms, allDay: true }
  const tzid = String((params && params.TZID) || '')
  const utc = m[7] === 'Z' || /^(UTC|GMT|Etc\/UTC|Greenwich Standard Time|Coordinated Universal Time)$/i.test(tzid)
  return { ms: utc ? ms + JST_MS_ : ms, allDay: false }
}

// P1D / PT1H30M / -PT15M → ミリ秒
function parseDuration_(v) {
  const m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!m) return null
  const ms = ((Number(m[2] || 0) * 7 + Number(m[3] || 0)) * 24 * 3600 + Number(m[4] || 0) * 3600 + Number(m[5] || 0) * 60 + Number(m[6] || 0)) * 1000
  return m[1] === '-' ? -ms : ms
}

function unescapeIcs_(s) {
  return String(s || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
}

// "DTSTART;TZID=Tokyo Standard Time:20261119T090000" → { name, params, value }
function parseIcsLine_(line) {
  let inQuote = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i)
    if (c === '"') inQuote = !inQuote
    else if (c === ':' && !inQuote) { colon = i; break }
  }
  if (colon < 0) return null
  const head = line.slice(0, colon).split(';')
  const params = {}
  head.slice(1).forEach(function (p) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  })
  return { name: head[0].toUpperCase(), params: params, value: line.slice(colon + 1) }
}

function parseIcs_(text) {
  const lines = String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/)
  const events = []
  let cur = null
  let nested = 0
  lines.forEach(function (line) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: {} }; nested = 0; return }
    if (!cur) return
    if (line === 'END:VEVENT') { events.push(cur); cur = null; return }
    if (/^BEGIN:/.test(line)) { nested++; return }
    if (/^END:/.test(line)) { nested--; return }
    if (nested > 0) return // VALARM などの中身は使わない
    const p = parseIcsLine_(line)
    if (!p) return
    switch (p.name) {
      case 'UID': cur.uid = p.value; break
      case 'SUMMARY': cur.title = unescapeIcs_(p.value); break
      case 'LOCATION': cur.location = unescapeIcs_(p.value); break
      case 'STATUS': cur.status = p.value.toUpperCase(); break
      case 'DTSTART': cur.start = parseIcsDate_(p.value, p.params); break
      case 'DTEND': cur.end = parseIcsDate_(p.value, p.params); break
      case 'DURATION': cur.duration = parseDuration_(p.value); break
      case 'RRULE': cur.rrule = p.value; break
      case 'RECURRENCE-ID': cur.recurrenceId = parseIcsDate_(p.value, p.params); break
      case 'EXDATE':
        p.value.split(',').forEach(function (v) {
          const d = parseIcsDate_(v.trim(), p.params)
          if (d) cur.exdates[d.ms] = true
        })
        break
    }
  })
  return events
}

const WEEKDAYS_ = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function parseRrule_(s) {
  const r = {}
  String(s).split(';').forEach(function (kv) {
    const eq = kv.indexOf('=')
    if (eq > 0) r[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1)
  })
  const list = function (v) { return v ? v.split(',').map(function (x) { return x.trim() }).filter(Boolean) : [] }
  return {
    freq: String(r.FREQ || '').toUpperCase(),
    interval: Math.max(1, Number(r.INTERVAL) || 1),
    count: r.COUNT ? Number(r.COUNT) : null,
    until: r.UNTIL ? parseIcsDate_(r.UNTIL, {}) : null,
    byDay: list(r.BYDAY).map(function (d) {
      const m = d.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i)
      return m ? { n: m[1] ? Number(m[1]) : 0, wd: WEEKDAYS_[m[2].toUpperCase()] } : null
    }).filter(Boolean),
    byMonthDay: list(r.BYMONTHDAY).map(Number),
    byMonth: list(r.BYMONTH).map(Number),
    bySetPos: list(r.BYSETPOS).map(Number),
    wkst: WEEKDAYS_[String(r.WKST || 'MO').toUpperCase()] || 0,
  }
}

// その月(y, m0)の中で、規則に合う日(1〜31)の一覧
function monthDays_(y, m0, rule, dtDay) {
  const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
  let days = []
  if (rule.byMonthDay.length) {
    rule.byMonthDay.forEach(function (d) { const v = d < 0 ? last + 1 + d : d; if (v >= 1 && v <= last) days.push(v) })
  } else if (rule.byDay.length) {
    rule.byDay.forEach(function (bd) {
      const hits = []
      for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, m0, d)).getUTCDay() === bd.wd) hits.push(d)
      if (bd.n === 0) days = days.concat(hits)
      else { const v = bd.n > 0 ? hits[bd.n - 1] : hits[hits.length + bd.n]; if (v) days.push(v) }
    })
  } else if (dtDay <= last) {
    days.push(dtDay)
  }
  days = days.filter(function (d, i, a) { return a.indexOf(d) === i }).sort(function (a, b) { return a - b })
  if (rule.bySetPos.length) {
    days = rule.bySetPos.map(function (p) { return p > 0 ? days[p - 1] : days[days.length + p] }).filter(Boolean).sort(function (a, b) { return a - b })
  }
  return days
}

// 繰り返し予定の開始時刻(wall ms)を、rangeEnd まで列挙する
function expandRrule_(ev, rule, rangeEnd) {
  const start = ev.start.ms
  const dt = new Date(start)
  const timeOfDay = start - Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
  const until = rule.until ? (rule.until.allDay ? rule.until.ms + DAY_MS_ - 1 : rule.until.ms) : Infinity
  const out = []
  let emitted = 0
  const consider = function (ms) {
    if (ms < start) return true
    if (ms > until || ms >= rangeEnd) return false
    if (rule.count !== null && emitted >= rule.count) return false
    emitted++
    out.push(ms)
    return true
  }
  const dayStart = (y, m0, d) => Date.UTC(y, m0, d) + timeOfDay
  for (let k = 0; k < 20000; k++) {
    let cands = []
    if (rule.freq === 'DAILY') {
      const ms = start + k * rule.interval * DAY_MS_
      const wd = new Date(ms).getUTCDay()
      if (!rule.byDay.length || rule.byDay.some(function (b) { return b.wd === wd })) cands.push(ms)
      if (ms > until || ms >= rangeEnd) break
    } else if (rule.freq === 'WEEKLY') {
      const offset = (dt.getUTCDay() - rule.wkst + 7) % 7
      const weekStart = start - offset * DAY_MS_ + k * rule.interval * 7 * DAY_MS_
      if (weekStart > until || weekStart >= rangeEnd) break
      const wds = rule.byDay.length ? rule.byDay.map(function (b) { return b.wd }) : [dt.getUTCDay()]
      wds.forEach(function (wd) { cands.push(weekStart + ((wd - rule.wkst + 7) % 7) * DAY_MS_) })
    } else if (rule.freq === 'MONTHLY') {
      const total = dt.getUTCMonth() + k * rule.interval
      const y = dt.getUTCFullYear() + Math.floor(total / 12)
      const m0 = total % 12
      if (Date.UTC(y, m0, 1) > until || Date.UTC(y, m0, 1) >= rangeEnd) break
      monthDays_(y, m0, rule, dt.getUTCDate()).forEach(function (d) { cands.push(dayStart(y, m0, d)) })
    } else if (rule.freq === 'YEARLY') {
      const y = dt.getUTCFullYear() + k * rule.interval
      if (Date.UTC(y, 0, 1) > until || Date.UTC(y, 0, 1) >= rangeEnd) break
      const months = rule.byMonth.length ? rule.byMonth.map(function (m) { return m - 1 }) : [dt.getUTCMonth()]
      months.forEach(function (m0) { monthDays_(y, m0, rule, dt.getUTCDate()).forEach(function (d) { cands.push(dayStart(y, m0, d)) }) })
    } else {
      return [start] // 分からない規則は初回だけ出す
    }
    cands.sort(function (a, b) { return a - b })
    let more = true
    for (let i = 0; i < cands.length && more; i++) more = consider(cands[i])
    if (!more) break
  }
  return out
}

// [rangeStart, rangeEnd) にかかる予定を、日ごとに切り分けて返す
function expandIcs_(text, rangeStart, rangeEnd) {
  const all = parseIcs_(text).filter(function (e) { return e.start && e.status !== 'CANCELLED' })
  // 繰り返しのうち個別に変更された回（RECURRENCE-ID）は、元の繰り返しからは除く
  const overridden = {}
  all.forEach(function (e) { if (e.recurrenceId && e.uid) overridden[e.uid + '|' + e.recurrenceId.ms] = true })
  const out = []
  all.forEach(function (e) {
    const allDay = e.start.allDay
    let len = e.end ? e.end.ms - e.start.ms : e.duration != null ? e.duration : allDay ? DAY_MS_ : 0
    if (!(len >= 0)) len = 0
    let starts = [e.start.ms]
    if (e.rrule && !e.recurrenceId) {
      starts = expandRrule_(e, parseRrule_(e.rrule), rangeEnd)
        .filter(function (ms) { return !e.exdates[ms] && !overridden[e.uid + '|' + ms] })
    }
    starts.forEach(function (s) {
      const end = s + len
      if (end <= rangeStart && !(len === 0 && s >= rangeStart)) return
      if (s >= rangeEnd) return
      // 日ごとに切る
      let day = Date.UTC(new Date(s).getUTCFullYear(), new Date(s).getUTCMonth(), new Date(s).getUTCDate())
      do {
        const next = day + DAY_MS_
        if (day >= rangeStart && day < rangeEnd) {
          const piece = { id: (e.uid || e.title || '') + '|' + s + '|' + day, date: msToDateStr_(day), title: e.title || '(件名なし)', location: e.location || '' }
          if (allDay) { piece.start = null; piece.end = null }
          else {
            piece.start = msToTime_(Math.max(s, day))
            piece.end = end >= next ? '24:00' : msToTime_(Math.max(end, Math.max(s, day)))
          }
          out.push(piece)
        }
        day = next
      } while (day < end && day < rangeEnd)
    })
  })
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.start || '').localeCompare(String(b.start || '')) })
  return out
}
