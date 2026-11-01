/**
 * タスクマニア - 1件ずつの受け口（body.ops）
 *
 * 全件洗い替え（body.projects）と違い、指定した行だけを足す・変える。
 * 開きっぱなしの古い画面がなくても、他の端末で足した分を消さずに済む。
 * 削除はできない（消したいときは画面から）。
 *
 * POST body:
 *   { id_token | service_token, ops: [ ... ], read: true(任意) }
 *   read: true なら、処理のあとの全PJ（GETと同じ形）を projects で返す。ops は空でもよい。
 *
 * ops の種類:
 *   { op: "addProject", project: { owner, subcategory, name, priority, ... } }
 *   { op: "addTask",    projectId, task: { name, startDate, endDate, estimatedMinutes, assignees } }
 *   { op: "addSubtask", taskId, subtask: { text, scheduledDate, startTime, estimatedMinutes, priority, ... } }
 *   { op: "update",     kind: "project"|"task"|"subtask", id, fields: { ... } }
 *   { op: "complete",   kind: "task"|"subtask", id, done: true|false(省略時 true) }
 *   id は省略するとサーバーで振る。返り値の results[i].id で分かる。
 *   同じ ops の中で、前の op で足したPJ/タスクの id を後の op で使ってよい。
 *
 * 認証:
 *   - id_token: 画面と同じ。WORK_ONLY_EMAILS の人は kkr > 仕事 のPJの中だけ操作できる
 *   - service_token: スクリプトプロパティ SERVICE_TOKEN と一致すれば全体を操作できる（CLI用）
 */

const OPS_MAX_ = 100;

// 変更してよい項目と、シートに書くときの変換（writeProjects_ と同じ書き方にそろえる）
// Code.gs の定数を使うので、ファイルの読み込み順に左右されないよう関数にしておく
function opsSpec_() {
  return {
  project: {
    sheet: SHEET_PROJECTS,
    headers: PROJECTS_HEADERS,
    fields: {
      owner: str_, subcategory: str_, name: str_, priority: priority_, status: str_,
      completedNote: str_, nextAction: str_, moyamoya: bool_, progressRate: numOrBlank_,
      themeId: str_, purpose: str_, relatedLink: str_, goalTarget: bool_, assignees: list_,
    },
    column: { assignees: "assignee" },
  },
  task: {
    sheet: SHEET_TASKS,
    headers: TASKS_HEADERS,
    fields: {
      name: str_, startDate: date_, endDate: date_, estimatedMinutes: numOrBlank_, done: bool_, assignees: list_,
    },
    column: { assignees: "assignee" },
  },
  subtask: {
    sheet: SHEET_SUBTASKS,
    headers: SUBTASKS_HEADERS,
    fields: {
      text: str_, done: bool_, priority: priority_, scheduledDate: date_, startTime: time_,
      estimatedMinutes: numOrBlank_, actualMinutes: numOrBlank_, repeatWeekday: repeat_,
      repeatEndDate: date_, assignees: list_,
    },
    column: { assignees: "assignee" },
  },
  };
}

function str_(v) { return v == null ? "" : String(v); }
function bool_(v) { return v === true || v === "true" || v === "TRUE" || v === 1 || v === "1"; }
function list_(v) { return (Array.isArray(v) ? v : String(v || "").split(",")).map(function (s) { return String(s).trim(); }).filter(Boolean).join(","); }
function priority_(v) {
  const n = Number(v);
  if ([1, 2, 3, 4].indexOf(n) < 0) throw new Error("priority は 1〜4: " + v);
  return n;
}
function numOrBlank_(v) {
  if (v === "" || v == null) return "";
  const n = Number(v);
  if (!isFinite(n) || n < 0) throw new Error("数値ではありません: " + v);
  return n;
}
function date_(v) {
  if (v === "" || v == null) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error("日付は YYYY-MM-DD: " + v);
  return String(v);
}
function time_(v) {
  if (v === "" || v == null) return "";
  if (!/^\d{2}:\d{2}$/.test(String(v))) throw new Error("時刻は HH:MM: " + v);
  return String(v);
}
function repeat_(v) {
  if (v === "" || v == null) return "";
  if (/^[0-6]$/.test(String(v))) return Number(v);
  if (["weekday", "satsun", "daily"].indexOf(String(v)) >= 0) return String(v);
  throw new Error("repeatWeekday は 0〜6 / weekday / satsun / daily: " + v);
}

function opsUid_() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---- シートの読み書き（行単位） ----

function OpsTable_(kind) {
  const spec = opsSpec_()[kind];
  const sheet = getOrCreateSheet_(spec.sheet, spec.headers);
  const rows = getDataRows_(sheet);
  const rowById = {};
  rows.forEach(function (r, i) { if (r[0]) rowById[String(r[0])] = i + 2; });
  return { kind: kind, spec: spec, sheet: sheet, rows: rows, rowById: rowById };
}

function colOf_(spec, field) {
  const name = (spec.column && spec.column[field]) || field;
  const idx = spec.headers.indexOf(name);
  if (idx < 0) throw new Error("列がありません: " + name);
  return idx + 1;
}

function cellValue_(table, id, field) {
  const row = table.rowById[id];
  return row ? table.sheet.getRange(row, colOf_(table.spec, field)).getValue() : undefined;
}

function appendRow_(table, values) {
  const sheet = table.sheet;
  const row = Math.max(sheet.getLastRow(), 1) + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 50);
  // 日付・時刻の列は、書く前にテキスト形式にしておく（日付型に化けないように）
  table.spec.headers.forEach(function (h, i) {
    if (["scheduledDate", "startTime", "startDate", "endDate", "repeatEndDate"].indexOf(h) >= 0) {
      sheet.getRange(row, i + 1).setNumberFormat("@");
    }
  });
  sheet.getRange(row, 1, 1, table.spec.headers.length).setValues([values]);
  table.rowById[String(values[0])] = row;
}

function setFields_(table, id, fields, allowed) {
  const row = table.rowById[id];
  if (!row) throw new Error(table.kind + " が見つかりません: " + id);
  const keys = Object.keys(fields || {});
  if (keys.length === 0) throw new Error("fields が空です");
  keys.forEach(function (k) {
    if (!table.spec.fields[k] || (allowed && allowed.indexOf(k) < 0)) throw new Error(table.kind + " の " + k + " は変更できません");
    table.sheet.getRange(row, colOf_(table.spec, k)).setValue(table.spec.fields[k](fields[k]));
  });
  return keys;
}

// ---- 見える範囲（work スコープ） ----

function projectIdOfTask_(ctx, taskId) {
  return String(cellValue_(ctx.tasks, taskId, "projectId") || "");
}
function projectIdOfSubtask_(ctx, subId) {
  const taskId = String(ctx.subtasks.sheet.getRange(ctx.subtasks.rowById[subId], 2).getValue() || "");
  return projectIdOfTask_(ctx, taskId);
}
function assertProjectInScope_(ctx, projectId) {
  if (!ctx.projects.rowById[projectId]) throw new Error("PJ が見つかりません: " + projectId);
  if (ctx.scope !== "work") return;
  const owner = cellValue_(ctx.projects, projectId, "owner");
  const sub = cellValue_(ctx.projects, projectId, "subcategory");
  if (owner !== WORK_OWNER || sub !== WORK_SUB) throw new Error("このPJは操作できません: " + projectId);
}

// ---- 本体 ----

function applyOps_(ops, scope) {
  if (!Array.isArray(ops)) throw new Error("ops は配列で送ってください");
  if (ops.length > OPS_MAX_) throw new Error("ops は一度に " + OPS_MAX_ + " 件まで");
  const ctx = {
    scope: scope,
    projects: OpsTable_("project"),
    tasks: OpsTable_("task"),
    subtasks: OpsTable_("subtask"),
  };
  return ops.map(function (o, i) {
    try {
      return Object.assign({ ok: true }, applyOp_(ctx, o || {}));
    } catch (err) {
      // 1件失敗しても、それより前に書いた分はそのまま。後ろの op は続けて処理する
      return { ok: false, index: i, error: String(err && err.message ? err.message : err) };
    }
  });
}

// doPost から呼ばれる（ロックは取得済み）
function handleOps_(body, scope) {
  const results = body.ops !== undefined ? applyOps_(body.ops, scope) : [];
  const res = { ok: results.every(function (r) { return r.ok; }), results: results };
  if (body.read === true) {
    const projects = readProjects_();
    res.projects = scope === "work" ? projects.filter(isWorkItem_) : projects;
    res.themes = scope === "work" ? readThemes_().filter(isWorkItem_) : readThemes_();
  }
  return jsonResponse_(res);
}

function applyOp_(ctx, o) {
  switch (o.op) {
    case "addProject": {
      const p = o.project || {};
      if (!p.name) throw new Error("project.name は必須");
      const owner = ctx.scope === "work" ? WORK_OWNER : str_(p.owner);
      const sub = ctx.scope === "work" ? WORK_SUB : str_(p.subcategory);
      if (!owner) throw new Error("project.owner は必須");
      const id = p.id ? String(p.id) : opsUid_();
      if (ctx.projects.rowById[id]) throw new Error("同じ id のPJがあります: " + id);
      appendRow_(ctx.projects, [
        id, owner, str_(p.name), sub, p.priority != null ? priority_(p.priority) : 2, str_(p.status),
        str_(p.completedNote), str_(p.nextAction), bool_(p.moyamoya), numOrBlank_(p.progressRate),
        str_(p.themeId), str_(p.purpose), str_(p.relatedLink), bool_(p.goalTarget), list_(p.assignees),
      ]);
      return { op: o.op, id: id };
    }
    case "addTask": {
      const t = o.task || {};
      const projectId = String(o.projectId || "");
      assertProjectInScope_(ctx, projectId);
      if (!t.name) throw new Error("task.name は必須");
      const id = t.id ? String(t.id) : opsUid_();
      if (ctx.tasks.rowById[id]) throw new Error("同じ id のタスクがあります: " + id);
      appendRow_(ctx.tasks, [
        id, projectId, str_(t.name), date_(t.startDate), date_(t.endDate), numOrBlank_(t.estimatedMinutes),
        "", bool_(t.done), list_(t.assignees),
      ]);
      return { op: o.op, id: id };
    }
    case "addSubtask": {
      const s = o.subtask || {};
      const taskId = String(o.taskId || "");
      if (!ctx.tasks.rowById[taskId]) throw new Error("タスクが見つかりません: " + taskId);
      assertProjectInScope_(ctx, projectIdOfTask_(ctx, taskId));
      if (!s.text) throw new Error("subtask.text は必須");
      const id = s.id ? String(s.id) : opsUid_();
      if (ctx.subtasks.rowById[id]) throw new Error("同じ id のサブタスクがあります: " + id);
      const now = Date.now();
      appendRow_(ctx.subtasks, [
        id, taskId, str_(s.text), bool_(s.done), s.priority != null ? priority_(s.priority) : 2,
        date_(s.scheduledDate), time_(s.startTime), numOrBlank_(s.estimatedMinutes), numOrBlank_(s.actualMinutes),
        now, repeat_(s.repeatWeekday), "", bool_(s.done) ? now : "", date_(s.repeatEndDate), list_(s.assignees),
      ]);
      return { op: o.op, id: id };
    }
    case "update":
    case "complete": {
      const kind = o.kind;
      const table = { project: ctx.projects, task: ctx.tasks, subtask: ctx.subtasks }[kind];
      if (!table) throw new Error("kind は project / task / subtask");
      const id = String(o.id || "");
      if (!table.rowById[id]) throw new Error(kind + " が見つかりません: " + id);
      const projectId = kind === "project" ? id : kind === "task" ? projectIdOfTask_(ctx, id) : projectIdOfSubtask_(ctx, id);
      assertProjectInScope_(ctx, projectId);

      let fields = o.fields || {};
      if (o.op === "complete") {
        if (kind === "project") throw new Error("PJ は complete できません（status を update してください）");
        fields = { done: o.done === undefined ? true : bool_(o.done) };
      }
      // work スコープの人は、PJを kkr > 仕事 の外へ出せない
      const allowed = ctx.scope === "work" && kind === "project"
        ? Object.keys(table.spec.fields).filter(function (k) { return k !== "owner" && k !== "subcategory"; })
        : null;
      const changed = setFields_(table, id, fields, allowed);
      // サブタスクの完了を変えたら、カモの小屋との同期用に doneUpdatedAt も更新する
      if (kind === "subtask" && changed.indexOf("done") >= 0) {
        table.sheet.getRange(table.rowById[id], colOf_(table.spec, "doneUpdatedAt")).setValue(Date.now());
      }
      return { op: o.op, kind: kind, id: id, changed: changed };
    }
    default:
      throw new Error("不明な op: " + o.op);
  }
}
