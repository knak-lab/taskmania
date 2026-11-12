// =============================================================
//  端末にしか置いていないデータ（インボックスのメモ・計測中のタスク）の保存先
//
//  ・指紋・顔認証の鍵（PRF）で金庫を開いているときは、金庫（暗号化）に置く
//  ・それ以外（パスキーを使わない・PRF に対応していない端末）は、金庫に置くと鍵がかかったときに
//    消えてしまう（ここにしかないデータなので困る）。そのため今までどおり localStorage に置く
// =============================================================
import { getVaultState, vaultGet, vaultSet, vaultRemove } from './vault'

export const DEVICE_KEYS = ['tm_inbox', 'tm_running_target']

const inVault = () => {
  const v = getVaultState()
  return v.status === 'unlocked' && v.mode === 'prf'
}

export function deviceGet(key, fallback) {
  try {
    if (inVault()) {
      // 読む前に、localStorage に残っている分をその場で金庫へ移す（画面が古い値で上書きしないように）
      moveKey(key)
      const v = vaultGet(key)
      return v == null ? fallback : v
    }
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function deviceSet(key, value) {
  try {
    if (value == null) return deviceRemove(key)
    if (inVault()) vaultSet(key, value)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch { /* 容量超過・プライベートモードなど */ }
}

export function deviceRemove(key) {
  try {
    if (inVault()) vaultRemove(key)
    else localStorage.removeItem(key)
  } catch { /* noop */ }
}

// localStorage に平文で残っているものを金庫へ移して消す（金庫が PRF で開いているときだけ）。
// インボックスは、金庫側にもあれば id が重ならないように足し合わせる（どちらのメモも失わない）
function moveKey(key) {
  let raw = null
  try { raw = localStorage.getItem(key) } catch { return }
  if (raw == null) return
  try {
    const local = JSON.parse(raw)
    const current = vaultGet(key)
    if (key === 'tm_inbox' && Array.isArray(current) && Array.isArray(local)) {
      const ids = new Set(current.map((n) => n.id))
      vaultSet(key, [...current, ...local.filter((n) => !ids.has(n.id))])
    } else if (current == null) {
      vaultSet(key, local)
    }
  } catch {
    return // 壊れていたら移さず、消しもしない
  }
  try { localStorage.removeItem(key) } catch { /* noop */ }
}

export function moveLocalToVault() {
  if (!inVault()) return
  DEVICE_KEYS.forEach(moveKey)
}
