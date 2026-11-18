// =============================================================
//  Googleログイン認証（全アプリ共通）
//
//  フロントから送られてくる Google の IDトークンを検証し、
//  許可されたメールアドレスのときだけ処理を通す。
//
//  スクリプトプロパティ（プロジェクトの設定 → スクリプトプロパティ）
//    GOOGLE_CLIENT_ID : Google Cloud で作った OAuth クライアントID（全アプリ共通で同じ値）
//    ALLOWED_EMAILS   : 使ってよい Google アカウント（カンマ区切り）
//                       例) aaa@gmail.com,bbb@gmail.com
//  どちらかが未設定なら、すべて拒否する（安全側に倒す）。
// =============================================================

const AUTH_CACHE_MAX_SEC_ = 600
let AUTH_FAIL_CODE_ = ''

// 直前の verifyIdToken_ が拒否した理由コード（外部に返すのはこの3種類だけ）
//   login_required : ログインしていない／ログインの期限切れ
//   not_allowed    : ALLOWED_EMAILS に登録されていないアカウント
//   unavailable    : GAS側の設定不備など（詳細は返さない）
// 詳しい理由は GAS の「実行数」画面のログにだけ残す（攻撃者にヒントを与えないため）
function authFailReason_() {
  return AUTH_FAIL_CODE_ || 'login_required'
}

function authFail_(code, detail) {
  AUTH_FAIL_CODE_ = code
  if (detail) console.warn('[auth] ' + code + ': ' + detail)
  return null
}

function allowedEmails_() {
  return String(PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '')
    .split(/[,、\s]+/)
    .map(function (s) { return s.trim().toLowerCase() })
    .filter(Boolean)
}

// =============================================================
//  ログインの持ち時間（セッション）
//    Google の IDトークンは約1時間で切れるため、そのままだと1時間ごとにログインし直しになる。
//    IDトークンが通ったら、GAS が署名した「入場券」（SESSION_TTL_SEC_ 有効）を返し、
//    画面は以後それを id_token の代わりに送る。署名の鍵はスクリプトプロパティ SESSION_SECRET
//    （無ければ自動で作る。消す・変えると発行済みの入場券はすべて無効になり、ログインし直しになる）
//    入場券でも毎回 ALLOWED_EMAILS を確かめるので、許可リストから外せばすぐ使えなくなる。
// =============================================================
const SESSION_TTL_SEC_ = 4 * 60 * 60
const SESSION_PREFIX_ = 'tms1.'
let ISSUED_SESSION_ = ''

function sessionSecret_() {
  const props = PropertiesService.getScriptProperties()
  let secret = String(props.getProperty('SESSION_SECRET') || '')
  if (secret.length < 32) {
    secret = Utilities.getUuid() + Utilities.getUuid()
    props.setProperty('SESSION_SECRET', secret)
  }
  return secret
}

function signSession_(body) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, sessionSecret_()))
}

function issueSession_(email) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC_
  const body = Utilities.base64EncodeWebSafe(JSON.stringify({ e: email, x: exp }), Utilities.Charset.UTF_8)
  return SESSION_PREFIX_ + body + '.' + signSession_(body)
}

function verifySession_(token) {
  const parts = token.slice(SESSION_PREFIX_.length).split('.')
  if (parts.length !== 2) return authFail_('login_required', '入場券の形が不正')
  const expected = signSession_(parts[0])
  const sig = parts[1]
  if (sig.length !== expected.length) return authFail_('login_required', '入場券の署名が不正')
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  if (diff !== 0) return authFail_('login_required', '入場券の署名が不正')
  let info
  try { info = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8')) } catch (_) { return authFail_('login_required', '入場券を読めない') }
  if (!info || !(Number(info.x) > Math.floor(Date.now() / 1000))) return authFail_('login_required', '入場券の期限切れ')
  const email = String(info.e || '').toLowerCase()
  if (allowedEmails_().indexOf(email) < 0) return authFail_('not_allowed', '許可リスト外: ' + email)
  return email
}

// 正しいIDトークン（または入場券）なら メールアドレス、だめなら null を返す。
// Google の IDトークンで通ったときは、返事に付ける入場券を ISSUED_SESSION_ に用意する（jsonResponse_ が付ける）
function verifyIdToken_(idToken) {
  AUTH_FAIL_CODE_ = ''
  ISSUED_SESSION_ = ''
  if (typeof idToken === 'string' && idToken.indexOf(SESSION_PREFIX_) === 0 && idToken.length <= 4096) return verifySession_(idToken)
  const email = verifyGoogleIdToken_(idToken)
  if (email) ISSUED_SESSION_ = issueSession_(email)
  return email
}

function verifyGoogleIdToken_(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4096) return authFail_('login_required')
  const clientId = String(PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID') || '').trim()
  const allowed = allowedEmails_()
  if (!clientId) return authFail_('unavailable', 'GOOGLE_CLIENT_ID が未設定')
  if (allowed.length === 0) return authFail_('unavailable', 'ALLOWED_EMAILS が未設定')

  const cache = CacheService.getScriptCache()
  const key = 'idt_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8))
  const cached = cache.get(key)
  if (cached) return allowed.indexOf(cached) >= 0 ? cached : authFail_('not_allowed', '許可リスト外: ' + cached)

  let res
  try {
    res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true })
  } catch (e) {
    return authFail_('unavailable', '外部通信が未許可。authSelfCheck を実行して許可すること')
  }
  if (res.getResponseCode() !== 200) return authFail_('login_required', 'tokeninfo HTTP ' + res.getResponseCode())
  let info
  try { info = JSON.parse(res.getContentText()) } catch (_) { return authFail_('unavailable', 'tokeninfo の応答を解析できない') }

  if (info.aud !== clientId) return authFail_('unavailable', 'GOOGLE_CLIENT_ID と VITE_GOOGLE_CLIENT_ID が不一致')
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') return authFail_('login_required', 'iss 不正: ' + info.iss)
  if (String(info.email_verified) !== 'true') return authFail_('not_allowed', 'email 未確認')
  const now = Math.floor(Date.now() / 1000)
  const exp = Number(info.exp)
  if (!exp || exp <= now) return authFail_('login_required', '期限切れ')
  const email = String(info.email || '').toLowerCase()
  if (allowed.indexOf(email) < 0) return authFail_('not_allowed', '許可リスト外: ' + email)

  cache.put(key, email, Math.max(1, Math.min(exp - now, AUTH_CACHE_MAX_SEC_)))
  return email
}

// 初回だけGASエディタで実行して、外部通信（UrlFetchApp）の許可を出すための関数
function authSelfCheck() {
  const props = PropertiesService.getScriptProperties()
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=x', { muteHttpExceptions: true })
  const cid = String(props.getProperty('GOOGLE_CLIENT_ID') || '')
  Logger.log('GOOGLE_CLIENT_ID: ' + (cid ? '設定済み → ' + cid : '★未設定'))
  if (cid && cid !== cid.trim()) Logger.log('★GOOGLE_CLIENT_ID の前後に空白があります（自動で無視しますが、消しておくと安心です）')
  if (cid && !/\.apps\.googleusercontent\.com$/.test(cid.trim())) Logger.log('★GOOGLE_CLIENT_ID の形が変です（…apps.googleusercontent.com で終わるはず）')
  Logger.log('ALLOWED_EMAILS : ' + (allowedEmails_().length ? allowedEmails_().join(', ') : '★未設定'))
  Logger.log('API_TOKEN(旧)  : ' + (props.getProperty('API_TOKEN') ? '残っています（使っていなければ削除してOK）' : 'なし'))
}

// =============================================================
//  CLI（tools/tm.cjs）用のサービストークン
//    スクリプトプロパティ SERVICE_TOKEN（32文字以上）と一致したときだけ true。
//    このトークンで使えるのは「1件ずつの受け口（body.ops）」と読み込みだけ（Ops.gs）。
//    全件洗い替えの保存には使えない。未設定なら常に false（安全側に倒す）。
// =============================================================
function verifyServiceToken_(token) {
  const expected = String(PropertiesService.getScriptProperties().getProperty('SERVICE_TOKEN') || '').trim()
  if (expected.length < 32 || typeof token !== 'string' || token.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i)
  return diff === 0
}
