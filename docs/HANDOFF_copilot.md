# 追加の引き継ぎ: 会社の秘書AI（Copilot Studio）にタスクマニアを読ませる（2026-11-02）

> **⏸ 保留中（2026-11-02 ユーザー判断）: 会社のセキュリティポリシーが絡むため、いったん中止。ユーザーから再開の指示があるまで、この作業には手をつけないこと。**

[HANDOFF.md](HANDOFF.md) の後続作業。HANDOFF.md の作業を先に進めていてよい。
**このリポジトリは公開されている**ので、GAS の URL・トークン・社内の情報はここに書かない。

## やりたいこと

- 会社の Copilot Studio で作っている秘書AI「業務アシスタントβ」（Teams + Microsoft 365 で使う。メール・予定表を見て優先順位をつける）に、タスクマニアのタスクも見せたい
- 見せてよいのは **「kkr > 仕事」だけ**。趣味・家族・もやもや・稼働調整は絶対に出さない
- 秘書AIは **読むだけ**。タスクマニアへの書き込みはさせない

## 方針

GAS に Copilot 専用の「読み取り専用の口」を足す。Copilot Studio からは、エージェントフローの HTTP アクションでこの口を呼ぶ。

```
秘書AI ─ツール─▶ エージェントフロー ─HTTP GET─▶ GAS ?action=copilotWork&key=<合言葉>
                                                  └ 合言葉が合えば「kkr>仕事」の未完了分だけ返す
```

- 合言葉は、スクリプトプロパティ `COPILOT_READ_TOKEN` に置く（32文字以上。作り方は `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`）
  - 未設定ならこの口は閉じたまま（安全側）
  - Google ログインの `ALLOWED_EMAILS` や、カモの小屋の `SERVICE_TOKEN` とは**別の値**にする。漏れても、読めるのは仕事の未完了分だけで済むようにするため
  - 合言葉は**フローの中にだけ**置く。エージェントの指示（プロンプト）には書かない
- 絞り込みは GAS 側で行う。Copilot 側の指示に頼らない
- 返す内容: 今日の日付、未完了の PJ（テーマ名・状態・目標管理対象・依頼元/ねらい・ネクストアクション・担当）、その下の未完了タスク（期間・期限切れフラグ・担当）、未完了サブタスク（予定日・開始時刻・見積・担当）。ステップ・完了済み・メモ類は返さない

## 作業手順

### 1. GAS に口を足す（Claude Code で）

`gas/Code.gs` の `function doGet(e) {` の直前に下のコードを入れ、`doGet` の先頭に分岐を足す。
プライベートPCで書いて構文チェック（`node --check`）まで通したもの。本番には未反映。
`isWorkItem_` / `readProjects_` / `readThemes_` / `unauthorized_` / `jsonResponse_` は既存の関数をそのまま使う。

```js
// =============================================================
//  Copilot Studio（会社の秘書AI）向けの読み取り専用の口
//    GET ?action=copilotWork&key=<COPILOT_READ_TOKEN>
//    「kkr > 仕事」の未完了PJ・タスク・サブタスクだけを返す。書き込みは一切できない。
//    スクリプトプロパティ COPILOT_READ_TOKEN が未設定なら、この口は閉じたまま。
// =============================================================
function copilotKeyOk_(key) {
  const expected = String(PropertiesService.getScriptProperties().getProperty("COPILOT_READ_TOKEN") || "");
  if (expected.length < 32 || typeof key !== "string" || key.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

function copilotWork_() {
  const tz = Session.getScriptTimeZone() || "Asia/Tokyo";
  const today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const themeName = {};
  readThemes_().forEach(function (t) { themeName[t.id] = t.name; });
  const projects = readProjects_()
    .filter(function (p) { return isWorkItem_(p) && p.status !== "done"; })
    .map(function (p) {
      return {
        theme: themeName[p.themeId] || "",
        name: p.name,
        status: p.status || "進行中",
        goalTarget: p.goalTarget,
        purpose: p.purpose,
        nextAction: p.nextAction,
        assignees: p.assignees,
        tasks: (p.tasks || [])
          .filter(function (t) { return !t.done; })
          .map(function (t) {
            return {
              name: t.name,
              startDate: t.startDate,
              endDate: t.endDate,
              overdue: !!(t.endDate && t.endDate < today),
              assignees: t.assignees,
              subtasks: (t.subtasks || [])
                .filter(function (s) { return !s.done; })
                .map(function (s) {
                  return { text: s.text, scheduledDate: s.scheduledDate, startTime: s.startTime, estimatedMinutes: s.estimatedMinutes, assignees: s.assignees };
                }),
            };
          }),
      };
    });
  return { ok: true, today: today, projects: projects };
}
```

`doGet` の先頭（`verifyIdToken_` より前）:

```js
  if (e && e.parameter && e.parameter.action === "copilotWork") {
    if (!copilotKeyOk_(e.parameter.key)) return unauthorized_();
    return jsonResponse_(copilotWork_());
  }
```

- PJ の状態（status）は 空=進行中 / `"hold"`=保留 / `"done"`=完了（`src/App.jsx` 41行目付近）。このコードは保留 PJ も返し、status は `"hold"` のまま渡す。秘書AIに保留を見せたくなければ `p.status !== "done"` を `!p.status` に変える（マップ・ロードマップと同じ扱いになる）
- 反映: `clasp push` → デプロイを管理 → 新バージョン（URL は変えない）。clasp のアカウントの注意は HANDOFF.md を参照
- 確認: 合言葉なし・違う合言葉では `Unauthorized`、正しい合言葉では「kkr>仕事」だけが返ること。**趣味・家族の PJ 名が1件も含まれないこと**を必ず確かめる

### 2. Copilot Studio にツールを足す（ユーザーが画面で操作）

1. 業務アシスタントβ → ツール → 追加 → 新しいツール → **エージェントフロー**
2. トリガー「エージェントがフローを呼び出すとき」（入力なし）
3. アクション **HTTP**: メソッド GET、URI に GAS の URL ＋ `?action=copilotWork&key=<合言葉>`
   - GAS は別の URL へリダイレクトして応答を返す。HTTP アクションがリダイレクトについていくか確認する。だめなら設定でリダイレクトを許可する
4. アクション「エージェントに応答する」: 出力 `tasks`（テキスト）に HTTP の本文（body）を入れる
5. フロー名・説明は「タスクマニアの仕事タスク（未完了）を取得する。今日のタスク・期限切れ・優先対応を判断するときに使う」のように、秘書AIがいつ使うか分かるように書く
6. 保存 → 公開 → プレビューで「今日やることを教えて」と聞いて、タスクマニアの内容が出るか確認する

**つまずきそうな点**
- 会社のデータ損失防止ポリシー（DLP）で、HTTP アクションや外部 URL（script.google.com）への通信が禁止されている可能性がある。選べない・保存できないときは情シスに確認する（ここは Claude では解決できない）
- 会社の仕事データを個人の Google スプレッドシートに置いている点が、社内ルール上問題にならないかも、あわせて確認しておくと安心

### 3. 指示（プロンプト）とスキルに足す文（ユーザーが貼る）

指示の「■ 予定表確認」の後ろあたりに追加:

```
■ タスクマニア（業務タスク）
・業務タスクはツール「タスクマニアの仕事タスク」で取得する。毎朝のサマリー、本日のタスク、優先対応の判断では必ず参照する。
・取得できるのは未完了の業務PJ・タスク・サブタスクのみ。読み取り専用で、登録や変更はできない。登録や変更を頼まれたら、タスクマニアで操作するよう案内する。
・overdue が true のタスクは「持ち越し」として示す。責める表現は使わず、次の一歩を提案する。
・scheduledDate が今日のサブタスクは【本日中のタスク】に入れる。startTime があれば予定表と並べ、会議と重なる場合は指摘する。
・目標管理対象（goalTarget が true）のPJは、他より優先度を一段上げて扱う。
・タスクの内容はツールの結果に書かれたことだけを使い、推測で補わない。
```

スキルの Guidelines に追加:

```
- When summarizing today's work, also call the TaskMania tool and merge its tasks (scheduledDate = today, overdue tasks, next actions) with emails and calendar events into one prioritized plan.
```

## 終わったら

- `docs/HANDOFF_copilot.md` の内容のうち済んだものを書き換えるか、不要になったら消す
- 合言葉を作り直したくなったら、スクリプトプロパティとフローの URI の両方を変える
