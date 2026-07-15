/**
 * タスクマニア - スプレッドシート連携バックエンド (GAS Web App)
 *
 * シート構成:
 *   Projects: id | owner | name | subcategory | priority | status
 *   Tasks:    id | projectId | name | startDate | endDate | estimatedMinutes
 *   Subtasks: id | taskId | text | done | priority | scheduledDate | startTime | estimatedMinutes | actualMinutes | createdAt
 *   Steps:    id | subtaskId | text | done
 *
 * API:
 *   GET  {webAppUrl}            → { projects: [...] } (PJ→タスク→サブタスクのネスト構造。フロント側のprojects stateとそのまま互換)
 *   POST {webAppUrl}            → body: { projects: [...] } を受け取り、3シートを全件書き換え
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
 */

const SHEET_PROJECTS = "Projects";
const SHEET_TASKS = "Tasks";
const SHEET_SUBTASKS = "Subtasks";
const SHEET_STEPS = "Steps";

const PROJECTS_HEADERS = ["id", "owner", "name", "subcategory", "priority", "status"];
const TASKS_HEADERS = ["id", "projectId", "name", "startDate", "endDate", "estimatedMinutes"];
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
];
const STEPS_HEADERS = ["id", "subtaskId", "text", "done"];

/** 初回セットアップ用。エディタから手動で一度だけ実行する */
function setup() {
  getOrCreateSheet_(SHEET_PROJECTS, PROJECTS_HEADERS);
  getOrCreateSheet_(SHEET_TASKS, TASKS_HEADERS);
  getOrCreateSheet_(SHEET_SUBTASKS, SUBTASKS_HEADERS);
  getOrCreateSheet_(SHEET_STEPS, STEPS_HEADERS);
  Logger.log("セットアップ完了: Projects / Tasks / Subtasks / Steps シートを用意しました");
}

function doGet(e) {
  const projects = readProjects_();
  return jsonResponse_({ projects: projects });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const projects = body.projects || [];
    writeProjects_(projects);
    return jsonResponse_({ ok: true, count: projects.length });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
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
      createdAt = r[9];
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
      steps: stepsBySubtask[id] || [],
    });
  });

  const tasksByProject = {};
  taskRows.forEach(function (r) {
    const id = r[0],
      projectId = r[1],
      name = r[2],
      startDate = r[3],
      endDate = r[4],
      estimatedMinutes = r[5];
    if (!id || !projectId) return;
    if (!tasksByProject[projectId]) tasksByProject[projectId] = [];
    tasksByProject[projectId].push({
      id: String(id),
      name: name || "",
      startDate: startDate ? String(startDate) : null,
      endDate: endDate ? String(endDate) : null,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
      subtasks: subtasksByTask[id] || [],
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
        status = r[5];
      return {
        id: String(id),
        owner: owner || "",
        name: name || "",
        subcategory: subcategory || null,
        priority: Number(priority) || 2,
        status: status || null,
        tasks: tasksByProject[id] || [],
      };
    });

  return projects;
}

// ---- 書き込み(全件洗い替え) ----

function writeProjects_(projects) {
  const projSheet = getOrCreateSheet_(SHEET_PROJECTS, PROJECTS_HEADERS);
  const taskSheet = getOrCreateSheet_(SHEET_TASKS, TASKS_HEADERS);
  const subSheet = getOrCreateSheet_(SHEET_SUBTASKS, SUBTASKS_HEADERS);
  const stepSheet = getOrCreateSheet_(SHEET_STEPS, STEPS_HEADERS);

  clearDataRows_(projSheet);
  clearDataRows_(taskSheet);
  clearDataRows_(subSheet);
  clearDataRows_(stepSheet);

  const projRows = [];
  const taskRows = [];
  const subRows = [];
  const stepRows = [];

  (projects || []).forEach(function (p) {
    projRows.push([p.id, p.owner || "", p.name || "", p.subcategory || "", p.priority || 2, p.status || ""]);
    (p.tasks || []).forEach(function (t) {
      taskRows.push([t.id, p.id, t.name || "", t.startDate || "", t.endDate || "", t.estimatedMinutes || ""]);
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
        ]);
        (s.steps || []).forEach(function (st) {
          stepRows.push([st.id, s.id, st.text || "", !!st.done]);
        });
      });
    });
  });

  writeRows_(projSheet, projRows, PROJECTS_HEADERS.length);
  writeRows_(taskSheet, taskRows, TASKS_HEADERS.length);
  writeRows_(subSheet, subRows, SUBTASKS_HEADERS.length);
  writeRows_(stepSheet, stepRows, STEPS_HEADERS.length);
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
  return sheet;
}

function getDataRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
}

function clearDataRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
}

function writeRows_(sheet, rows, numCols) {
  if (rows.length === 0) return;
  sheet.getRange(2, 1, rows.length, numCols).setValues(rows);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
