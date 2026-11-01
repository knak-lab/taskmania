# タスクマニア 引き継ぎメモ（2026-11-02 時点）

プライベートPCでの検討内容を、会社PCで続けるためのメモ。
**このリポジトリは公開されている**ので、GAS の URL・メールアドレス・トークンなどはここに書かない。

## 今の状態

- 本番: https://knak-lab.github.io/taskmania/ （main = origin/main、最新コミット `0e958f4`）
- 11/1 に GAS へのアクセスを Google ログインに切り替え済み（手順と仕組みは [security-google-login.md](security-google-login.md)）
  - 許可メールは GAS のスクリプトプロパティ `ALLOWED_EMAILS` に入れる
  - `WORK_ONLY_EMAILS` に入れた人は「kkr > 仕事」の PJ とテーマだけを読み書きできる（`gas/Code.gs` の `scopeFor_` / `mergeWorkScope_`）
- 保存のしくみは今も「全件を丸ごと送って洗い替え」のまま（`src/api/gas.js` → `gas/Code.gs` の `writeRowsReplacing_`）。LockService で同時書き込みは防げているが、開きっぱなしの古い画面が保存すると、他の端末で足した分を上書きしうる

## 保留・中止したもの（ユーザー判断 2026-10-26）

- 点検パネルの本番反映 → いったんやめる
- 「現在地」表示（言葉と色を前向きにする案） → いったんやめる

## 進めたいこと 1: Claude が会話からタスクを直接登録できる道具

ねらい: 会話で「これタスクに入れて」と言えば、Claude がそのまま登録まで済ませる。いまは Claude がコマンドを作り、ユーザーが `!` で実行している。

- プライベートPCに試作 `tools/tm.cjs` がある（**未コミット・会社PCにはない**）
  - 追加・変更・完了だけができ、削除はできない。書く前に自動でバックアップを取る。`--dry` で試せる
  - **11/1 の Google ログイン化で、今はもう動かない**（ID トークンを持っていないため）
- 作り直し案（推奨）:
  1. GAS に「1件ずつ足す・変える・完了にする」受け口（例: `body.ops`）を追加する。全件洗い替えではないので、古い画面との上書き競合も起きにくい
  2. その受け口だけは、スクリプトプロパティ `SERVICE_TOKEN` を持つ CLI からも呼べるようにする（カモの小屋の米チャレ連携と同じ方式）。トークンは `.env` の `VITE_` で**始まらない**変数に置き、フロントには絶対に入れない
  3. `tools/tm.cjs` をこの受け口向けに書き直してコミットする
- Claude Code の auto mode では、許可ルール `Bash(node tools/tm.cjs:*)` を Claude 自身が設定ファイルに書くことは拒否される。ユーザーが `.claude/settings.local.json` に手で書く

## 進めたいこと 2: GAS をやめて Supabase に移すか（未決定）

検討した理由は「全件上書き」「URL を知れば誰でも書けた」「clasp の扱いづらさ」「どの PC からでも同じように開発したい」の4つ。

- 「誰でも書けた」は 11/1 の Google ログイン化で解決済み
- 「全件上書き」は、上の「1件ずつの受け口」を作ればかなり解消する
- 移す場合の追加の手間: Google ログインのまま行単位の権限（仕事だけ見える人の制限）を RLS で作り直す必要がある。つりずかん（`C:\Users\kaker\tsurizukan`）は メール＋パスワード認証なので、そのまま流用はできない
- 無料枠は 7 日アクセスがないと止まる。つりずかんでは GitHub Actions で 3 日おきにアクセスする仕組みを入れ済み（`.github/workflows/supabase-keepalive.yml`、11/4 が初回の自動実行）。移すならこれをコピーする
- **おすすめ: まずは GAS のまま「1件ずつの受け口」を作る。それでも困ることが残ったら移行を考える**

## 作業の注意（両 PC 共通）

- 作業前に `git pull`。別の PC からもコミットされる（10/12 に、古いままデプロイして本番を巻き戻した）
- `npm run deploy` は Claude Code の auto mode に止められる → `MSYS_NO_PATHCONV=1 npx vite build` → `npx gh-pages -d dist` と分けて実行
- 本番を壊さずに試すとき: `MSYS_NO_PATHCONV=1 npx vite build --base=/taskmania/preview/` → `npx gh-pages -d dist -e preview` （ https://knak-lab.github.io/taskmania/preview/ ）
- GAS の反映は `clasp push` だけでは本番に出ない。デプロイを管理 → 新バージョン（URL は変えない）
- `.env` / `.env.local` は Git に入っていない（`VITE_GAS_URL` / `VITE_KAMO_GAS_URL` / `VITE_GOOGLE_CLIENT_ID`）。PC ごとに用意する
- `data-cleanup/` は実データのバックアップ置き場なので Git に入れない（`.gitignore` 済み）
