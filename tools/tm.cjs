#!/usr/bin/env node
/**
 * タスクマニア CLI — 会話から Claude がタスクを直接登録するための道具
 *
 * GAS の「1件ずつの受け口」（gas/Ops.gs の body.ops）を SERVICE_TOKEN で呼ぶ。
 * 足す・変える・完了にするだけ。削除はできない。書く前に自動でバックアップを取る。
 *
 * 設定（リポジトリ直下の .env か .env.local。どちらも Git には入らない）:
 *   VITE_GAS_URL=https://script.google.com/macros/s/…/exec
 *   TM_SERVICE_TOKEN=…   ← GAS のスクリプトプロパティ SERVICE_TOKEN と同じ値。
 *                          VITE_ で始めないこと（始めるとビルドで公開JSに埋め込まれる）
 *
 * 使い方:
 *   node tools/tm.cjs list [--owner kkr] [--sub 仕事] [--done] [--json]
 *   node tools/tm.cjs add-project --owner kkr --sub 仕事 --name "PJ名" [--priority 1-4]
 *   node tools/tm.cjs add-task --project <PJのidか名前の一部> --name "タスク名" [--start 日付] [--end 日付] [--est 分]
 *   node tools/tm.cjs add-sub --task <タスクのidか名前の一部> [--project …] --text "内容"
 *                              [--date 日付] [--time HH:MM] [--est 分] [--priority 1-4] [--repeat weekday|satsun|daily|0-6]
 *   node tools/tm.cjs update <project|task|subtask> <id> 項目=値 [項目=値 …]
 *   node tools/tm.cjs done <task|subtask> <id> [--undo]
 *   node tools/tm.cjs ops <ops.json>     … ops の配列をそのまま送る
 *   どれにも --dry を付けると、送る内容を表示するだけで書き込まない
 *   日付は YYYY-MM-DD のほか today / tomorrow / +N（N日後）も使える
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'data-cleanup', 'tm-backups');

// ---- 設定 ----

function loadEnv() {
  const env = {};
  for (const name of ['.env', '.env.local']) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return { ...env, ...process.env };
}

function config() {
  const env = loadEnv();
  const url = env.VITE_GAS_URL;
  const token = env.TM_SERVICE_TOKEN;
  if (!url) fail('VITE_GAS_URL が .env にありません');
  if (!token) fail('TM_SERVICE_TOKEN が .env.local にありません（GAS の SERVICE_TOKEN と同じ値）');
  return { url, token };
}

// process.exit は Windows で fetch の後に呼ぶと落ちることがあるので、投げて main で受ける
class CliError extends Error {}
function fail(msg) {
  throw new CliError(msg);
}

// ---- 引数 ----

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opt[key] = true;
      else { opt[key] = next; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function date(v) {
  if (v === undefined || v === true) return undefined;
  const now = new Date();
  if (v === 'today') return ymd(now);
  if (v === 'tomorrow') return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const m = String(v).match(/^\+(\d+)$/);
  if (m) return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(m[1])));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail('日付は YYYY-MM-DD / today / tomorrow / +N: ' + v);
  return v;
}

function num(v) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) fail('数値ではありません: ' + v);
  return n;
}

function required(opt, key) {
  if (opt[key] === undefined || opt[key] === true) fail(`--${key} が必要です`);
  return opt[key];
}

// 値の文字列を、送る型に寄せる（update 用）
function coerce(key, v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === '' || v === 'null') return '';
  if (['scheduledDate', 'startDate', 'endDate', 'repeatEndDate'].includes(key)) return date(v);
  if (['priority', 'estimatedMinutes', 'actualMinutes', 'progressRate'].includes(key)) return num(v);
  if (key === 'assignees') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return v;
}

// ---- 通信 ----

async function call(body) {
  const { url, token } = config();
  // GAS は POST のあと別URLへリダイレクトして結果を返す（fetch が自動で追いかける）
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, service_token: token }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { fail(`GAS の応答が JSON ではありません (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  if (data.error) fail(data.error);
  return data;
}

async function readAll() {
  return call({ read: true });
}

function backup(data) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `tm-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ projects: data.projects, themes: data.themes }, null, 1));
  // 古いバックアップは新しい 30 件だけ残す
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => /^tm-.*\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.unlinkSync(path.join(BACKUP_DIR, f));
  return file;
}

// ---- 名前から id を探す ----

function findProject(projects, key) {
  const exact = projects.find((p) => p.id === key);
  if (exact) return exact;
  const hits = projects.filter((p) => p.name.includes(key));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) fail('PJ が見つかりません: ' + key);
  fail(`PJ「${key}」が複数あります。id で指定してください:\n` + hits.map((p) => `  ${p.id}  ${p.owner}>${p.subcategory || '-'}  ${p.name}`).join('\n'));
}

function findTask(projects, key, projectKey) {
  const scope = projectKey ? [findProject(projects, projectKey)] : projects;
  const all = scope.flatMap((p) => p.tasks.map((t) => ({ p, t })));
  const exact = all.find((x) => x.t.id === key);
  if (exact) return exact.t;
  const hits = all.filter((x) => x.t.name.includes(key) && !x.t.done);
  if (hits.length === 1) return hits[0].t;
  if (hits.length === 0) fail('タスクが見つかりません（完了済みは対象外）: ' + key);
  fail(`タスク「${key}」が複数あります。id か --project で絞ってください:\n` + hits.map((x) => `  ${x.t.id}  [${x.p.name}] ${x.t.name}`).join('\n'));
}

// ---- コマンド ----

function printTree(projects, opt) {
  const showDone = !!opt.done;
  for (const p of projects) {
    if (opt.owner && p.owner !== opt.owner) continue;
    if (opt.sub && (p.subcategory || '') !== opt.sub) continue;
    if (!showDone && p.status === 'done') continue;
    console.log(`■ ${p.id}  ${p.owner}>${p.subcategory || '-'}  ${p.name}${p.status ? `  (${p.status})` : ''}`);
    for (const t of p.tasks) {
      if (!showDone && t.done) continue;
      const span = t.startDate || t.endDate ? `  ${t.startDate || ''}〜${t.endDate || ''}` : '';
      console.log(`  ├ ${t.id}  ${t.done ? '✓ ' : ''}${t.name}${span}`);
      for (const s of t.subtasks) {
        if (!showDone && s.done) continue;
        const when = [s.scheduledDate, s.startTime, s.estimatedMinutes ? s.estimatedMinutes + '分' : ''].filter(Boolean).join(' ');
        console.log(`  │   ・${s.id}  ${s.done ? '✓ ' : ''}${s.text}${when ? '  ' + when : ''}`);
      }
    }
  }
}

async function buildOps(cmd, pos, opt) {
  // 名前で指定されたときだけ、先に読み込んで id を調べる
  const needsLookup =
    (cmd === 'add-task') ||
    (cmd === 'add-sub');
  const data = needsLookup ? await readAll() : null;

  switch (cmd) {
    case 'add-project':
      return [{
        op: 'addProject',
        project: {
          owner: required(opt, 'owner'),
          subcategory: opt.sub === true ? '' : opt.sub,
          name: required(opt, 'name'),
          priority: num(opt.priority),
        },
      }];
    case 'add-task': {
      const p = findProject(data.projects, required(opt, 'project'));
      return [{
        op: 'addTask',
        projectId: p.id,
        task: { name: required(opt, 'name'), startDate: date(opt.start), endDate: date(opt.end), estimatedMinutes: num(opt.est) },
        _label: `[${p.name}] に追加`,
      }];
    }
    case 'add-sub': {
      const t = findTask(data.projects, required(opt, 'task'), opt.project);
      return [{
        op: 'addSubtask',
        taskId: t.id,
        subtask: {
          text: required(opt, 'text'),
          scheduledDate: date(opt.date),
          startTime: opt.time,
          estimatedMinutes: num(opt.est),
          priority: num(opt.priority),
          repeatWeekday: opt.repeat,
        },
        _label: `タスク「${t.name}」に追加`,
      }];
    }
    case 'update': {
      const [kind, id, ...pairs] = pos;
      if (!kind || !id || pairs.length === 0) fail('使い方: update <project|task|subtask> <id> 項目=値 …');
      const fields = {};
      for (const pair of pairs) {
        const i = pair.indexOf('=');
        if (i < 1) fail('項目=値 の形で指定してください: ' + pair);
        const key = pair.slice(0, i);
        fields[key] = coerce(key, pair.slice(i + 1));
      }
      return [{ op: 'update', kind, id, fields }];
    }
    case 'done': {
      const [kind, id] = pos;
      if (!kind || !id) fail('使い方: done <task|subtask> <id> [--undo]');
      return [{ op: 'complete', kind, id, done: !opt.undo }];
    }
    case 'ops': {
      const file = pos[0] || fail('使い方: ops <ops.json>');
      const ops = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(ops)) fail('ops.json は配列にしてください');
      return ops;
    }
    default:
      return null;
  }
}

function stripUndefined(o) {
  return JSON.parse(JSON.stringify(o));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);

  if (!cmd || cmd === 'help' || cmd === '--help') {
    const src = fs.readFileSync(__filename, 'utf8');
    console.log(src.slice(src.indexOf('使い方:'), src.indexOf('*/')).replace(/^ \* ?/gm, ''));
    return;
  }

  if (cmd === 'list') {
    const data = await readAll();
    if (opt.json) console.log(JSON.stringify(data.projects, null, 1));
    else printTree(data.projects, opt);
    return;
  }

  const ops = await buildOps(cmd, pos, opt);
  if (!ops) fail('不明なコマンド: ' + cmd + '（node tools/tm.cjs help）');

  const labels = ops.map((o) => o._label);
  const send = stripUndefined(ops.map(({ _label, ...o }) => o));

  if (opt.dry) {
    console.log('[dry] 送る内容（書き込みません）:');
    send.forEach((o, i) => console.log((labels[i] ? `  # ${labels[i]}\n` : '') + '  ' + JSON.stringify(o)));
    return;
  }

  const before = await readAll();
  const file = backup(before);
  console.log('バックアップ: ' + path.relative(ROOT, file));

  const res = await call({ ops: send });
  let failed = 0;
  res.results.forEach((r, i) => {
    if (r.ok) console.log(`✓ ${r.op}${r.kind ? ' ' + r.kind : ''}  id=${r.id}${r.changed ? '  変更: ' + r.changed.join(', ') : ''}${labels[i] ? '  ' + labels[i] : ''}`);
    else { failed++; console.log(`✗ ${send[i].op}  ${r.error}`); }
  });
  console.log('※ 開いている画面には、再読み込みすると反映されます（古い画面のまま保存すると上書きされるので注意）');
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('エラー: ' + (err && err.message ? err.message : String(err)));
  process.exitCode = 1;
});
