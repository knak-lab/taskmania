/**
 * タスクマニア - スプレッドシート連携バックエンド (GAS Web App)
 *
 * シート構成:
 *   Projects: id | owner | name | subcategory | priority | status
 *   Tasks:    id | projectId | name | startDate | endDate | estimatedMinutes
 *   Subtasks: id | taskId | text | done | priority | scheduledDate | startTime | estimatedMinutes | actualMinutes | createdAt | repeatWeekday
 *   Steps:    id | subtaskId | text | done
 *
 * API:
 *   GET  {webAppUrl}            → { projects: [...] } (PJ→タスク→サブタスクのネスト構造。フロント側のprojects stateとそのまま互換)
 *   POST {webAppUrl}            → body: { projects: [...] } を受け取り、3シートを全件書き換え
 *   POST {webAppUrl}            → body: { calendarEvent: { title, date, startTime, estimatedMinutes } } を受け取り、
 *                                  このスクリプトのデフォルトGoogleカレンダーに予定を1件作成する
 *
 * 使い方(初回のみ):
 *   1. Google Sheetsで新規スプレッドシートを作成
 *   2. 拡張機能 > Apps Script を開き、このファイルの内容を貼り付け
 *   3. エディタ上部の関数選択で `setup` を選び、一度実行(初回はアクセス許可を求められるので許可)
 *      → Projects/Tasks/Subtasks の3シートが自動生成される
 *   4. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
 *        実行するユーザー: 自分
 *        アクセスできるユーザー: 全員
 *   5. 発行されたウェブアプリのURLをフロント側の設定に使う
 *
 * 注意(フロント実装時に踏みやすい罠):
 *   - GASのdoPostはCORSのプリフライト(OPTIONS)に対応していないため、
 *     フロントからfetchする際は Content-Type を "text/plain;charset=utf-8" にして送ること
 *     (application/json にするとプリフライトが走って失敗する)
 *   - このスクリプトは日付・時刻列をテキスト形式に固定しているので "2026-07-20" が
 *     自動で日付型に化けてズレる心配はない
 *
 * 既存スプレッドシートを使っている場合の移行手順(Projectsにpriority列を追加した際):
 *   このスクリプトは既存シートに自動で列を追加しないため、既存のProjectsシートの
 *   E1セルに手動で "priority" と入力しておくこと。既存行のE列が空欄でも
 *   読み込み時に既定値2(重要・不急)として扱われるので、値が入っていなくても壊れない。
 *
 * 既存スプレッドシートを使っている場合の移行手順(Projectsにstatus列を追加した際):
 *   同様に既存のProjectsシートのF1セルに手動で "status" と入力しておくこと。
 *   既存行のF列が空欄の場合はstatus未設定(null)として扱われるので、
 *   値が入っていなくても壊れない。
 *
 * 既存スプレッドシートを使っている場合の移行手順(TasksにstartDate/endDate列を追加した際):
 *   既存のTasksシートのD1・E1セルに手動で "startDate" "endDate" と入力しておくこと。
 *   既存行のD・E列が空欄の場合は未設定(null)として扱われるので、
 *   値が入っていなくても壊れない。
 *
 * 既存スプレッドシートを使っている場合の移行手順(TasksにestimatedMinutes列を追加した際):
 *   既存のTasksシートのF1セルに手動で "estimatedMinutes" と入力しておくこと。
 *   既存行のF列が空欄の場合は未設定(null)として扱われ、フロント側でサブタスクの
 *   想定時間合計にフォールバックするので、値が入っていなくても壊れない。
 *
 * 既存スプレッドシートを使っている場合の移行手順(SubtasksにrepeatWeekday列を追加した際):
 *   既存のSubtasksシートのK1セルに手動で "repeatWeekday" と入力しておくこと(0=日〜6=土)。
 *   既存行のK列が空欄の場合は繰り返しなし(null)として扱われるので、値が入っていなくても壊れない。
 *
 * 既存スプレッドシートを使っている場合の移行手順(Projectsに完了事項・ネクストアクション列を追加した際):
 *   既存のProjectsシートのG1・H1セルに手動で "completedNote" "nextAction" と入力しておくこと。
 *   PJごとに1つの現在値として保持する項目で、G・H列を直接編集すればスプレッドシート側から
 *   複数PJをまとめて一括更新できる(次にアプリを開いた時に反映される)。
 *   既存行のG・H列が空欄の場合は未入力として扱われるので、値が入っていなくても壊れない。
 *   (旧・時系列ログ形式の ProjectNotes シートは使用しなくなったが、過去データはそのまま残る)
 *
 * 既存スプレッドシートを使っている場合の移行手順(Projectsにmoyamoya列を追加した際):
 *   既存のProjectsシートのI1セルに手動で "moyamoya" と入力しておくこと。
 *   既存行のI列が空欄の場合はfalse(もやもや未指定)として扱われるので、値が入っていなくても壊れない。
 *
 * 既存スプレッドシートを使っている場合の移行手順(もやもやのフリーテキストメモを端末ローカルからスプレッドシート同期に変更した際):
 *   MoyamoyaNotesシートが自動生成される(setup関数を再実行するか、初回アクセス時に自動作成される)。
 *   移行前に端末のlocalStorageに保存されていたメモは自動移行されないため、必要なものは手動で書き直すこと。
 *
 * 既存スプレッドシートを使っている場合の移行手順(今週・来週の稼働調整を端末ローカルからスプレッドシート同期に変更した際):
 *   WorkAdjustmentsシートが自動生成される(setup関数を再実行するか、初回アクセス時に自動作成される)。
 *   移行前に端末のlocalStorageに保存されていた調整値は自動移行されないため、必要なものは手動で入れ直すこと。
 *
 * 既存スプレッドシートを使っている場合の移行手順(カモの小屋TODO連携用にTasksへsourceTodoId、Subtasksへ
 * sourceSubtaskId/doneUpdatedAtを追加した際):
 *   既存のTasksシートのG1セルに手動で "sourceTodoId" と入力しておくこと。
 *   既存のSubtasksシートのL1・M1セルに手動で "sourceSubtaskId" "doneUpdatedAt" と入力しておくこと。
 *   既存行が空欄の場合はカモの小屋と未連携のタスク/サブタスクとして扱われるので、値が入っていなくても壊れない。
 */

const SHEET_PROJECTS = "Projects";
const SHEET_TASKS = "Tasks";
const SHEET_SUBTASKS = "Subtasks";
const SHEET_STEPS = "Steps";
const SHEET_MOYAMOYA = "MoyamoyaNotes";
const SHEET_WORKADJ = "WorkAdjustments";

const PROJECTS_HEADERS = ["id", "owner", "name", "subcategory", "priority", "status", "completedNote", "nextAction", "moyamoya"];
const TASKS_HEADERS = ["id", "projectId", "name", "startDate", "endDate", "estimatedMinutes", "sourceTodoId", "done"];
const SUBTASKS_HEADERS = [
  "id",
  "taskId",
  "text",
  "done",
  "priority",
  "scheduledDate",
  "startTime",
  "estimatedMinutes",
  "actualMinutes",
  "createdAt",
  "repeatWeekday",
  "sourceSubtaskId",
  "doneUpdatedAt",
];
const STEPS_HEADERS = ["id", "subtaskId", "text", "done"];
const MOYAMOYA_HEADERS = ["id", "text"];
const WORKADJ_HEADERS = ["date", "hours"];

/**
 * Googleカレンダー送信機能の初回権限付与用。エディタの関数選択でこれを選び、
 * 一度だけ手動実行してカレンダーへのアクセスを許可する(実行するとポップアップで
 * 承認画面が出る)。Web App(doPost)側は新しいスコープを自動では要求できないため、
 * この手動実行が必要。
 */
function authorizeCalendarAccess() {
  CalendarApp.getDefaultCalendar();
}

/** 初回セットアップ用。エディタから手動で一度だけ実行する */
function setup() {
  getOrCreateSheet_(SHEET_PROJECTS, PROJECTS_HEADERS);
  getOrCreateSheet_(SHEET_TASKS, TASKS_HEADERS);
  getOrCreateSheet_(SHEET_SUBTASKS, SUBTASKS_HEADERS);
  getOrCreateSheet_(SHEET_STEPS, STEPS_HEADERS);
  getOrCreateSheet_(SHEET_MOYAMOYA, MOYAMOYA_HEADERS);
  getOrCreateSheet_(SHEET_WORKADJ, WORKADJ_HEADERS);
  Logger.log("セットアップ完了: Projects / Tasks / Subtasks / Steps / MoyamoyaNotes / WorkAdjustments シートを用意しました");
}

function doGet(e) {
  const projects = readProjects_();
  const moyamoyaNotes = readMoyamoyaNotes_();
  const workAdj = readWorkAdj_();
  return jsonResponse_({ projects: projects, moyamoyaNotes: moyamoyaNotes, workAdj: workAdj });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    let projectCount = null;
    let moyamoyaCount = null;
    let workAdjCount = null;
    let calendarEventId = null;
    if (body.projects !== undefined) {
      writeProjects_(body.projects || []);
      projectCount = (body.projects || []).length;
    }
    if (body.moyamoyaNotes !== undefined) {
      writeMoyamoyaNotes_(body.moyamoyaNotes || []);
      moyamoyaCount = (body.moyamoyaNotes || []).length;
    }
    if (body.workAdj !== undefined) {
      writeWorkAdj_(body.workAdj || []);
      workAdjCount = (body.workAdj || []).length;
    }
    if (body.calendarEvent !== undefined) {
      calendarEventId = createCalendarEvent_(body.calendarEvent);
    }
    return jsonResponse_({ ok: true, projectCount: projectCount, moyamoyaCount: moyamoyaCount, workAdjCount: workAdjCount, calendarEventId: calendarEventId });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

// サブタスクをGoogleカレンダー(このスクリプトのデフォルトカレンダー)へ予定として送る。
// startTimeがあれば時間指定の予定(想定時間分、なければ30分)、日付だけなら終日予定にする。
function createCalendarEvent_(ev) {
  if (!ev || !ev.date) throw new Error("date is required");
  const title = ev.title || "(無題)";
  const calendar = CalendarApp.getDefaultCalendar();
  if (ev.startTime) {
    const start = new Date(ev.date + "T" + ev.startTime + ":00");
    const minutes = ev.estimatedMinutes && ev.estimatedMinutes > 0 ? ev.estimatedMinutes : 30;
    const end = new Date(start.getTime() + minutes * 60000);
    const event = calendar.createEvent(title, start, end);
    return event.getId();
  }
  const day = new Date(ev.date + "T00:00:00");
  const event = calendar.createAllDayEvent(title, day);
  return event.getId();
}

// ---- 読み込み ----

function readProjects_() {
  const projSheet = getOrCreateSheet_(SHEET_PROJECTS, PROJECTS_HEADERS);
  const taskSheet = getOrCreateSheet_(SHEET_TASKS, TASKS_HEADERS);
  const subSheet = getOrCreateSheet_(SHEET_SUBTASKS, SUBTASKS_HEADERS);
  const stepSheet = getOrCreateSheet_(SHEET_STEPS, STEPS_HEADERS);

  const projRows = getDataRows_(projSheet);
  const taskRows = getDataRows_(taskSheet);
  const subRows = getDataRows_(subSheet);
  const stepRows = getDataRows_(stepSheet);

  const stepsBySubtask = {};
  stepRows.forEach(function (r) {
    const id = r[0],
      subtaskId = r[1],
      text = r[2],
      done = r[3];
    if (!id || !subtaskId) return;
    if (!stepsBySubtask[subtaskId]) stepsBySubtask[subtaskId] = [];
    stepsBySubtask[subtaskId].push({
      id: String(id),
      text: text || "",
      done: done === true || done === "TRUE" || done === "true",
    });
  });

  const subtasksByTask = {};
  subRows.forEach(function (r) {
    const id = r[0],
      taskId = r[1],
      text = r[2],
      done = r[3],
      priority = r[4],
      scheduledDate = r[5],
      startTime = r[6],
      estimatedMinutes = r[7],
      actualMinutes = r[8],
      createdAt = r[9],
      repeatWeekday = r[10],
      sourceSubtaskId = r[11],
      doneUpdatedAt = r[12];
    if (!id || !taskId) return;
    if (!subtasksByTask[taskId]) subtasksByTask[taskId] = [];
    subtasksByTask[taskId].push({
      id: String(id),
      text: text || "",
      done: done === true || done === "TRUE" || done === "true",
      priority: Number(priority) || 2,
      scheduledDate: scheduledDate ? String(scheduledDate) : null,
      startTime: startTime ? String(startTime) : null,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
      actualMinutes: actualMinutes ? Number(actualMinutes) : null,
      createdAt: createdAt ? Number(createdAt) : Date.now(),
      repeatWeekday:
        repeatWeekday === "" || repeatWeekday == null
          ? null
          : repeatWeekday === "weekday" || repeatWeekday === "satsun"
            ? repeatWeekday
            : Number(repeatWeekday),
      steps: stepsBySubtask[id] || [],
      sourceSubtaskId: sourceSubtaskId ? String(sourceSubtaskId) : null,
      doneUpdatedAt: doneUpdatedAt ? Number(doneUpdatedAt) : 0,
    });
  });

  const tasksByProject = {};
  taskRows.forEach(function (r) {
    const id = r[0],
      projectId = r[1],
      name = r[2],
      startDate = r[3],
      endDate = r[4],
      estimatedMinutes = r[5],
      sourceTodoId = r[6],
      done = r[7];
    if (!id || !projectId) return;
    if (!tasksByProject[projectId]) tasksByProject[projectId] = [];
    tasksByProject[projectId].push({
      id: String(id),
      name: name || "",
      startDate: startDate ? String(startDate) : null,
      endDate: endDate ? String(endDate) : null,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
      subtasks: subtasksByTask[id] || [],
      sourceTodoId: sourceTodoId ? String(sourceTodoId) : null,
      done: done === true || done === "TRUE" || done === "true",
    });
  });

  const projects = projRows
    .filter(function (r) {
      return r[0];
    })
    .map(function (r) {
      const id = r[0],
        owner = r[1],
        name = r[2],
        subcategory = r[3],
        priority = r[4],
        status = r[5],
        completedNote = r[6],
        nextAction = r[7],
        moyamoya = r[8];
      return {
        id: String(id),
        owner: owner || "",
        name: name || "",
        subcategory: subcategory || null,
        priority: Number(priority) || 2,
        status: status || null,
        completedNote: completedNote || "",
        nextAction: nextAction || "",
        moyamoya: moyamoya === true || moyamoya === "TRUE" || moyamoya === "true",
        tasks: tasksByProject[id] || [],
      };
    });

  return projects;
}

function readMoyamoyaNotes_() {
  const sheet = getOrCreateSheet_(SHEET_MOYAMOYA, MOYAMOYA_HEADERS);
  const rows = getDataRows_(sheet);
  return rows
    .filter(function (r) {
      return r[0];
    })
    .map(function (r) {
      return { id: String(r[0]), text: r[1] || "" };
    });
}

function readWorkAdj_() {
  const sheet = getOrCreateSheet_(SHEET_WORKADJ, WORKADJ_HEADERS);
  const rows = getDataRows_(sheet);
  return rows
    .filter(function (r) {
      return r[0];
    })
    .map(function (r) {
      return { date: String(r[0]), hours: Number(r[1]) || 0 };
    });
}

// ---- 書き込み(全件洗い替え) ----

function writeMoyamoyaNotes_(notes) {
  const sheet = getOrCreateSheet_(SHEET_MOYAMOYA, MOYAMOYA_HEADERS);
  const rows = (notes || []).map(function (n) {
    return [n.id, n.text || ""];
  });
  writeRowsReplacing_(sheet, rows, MOYAMOYA_HEADERS.length);
}

function writeWorkAdj_(workAdj) {
  const sheet = getOrCreateSheet_(SHEET_WORKADJ, WORKADJ_HEADERS);
  const rows = (workAdj || []).map(function (a) {
    return [a.date, a.hours || 0];
  });
  writeRowsReplacing_(sheet, rows, WORKADJ_HEADERS.length);
}

function writeProjects_(projects) {
  const projSheet = getOrCreateSheet_(SHEET_PROJECTS, PROJECTS_HEADERS);
  const taskSheet = getOrCreateSheet_(SHEET_TASKS, TASKS_HEADERS);
  const subSheet = getOrCreateSheet_(SHEET_SUBTASKS, SUBTASKS_HEADERS);
  const stepSheet = getOrCreateSheet_(SHEET_STEPS, STEPS_HEADERS);

  const projRows = [];
  const taskRows = [];
  const subRows = [];
  const stepRows = [];

  (projects || []).forEach(function (p) {
    projRows.push([p.id, p.owner || "", p.name || "", p.subcategory || "", p.priority || 2, p.status || "", p.completedNote || "", p.nextAction || "", !!p.moyamoya]);
    (p.tasks || []).forEach(function (t) {
      taskRows.push([t.id, p.id, t.name || "", t.startDate || "", t.endDate || "", t.estimatedMinutes || "", t.sourceTodoId || "", !!t.done]);
      (t.subtasks || []).forEach(function (s) {
        subRows.push([
          s.id,
          t.id,
          s.text || "",
          !!s.done,
          s.priority || 2,
          s.scheduledDate || "",
          s.startTime || "",
          s.estimatedMinutes || "",
          s.actualMinutes || "",
          s.createdAt || Date.now(),
          s.repeatWeekday != null ? s.repeatWeekday : "",
          s.sourceSubtaskId || "",
          s.doneUpdatedAt || "",
        ]);
        (s.steps || []).forEach(function (st) {
          stepRows.push([st.id, s.id, st.text || "", !!st.done]);
        });
      });
    });
  });

  writeRowsReplacing_(projSheet, projRows, PROJECTS_HEADERS.length);
  writeRowsReplacing_(taskSheet, taskRows, TASKS_HEADERS.length);
  writeRowsReplacing_(subSheet, subRows, SUBTASKS_HEADERS.length);
  writeRowsReplacing_(stepSheet, stepRows, STEPS_HEADERS.length);
}

// ---- ユーティリティ ----

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  // scheduledDate / startTime 列(Subtasksの6,7列目)をテキスト形式に固定し、
  // "2026-07-20" などが日付型に自動変換されてズレるのを防ぐ
  if (name === SHEET_SUBTASKS) {
    sheet.getRange(2, 6, Math.max(sheet.getMaxRows() - 1, 1), 2).setNumberFormat("@");
  }
  // startDate / endDate 列(Tasksの4,5列目)も同様にテキスト形式に固定
  if (name === SHEET_TASKS) {
    sheet.getRange(2, 4, Math.max(sheet.getMaxRows() - 1, 1), 2).setNumberFormat("@");
  }
  // date列(WorkAdjustmentsの1列目)も同様にテキスト形式に固定
  if (name === SHEET_WORKADJ) {
    sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat("@");
  }
  return sheet;
}

function getDataRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
}

// 既存データ範囲を新データで上書きする(clear→writeの2手順を1回のsetValuesにまとめて
// GAS Sheets APIの呼び出し回数を減らし保存を高速化。新データの方が行数が少ない場合は
// はみ出す旧行を空文字で埋めて消す)
function writeRowsReplacing_(sheet, rows, numCols) {
  const oldDataRowCount = Math.max(sheet.getLastRow() - 1, 0);
  const totalRows = Math.max(oldDataRowCount, rows.length);
  if (totalRows === 0) return;
  const padded = rows.slice();
  for (let i = rows.length; i < totalRows; i++) {
    padded.push(new Array(numCols).fill(""));
  }
  sheet.getRange(2, 1, totalRows, numCols).setValues(padded);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
