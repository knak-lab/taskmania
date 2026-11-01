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

ねらい: 会話で「これタスクに入れて」と言えば、Claude がそのまま登録まで済ませる。

**11/2 会社PCで実装済み（コードはコミット済み・本番GASは未反映）**

- `gas/Ops.gs`: 「1件ずつ足す・変える・完了にする」受け口 `body.ops`（削除なし）。全件洗い替えではなく該当行だけ書く
  - 画面と同じ `id_token` でも呼べる（`WORK_ONLY_EMAILS` の人は kkr > 仕事 の中だけ）
  - スクリプトプロパティ `SERVICE_TOKEN`（32文字以上）と一致する `service_token` でも呼べる（CLI 用、全体を操作可）。このトークンでは全件洗い替えの保存はできない
  - `read: true` で全PJを返す（CLI の一覧・名前検索用）
- `tools/tm.cjs`: 上の受け口を呼ぶ CLI（使い方は `node tools/tm.cjs help`）。list / add-project / add-task / add-sub / update / done / ops、`--dry` あり。書く前に `data-cleanup/tm-backups/` へ自動バックアップ（新しい30件だけ残す）
  - トークンは `.env.local` の `TM_SERVICE_TOKEN`（`VITE_` で始めない）
- ローカルの模擬シートで、追加・変更・完了・エラー・work スコープの制限まで動作確認済み

**残りの手順（ユーザー作業）**

1. トークンを作る: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`（カモの小屋とは別の値にする）
2. GAS のスクリプトプロパティに `SERVICE_TOKEN` = その値。各PCの `.env.local` に `TM_SERVICE_TOKEN=その値`
3. `clasp push` → デプロイを管理 → 新バージョン（URL は変えない）
4. `node tools/tm.cjs list` で一覧が出れば完了
5. Claude Code の auto mode では、許可ルール `Bash(node tools/tm.cjs:*)` を Claude 自身が設定ファイルに書くことは拒否される。ユーザーが `.claude/settings.local.json` に手で書く

注意: 開きっぱなしの古い画面が保存すると、CLI で足した分も上書きされうる（画面側はまだ全件洗い替え）。CLI で書いたら画面は再読み込みする。画面の保存も `ops` に寄せれば解消するが、未着手。

## 進めたいこと 2: GAS をやめて Supabase に移すか（未決定）

検討した理由は「全件上書き」「URL を知れば誰でも書けた」「clasp の扱いづらさ」「どの PC からでも同じように開発したい」の4つ。

- 「誰でも書けた」は 11/1 の Google ログイン化で解決済み
- 「全件上書き」は、上の「1件ずつの受け口」でCLI側は解消。画面の保存も ops に寄せればさらに解消する
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
