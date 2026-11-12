// =============================================================
//  このアプリ用の設定（金庫・ログイン画面）
//  vault.js / googleAuth.js / AuthGate.jsx はお金ちゃんと共通の部品。アプリごとの違いはここだけに書く
// =============================================================

export const APP_ID = 'taskmania'               // 金庫の名前（IndexedDB）と暗号鍵の区別に使う。変えると保存データが読めなくなる
export const DATA_LABEL = 'インボックスのメモなど' // 指紋・顔認証の登録画面の説明に使う
export const ACCENT_COLOR = '#e8630c'

// 登録されたアカウントかをサーバー（GAS）で確かめる。通らなければ googleAuth がログイン画面に戻す
// （api/gas.js は googleAuth.js を読み込むので、循環しないよう呼ぶときに読み込む）
export const verifyAccess = () => import('../api/gas').then((m) => m.loadRev())

// 金庫を開いたとき：端末にしかないデータを、指紋・顔認証の鍵で暗号化できるなら金庫へ移す
export async function migrateLegacyStorage() {
  const { moveLocalToVault } = await import('./deviceStore')
  moveLocalToVault()
}
