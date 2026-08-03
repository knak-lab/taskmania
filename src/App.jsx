import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { loadAppData, loadKamoTodos, saveProjects as gasSave, saveMoyamoyaNotes as gasSaveMoyamoyaNotes, saveWorkAdj as gasSaveWorkAdj, sendToCalendar as gasSendToCalendar } from "./api/gas";

const TOP_TABS = [
  { key: "総合", label: "総合", color: "#2C3645" },
  { key: "家族", label: "家族", color: "#6B7F6E" },
  { key: "kkr", label: "kkr", color: "#12314F" },
  { key: "acco", label: "acco", color: "#F39800" },
];

const PERSON_KEYS = ["kkr", "acco"];
const SUB_TABS = [
  { key: "総合", label: "総合" },
  { key: "仕事", label: "仕事", color: "#8B6F3E" },
  { key: "趣味", label: "趣味", color: "#F39800" },
  { key: "研鑽", label: "研鑽", color: "#12314F" },
];
const REAL_SUBS = SUB_TABS.slice(1);

const PRIORITIES = [
  { v: 1, label: "急", color: "#F39800" },
  { v: 2, label: "並", color: "#12314F" },
  { v: 3, label: "低", color: "#7A7A7A" },
];

const PJ_PRIORITIES = [
  { v: 1, label: "重要・緊急", color: "#F39800" },
  { v: 2, label: "重要・不急", color: "#8B6F3E" },
  { v: 3, label: "軽微・緊急", color: "#12314F" },
  { v: 4, label: "軽微・不急", color: "#7A7A7A" },
];

const PJ_STATUSES = [
  { v: "done", label: "完了", color: "#6B7F6E" },
  { v: "hold", label: "保留", color: "#9B9B9B" },
];

const MOYAMOYA_COLOR = "#8E6FA8";

const MINUTE_OPTIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 15);
const WORK_MINUTES = 8 * 60;

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, "0");
  const m = String((i % 4) * 15).padStart(2, "0");
  return `${h}:${m}`;
});

function TimeDropdown({ value, onChange, style }) {
  const [open, setOpen] = useState(false);
  const noonRef = useRef(null);

  useEffect(() => {
    if (open && noonRef.current) {
      noonRef.current.scrollIntoView({ block: "start" });
    }
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...styles.scheduleEditInput, ...style, textAlign: "left", cursor: "pointer" }}
      >
        {value || "―"}
      </button>
      {open && (
        <div style={styles.timeDropdownList}>
          <div
            onClick={() => { onChange(""); setOpen(false); }}
            style={{ ...styles.timeDropdownItem, fontWeight: 700, color: "#F39800" }}
          >
            ― (未設定)
          </div>
          {TIME_OPTIONS.map((tm) => (
            <div
              key={tm}
              ref={tm === "12:00" ? noonRef : null}
              onClick={() => { onChange(tm); setOpen(false); }}
              style={{
                ...styles.timeDropdownItem,
                background: tm === value ? "#2C3645" : "transparent",
                color: tm === value ? "#FFFFFF" : "#2C3645",
              }}
            >
              {tm}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function sub(text, done, priority, scheduledDate, startTime, estimatedMinutes, actualMinutes) {
  return {
    id: uid(),
    text,
    done,
    priority,
    scheduledDate: scheduledDate || null,
    startTime: startTime || null,
    estimatedMinutes: estimatedMinutes || null,
    actualMinutes: actualMinutes || null,
    createdAt: Date.now(),
    steps: [],
  };
}

function step(text) {
  return { id: uid(), text, done: false };
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}

function formatDuration(mins) {
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}時間${m}分`;
  if (h) return `${h}時間`;
  return `${m}分`;
}

function addMinutesToTime(time, minutes) {
  if (!time || !minutes) return "";
  const [h, m] = time.split(":").map(Number);
  const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function task(name, subtasks, startDate, endDate, estimatedMinutes) {
  return { id: uid(), name, subtasks, startDate: startDate || null, endDate: endDate || null, estimatedMinutes: estimatedMinutes || null, done: false };
}

function project(owner, name, tasks, subcategory, priority) {
  return { id: uid(), owner, name, tasks, subcategory: subcategory || null, priority: priority || 2, completedNote: "", nextAction: "", moyamoya: false };
}

// カモの小屋のTODO(あっこ/かける担当のサブタスクを含む親TODO)を、家族タブの
// 既存「カモの小屋」PJに同期する。内容(タスク名・サブタスク名)はカモ側が正、
// 完了状態(done)はタイムスタンプが新しい方が勝つ双方向。削除は行わない。
const KAMO_PROJECT_ID = "mrv5lsgyl1o3t";
const KAMO_SYNC_ASSIGNEES = ["あっこ", "かける"];

function mergeKamoSync(projects, kamoTodos, kamoSubtasks) {
  const kamoProject = projects.find((p) => p.id === KAMO_PROJECT_ID)
    || projects.find((p) => p.owner === "家族" && p.name === "カモの小屋");
  if (!kamoProject) return projects;

  const kamoSubsByTodo = {};
  (kamoSubtasks || []).forEach((s) => {
    if (!KAMO_SYNC_ASSIGNEES.includes(s.assignee)) return;
    (kamoSubsByTodo[s.parentTaskId] ||= []).push(s);
  });

  const qualifyingTodos = (kamoTodos || []).filter((t) => (kamoSubsByTodo[t.id] || []).length > 0);
  if (qualifyingTodos.length === 0) return projects;

  let changed = false;
  const existingTasks = kamoProject.tasks || [];
  const nextTasks = existingTasks.map((t) => ({ ...t, subtasks: t.subtasks.map((s) => ({ ...s })) }));

  qualifyingTodos.forEach((todo) => {
    let t = nextTasks.find((tt) => tt.sourceTodoId === todo.id);
    if (!t) {
      t = task(todo.task, [], null, null, null);
      t.sourceTodoId = todo.id;
      nextTasks.push(t);
      changed = true;
    } else if (t.name !== todo.task) {
      t.name = todo.task;
      changed = true;
    }

    kamoSubsByTodo[todo.id].forEach((kamoSub) => {
      const wantText = `【${kamoSub.assignee}】${kamoSub.name}`;
      let s = t.subtasks.find((ss) => ss.sourceSubtaskId === kamoSub.id);
      if (!s) {
        s = sub(wantText, kamoSub.status === "完了", 2, null, null, null, null);
        s.sourceSubtaskId = kamoSub.id;
        s.doneUpdatedAt = kamoSub.statusUpdatedAt || Date.now();
        t.subtasks.push(s);
        changed = true;
        return;
      }
      if (s.text !== wantText) {
        s.text = wantText;
        changed = true;
      }
      const kamoUpdatedAt = kamoSub.statusUpdatedAt || 0;
      if (kamoUpdatedAt > (s.doneUpdatedAt || 0)) {
        const wantDone = kamoSub.status === "完了";
        if (s.done !== wantDone) {
          s.done = wantDone;
          changed = true;
        }
        s.doneUpdatedAt = kamoUpdatedAt;
      }
    });
  });

  if (!changed) return projects;
  return projects.map((p) => (p.id === kamoProject.id ? { ...p, tasks: nextTasks } : p));
}

function seedProjects() {
  return [
    project("kkr", "サンプルPJ", [
      task("サンプルタスク", [
        sub("サブタスクA", false, 2),
        sub("サブタスクB", false, 1),
      ]),
    ], "研鑽"),
  ];
}

function countSubtasks(items) {
  let done = 0, total = 0;
  for (const t of items) { total += 1; if (t.done) done += 1; }
  return { done, total };
}

function taskProgress(t) { return countSubtasks(t.subtasks); }

// タスク自体がdone、またはサブタスクに未完了が無い(0件含む)場合に「実質完了」とみなす
function taskEffectivelyDone(t) {
  return !!t.done || !t.subtasks.some((s) => !s.done);
}

function taskEstimatedSubtotal(t) {
  return t.subtasks.reduce((sum, s) => sum + (s.estimatedMinutes || 0), 0);
}

function taskActualSubtotal(t) {
  return t.subtasks.reduce((sum, s) => sum + (s.actualMinutes || 0), 0);
}

function taskEstimatedEffective(t) {
  return t.estimatedMinutes != null ? t.estimatedMinutes : taskEstimatedSubtotal(t);
}

// 過去の予定日は実績時間、未来(今日以降)の予定日は想定時間で集計する(ダッシュボード用)
function subEffectiveMinutes(s, todayStr) {
  return s.scheduledDate >= todayStr ? (s.estimatedMinutes || 0) : (s.actualMinutes || 0);
}

function pjProgress(p) {
  let done = 0, total = 0;
  for (const t of p.tasks) {
    const r = taskProgress(t);
    done += r.done;
    total += r.total;
  }
  return { done, total };
}

// PJ内に未完了タスク・未完了サブタスクがどちらも無い(=やり残しが無い)場合にtrue
function pjEffectivelyDone(p) {
  return p.tasks.length > 0 && p.tasks.every(taskEffectivelyDone);
}

const GRANULARITIES = [
  { key: "day", label: "日" },
  { key: "week", label: "週" },
  { key: "month", label: "月" },
  { key: "quarter", label: "四半期" },
  { key: "year", label: "年" },
];

function startOfWeek(d) {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

function isWeekdayStr(dateStr) {
  const day = new Date(dateStr + "T00:00:00").getDay();
  return day >= 1 && day <= 5;
}

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const MON_FIRST_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

function addMonthsStr(dateStr, months) {
  const [y, m] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// 月表示用に、その月を含む週の月曜始まりを7日区切りで敷き詰めた日付一覧を返す(前後月の日付も含む)
function monthGridDates(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  const firstOfMonth = new Date(y, m - 1, 1);
  const lastOfMonth = new Date(y, m, 0);
  const gridStart = startOfWeek(firstOfMonth);
  const gridEnd = startOfWeek(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + 6);
  const dates = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) dates.push(toDateStr(d));
  return dates;
}

function timeToMinutes(time) {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function nthWeekdayOfMonth(year, month, weekday, nth) {
  const d = new Date(year, month - 1, 1);
  let count = 0;
  while (d.getMonth() === month - 1) {
    if (d.getDay() === weekday) {
      count += 1;
      if (count === nth) return toDateStr(d);
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

function equinoxDateStr(year, season) {
  const base = season === "spring" ? 20.8431 : 23.2488;
  const day = Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const month = season === "spring" ? 3 : 9;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// 固定日・ハッピーマンデー・春分秋分から日本の祝日を算出し、振替休日/国民の休日も補う
function japanHolidaysOfYear(year) {
  const map = {
    [`${year}-01-01`]: "元日",
    [`${year}-02-11`]: "建国記念の日",
    [`${year}-02-23`]: "天皇誕生日",
    [`${year}-04-29`]: "昭和の日",
    [`${year}-05-03`]: "憲法記念日",
    [`${year}-05-04`]: "みどりの日",
    [`${year}-05-05`]: "こどもの日",
    [`${year}-08-11`]: "山の日",
    [`${year}-11-03`]: "文化の日",
    [`${year}-11-23`]: "勤労感謝の日",
    [nthWeekdayOfMonth(year, 1, 1, 2)]: "成人の日",
    [nthWeekdayOfMonth(year, 7, 1, 3)]: "海の日",
    [nthWeekdayOfMonth(year, 9, 1, 3)]: "敬老の日",
    [nthWeekdayOfMonth(year, 10, 1, 2)]: "スポーツの日",
    [equinoxDateStr(year, "spring")]: "春分の日",
    [equinoxDateStr(year, "autumn")]: "秋分の日",
  };
  for (const dstr of Object.keys(map)) {
    if (new Date(dstr + "T00:00:00").getDay() === 0) {
      let sub = dstr;
      do { sub = addDaysStr(sub, 1); } while (map[sub]);
      map[sub] = map[sub] || "振替休日";
    }
  }
  for (const dstr of Object.keys(map)) {
    const mid = addDaysStr(dstr, 1);
    const after = addDaysStr(dstr, 2);
    if (!map[mid] && map[after] && new Date(mid + "T00:00:00").getDay() !== 0) {
      map[mid] = "国民の休日";
    }
  }
  return map;
}

const _holidayCache = {};
function isJapanHoliday(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  if (!_holidayCache[year]) _holidayCache[year] = japanHolidaysOfYear(year);
  return !!_holidayCache[year][dateStr];
}

function isWeekendOrHoliday(dateStr) {
  const day = new Date(dateStr + "T00:00:00").getDay();
  return day === 0 || day === 6 || isJapanHoliday(dateStr);
}

function nextWeekdayOnOrAfter(dateStr, weekday) {
  let d = dateStr;
  while (new Date(d + "T00:00:00").getDay() !== weekday) d = addDaysStr(d, 1);
  return d;
}

function nextBusinessDayOnOrAfter(dateStr) {
  let d = dateStr;
  while (isWeekendOrHoliday(d)) d = addDaysStr(d, 1);
  return d;
}

// 次回発生日を計算。weekdayが"weekday"なら平日(月~金・祝日除く)を繰り返す。shiftHolidayがtrueなら祝日・土日の場合1日ずつ後ろへずらす
function computeNextRecurrenceDate(currentDateStr, weekday, shiftHoliday) {
  if (weekday === "weekday") {
    return nextBusinessDayOnOrAfter(addDaysStr(currentDateStr, 1));
  }
  if (weekday === "satsun") {
    let d = addDaysStr(currentDateStr, 1);
    while (![0, 6].includes(new Date(d + "T00:00:00").getDay())) d = addDaysStr(d, 1);
    return d;
  }
  let next = nextWeekdayOnOrAfter(addDaysStr(currentDateStr, 1), weekday);
  if (shiftHoliday) {
    while (isWeekendOrHoliday(next)) next = addDaysStr(next, 1);
  }
  return next;
}

function bucketKeyFor(dateStr, granularity) {
  const d = new Date(dateStr + "T00:00:00");
  if (granularity === "day") return dateStr;
  if (granularity === "week") return toDateStr(startOfWeek(d));
  if (granularity === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (granularity === "quarter") return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  return `${d.getFullYear()}`;
}

function bucketLabel(key, granularity) {
  if (granularity === "day") return formatDate(key);
  if (granularity === "week") { const [, m, d] = key.split("-").map(Number); return `${m}/${d}`; }
  if (granularity === "month") { const [y, m] = key.split("-").map(Number); return `${y}/${m}`; }
  if (granularity === "quarter") return key.replace("-", " ");
  return `${key}年`;
}

function generateBuckets(allStart, allEnd, granularity) {
  const buckets = [];
  if (granularity === "day") {
    for (let d = new Date(allStart + "T00:00:00"); d <= new Date(allEnd + "T00:00:00"); d.setDate(d.getDate() + 1)) {
      buckets.push(toDateStr(d));
    }
  } else if (granularity === "week") {
    let cur = startOfWeek(new Date(allStart + "T00:00:00"));
    const endW = startOfWeek(new Date(allEnd + "T00:00:00"));
    while (cur <= endW) { buckets.push(toDateStr(cur)); cur.setDate(cur.getDate() + 7); }
  } else if (granularity === "month") {
    let y = Number(allStart.slice(0, 4)), m = Number(allStart.slice(5, 7));
    const ey = Number(allEnd.slice(0, 4)), em = Number(allEnd.slice(5, 7));
    while (y < ey || (y === ey && m <= em)) {
      buckets.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
  } else if (granularity === "quarter") {
    let y = Number(allStart.slice(0, 4)), q = Math.floor((Number(allStart.slice(5, 7)) - 1) / 3) + 1;
    const ey = Number(allEnd.slice(0, 4)), eq = Math.floor((Number(allEnd.slice(5, 7)) - 1) / 3) + 1;
    while (y < ey || (y === ey && q <= eq)) {
      buckets.push(`${y}-Q${q}`);
      q += 1; if (q > 4) { q = 1; y += 1; }
    }
  } else {
    let y = Number(allStart.slice(0, 4)); const ey = Number(allEnd.slice(0, 4));
    while (y <= ey) { buckets.push(`${y}`); y += 1; }
  }
  return buckets;
}

function GanttChart({ project }) {
  const [granularity, setGranularity] = useState("day");
  const rows = [];
  for (const t of project.tasks) {
    if (!t.startDate || !t.endDate) continue;
    const { done, total } = taskProgress(t);
    const minPriorityVal = t.subtasks.length ? Math.min(...t.subtasks.map((s) => s.priority || 2)) : 2;
    const pInfo = PRIORITIES.find((pr) => pr.v === minPriorityVal) || PRIORITIES[1];
    rows.push({ id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate, done, total, color: pInfo.color });
  }
  const today = new Date(); const todayStr = toDateStr(today);
  const yearLater = new Date(); yearLater.setDate(yearLater.getDate() + 365);
  const yearLaterStr = toDateStr(yearLater);
  const taskDates = rows.flatMap((r) => [r.startDate, r.endDate]);
  const allDates = [todayStr, yearLaterStr, ...taskDates].sort();
  const buckets = generateBuckets(allDates[0], allDates[allDates.length - 1], granularity);
  const rowsSorted = [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const colWidth = { day: 34, week: 46, month: 52, quarter: 60, year: 56 }[granularity];

  return (
    <div style={styles.ganttWrap}>
      <div style={styles.ganttToolbar}>
        <div style={styles.granularityGroup}>
          {GRANULARITIES.map((g) => (
            <button type="button" key={g.key} onClick={() => setGranularity(g.key)}
              style={{ ...styles.granularityBtn, background: granularity === g.key ? "#2C3645" : "transparent", color: granularity === g.key ? "#FFFFFF" : "#2C3645" }}>
              {g.label}
            </button>
          ))}
        </div>
        <div style={styles.ganttLegend}>
          {PRIORITIES.map((p) => (
            <span key={p.v} style={styles.ganttLegendItem}>
              <span style={{ ...styles.ganttLegendDot, background: p.color }} />{p.label}
            </span>
          ))}
        </div>
      </div>
      {rowsSorted.length === 0 && <p style={styles.ganttEmpty}>開始日・終了日が設定されたタスクがまだない。</p>}
      <div style={styles.ganttSplitWrap}>
        <div style={styles.ganttLabelCol}>
          <div style={styles.ganttLabelHeaderCell} />
          {rowsSorted.map((r) => <div key={r.id} style={styles.ganttLabelCell} title={r.name}>{r.name}</div>)}
        </div>
        <div style={styles.ganttScroll}>
          <div style={{ ...styles.ganttGrid, gridTemplateColumns: `repeat(${buckets.length}, ${colWidth}px)`, gridTemplateRows: `26px repeat(${rowsSorted.length}, 22px)` }}>
            {buckets.map((b, i) => <div key={b} style={{ ...styles.ganttDateCell, gridRow: 1, gridColumn: i + 1 }}>{bucketLabel(b, granularity)}</div>)}
            {rowsSorted.map((r, idx) => {
              const startIdx = buckets.indexOf(bucketKeyFor(r.startDate, granularity));
              const endIdx = buckets.indexOf(bucketKeyFor(r.endDate, granularity));
              const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
              return (
                <div key={r.id} style={{ ...styles.ganttBarTrack, gridRow: idx + 2, gridColumn: `${startIdx + 1} / ${endIdx + 2}` }}
                  title={`${r.name}　${formatDate(r.startDate)}〜${formatDate(r.endDate)}　${r.done}/${r.total}`}>
                  <div style={{ ...styles.ganttBarFill, width: `${pct}%`, background: r.color }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewGanttChart({ projects }) {
  const [granularity, setGranularity] = useState("day");
  const [openPJ, setOpenPJ] = useState(() => new Set());

  const todayStr = toDateStr(new Date());
  const monthLater = new Date(); monthLater.setMonth(monthLater.getMonth() + 1);
  const monthLaterStr = toDateStr(monthLater);

  const pjData = projects.map((p) => {
    const taskRows = [];
    for (const t of p.tasks) {
      if (!t.startDate || !t.endDate) continue;
      if (t.endDate < todayStr || t.startDate > monthLaterStr) continue;
      const { done, total } = taskProgress(t);
      const minPriorityVal = t.subtasks.length ? Math.min(...t.subtasks.map((s) => s.priority || 2)) : 2;
      const pInfo = PRIORITIES.find((pr) => pr.v === minPriorityVal) || PRIORITIES[1];
      taskRows.push({ id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate, done, total, color: pInfo.color });
    }
    return { id: p.id, name: p.name, taskRows };
  }).filter((p) => p.taskRows.length > 0);

  if (pjData.length === 0) {
    return <p style={styles.ganttEmpty}>本日から1ヶ月以内に開始日・終了日が設定されたタスクがまだない。各タスクに開始日・終了日を入れると、ここに全PJ分がまとまって並ぶ。</p>;
  }

  const allTaskDates = pjData.flatMap((p) => p.taskRows.flatMap((r) => [r.startDate, r.endDate]));
  const allDates = [todayStr, monthLaterStr, ...allTaskDates].sort();
  const buckets = generateBuckets(allDates[0], allDates[allDates.length - 1], granularity);
  const colWidth = { day: 44, week: 60, month: 68, quarter: 78, year: 72 }[granularity];

  const flatRows = [];
  for (const p of pjData) {
    flatRows.push({ type: "pj", id: p.id, name: p.name, count: p.taskRows.length });
    if (openPJ.has(p.id)) for (const t of p.taskRows) flatRows.push({ type: "task", ...t });
  }

  function togglePJ(id) {
    setOpenPJ((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  return (
    <div style={styles.ganttWrap}>
      <div style={styles.ganttToolbar}>
        <div style={styles.granularityGroup}>
          {GRANULARITIES.map((g) => (
            <button type="button" key={g.key} onClick={() => setGranularity(g.key)}
              style={{ ...styles.granularityBtn, background: granularity === g.key ? "#2C3645" : "transparent", color: granularity === g.key ? "#FFFFFF" : "#2C3645" }}>
              {g.label}
            </button>
          ))}
        </div>
        <div style={styles.ganttLegend}>
          {PRIORITIES.map((p) => <span key={p.v} style={styles.ganttLegendItem}><span style={{ ...styles.ganttLegendDot, background: p.color }} />{p.label}</span>)}
        </div>
      </div>
      <div style={styles.ganttSplitWrap}>
        <div style={{ ...styles.ganttLabelCol, width: 140 }}>
          <div style={styles.ganttLabelHeaderCell} />
          {flatRows.map((r) => r.type === "pj" ? (
            <button key={r.id + "-pjlabel"} type="button" onClick={() => togglePJ(r.id)} style={styles.ganttPjRow}>
              <span>{openPJ.has(r.id) ? "▾" : "▸"}</span>
              <span style={styles.ganttPjName}>{r.name}</span>
              <span style={styles.ganttPjCount}>{r.count}</span>
            </button>
          ) : (
            <div key={r.id + "-label"} style={styles.ganttLabelCell} title={r.name}>{r.name}</div>
          ))}
        </div>
        <div style={styles.ganttScroll}>
          <div style={{ ...styles.ganttGrid, gridTemplateColumns: `repeat(${buckets.length}, ${colWidth}px)`, gridTemplateRows: `26px repeat(${flatRows.length}, 22px)` }}>
            {buckets.map((b, i) => <div key={b} style={{ ...styles.ganttDateCell, gridRow: 1, gridColumn: i + 1 }}>{bucketLabel(b, granularity)}</div>)}
            {flatRows.map((r, idx) => {
              if (r.type === "pj") return <div key={r.id + "-pjband"} style={{ gridRow: idx + 2, gridColumn: `1 / ${buckets.length + 1}`, background: "#E5E5E5", borderRadius: 5 }} />;
              const startIdx = buckets.indexOf(bucketKeyFor(r.startDate, granularity));
              const endIdx = buckets.indexOf(bucketKeyFor(r.endDate, granularity));
              const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
              return (
                <div key={r.id + "-bar"} style={{ ...styles.ganttBarTrack, gridRow: idx + 2, gridColumn: `${startIdx + 1} / ${endIdx + 2}` }}
                  title={`${r.name}　${formatDate(r.startDate)}〜${formatDate(r.endDate)}　${r.done}/${r.total}`}>
                  <div style={{ ...styles.ganttBarFill, width: `${pct}%`, background: r.color }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function exportProjectExcel(project) {
  const wb = XLSX.utils.book_new();

  const rows = [
    ["タスク一覧"],
    ["タスク名", "開始日", "終了日", "想定時間(分)", "進捗"],
    ...project.tasks.map((t) => {
      const { done, total } = taskProgress(t);
      return [t.name, t.startDate || "", t.endDate || "", taskEstimatedEffective(t) || "", `${done}/${total}`];
    }),
    [],
    ["完了事項"],
    [project.completedNote || ""],
    [],
    ["ネクストアクション"],
    [project.nextAction || ""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "PJ詳細");

  const dateStr = toDateStr(new Date()).replace(/-/g, "");
  const safeName = (project.name || "PJ").replace(/[\\/:*?"<>|]/g, "_");
  XLSX.writeFile(wb, `${safeName}_${dateStr}.xlsx`);
}

function exportWeekTasksExcel(label, tasks) {
  const wb = XLSX.utils.book_new();

  const rows = [
    ["日付", "曜日", "完了", "サブタスク名", "想定時間(分)", "タスク名", "PJ名"],
    ...tasks.map(({ pjName, taskName, sub: s }) => {
      const dt = new Date(s.scheduledDate + "T00:00:00");
      return [s.scheduledDate, WEEKDAY_LABELS[dt.getDay()], s.done ? "済" : "", s.text, s.estimatedMinutes || "", taskName, pjName];
    }),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), label);

  const dateStr = toDateStr(new Date()).replace(/-/g, "");
  XLSX.writeFile(wb, `${label}_${dateStr}.xlsx`);
}

function NoteField({ title, placeholder, value, onChange }) {
  return (
    <>
      <h4 style={styles.sectionTitle}>{title}</h4>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={styles.noteTextarea} />
    </>
  );
}

function PJDetailModal({ project, onUpdateNote, onClose }) {
  const [exporting, setExporting] = useState(false);
  const [openTasks, setOpenTasks] = useState(() => new Set());
  const [doneVisibleTasks, setDoneVisibleTasks] = useState(() => new Set());

  function toggleOpenTask(id) { setOpenTasks((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  function toggleDoneVisible(id) { setDoneVisibleTasks((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); }

  async function handleExport() {
    setExporting(true);
    try {
      exportProjectExcel(project);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalBoxLarge} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{project.name}</h3>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button type="button" onClick={handleExport} disabled={exporting} style={styles.addBtn}>{exporting ? "出力中…" : "Excelで出力"}</button>
            <button type="button" onClick={onClose} aria-label="閉じる" style={styles.modalCloseBtn}>×</button>
          </div>
        </div>

        <GanttChart project={project} />

        <NoteField
          title="完了事項"
          placeholder="完了した内容を入力…"
          value={project.completedNote}
          onChange={(v) => onUpdateNote(project.id, "completedNote", v)}
        />

        <NoteField
          title="ネクストアクション"
          placeholder="次にやることを入力…"
          value={project.nextAction}
          onChange={(v) => onUpdateNote(project.id, "nextAction", v)}
        />

        <h4 style={styles.sectionTitle}>タスク・サブタスク一覧</h4>
        <ul style={styles.detailTaskList}>
          {project.tasks.length === 0 && <li style={styles.emptySmall}>タスクなし</li>}
          {project.tasks.map((t) => {
            const { done, total } = taskProgress(t);
            const open = openTasks.has(t.id);
            const showDone = doneVisibleTasks.has(t.id);
            const visibleSubtasks = showDone ? t.subtasks : t.subtasks.filter((s) => !s.done);
            return (
              <li key={t.id} style={styles.detailTaskGroup}>
                <div style={styles.detailTaskRow}>
                  <button type="button" onClick={() => toggleOpenTask(t.id)} style={styles.collapseBtnSm} aria-label={open ? "折りたたむ" : "展開する"}>{open ? "▾" : "▸"}</button>
                  <span style={styles.detailTaskName}>{t.name}</span>
                  <span style={styles.calEstTag}>{t.startDate ? formatDate(t.startDate) : "―"}〜{t.endDate ? formatDate(t.endDate) : "―"}</span>
                  <span style={styles.progressTagSm}>{done}/{total}</span>
                  <button type="button" onClick={() => toggleDoneVisible(t.id)}
                    style={{ ...styles.eyeToggleBtn, background: showDone ? "#F0F0F0" : "transparent" }}
                    aria-label={showDone ? "完了済みサブタスクを隠す" : "完了済みサブタスクを表示"}>
                    {showDone ? "👁" : "🙈"}
                  </button>
                </div>
                {open && (
                  <ul style={styles.detailSubList}>
                    {t.subtasks.length === 0 && <li style={styles.emptySmall}>サブタスクなし</li>}
                    {t.subtasks.length > 0 && visibleSubtasks.length === 0 && <li style={styles.emptySmall}>完了済みサブタスクのみ(👁で表示できる)</li>}
                    {visibleSubtasks.map((s) => (
                      <li key={s.id} style={styles.detailSubRow}>
                        <span style={{ ...styles.doneMark, opacity: s.done ? 1 : 0.15 }}>✅</span>
                        <span style={{ ...styles.subText, textDecoration: s.done ? "line-through" : "none", color: s.done ? "#9B9B9B" : "#2C3645" }}>{s.text}</span>
                        {s.scheduledDate && <span style={styles.calEstTag}>{formatDate(s.scheduledDate)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const DAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

function DateGroupedTaskList({ dates, tasks, openDates, onToggleDate, onToggleDone, onMoveDate, stamping, dayViewDate, emptyMessage, showActual }) {
  const groups = dates
    .map((d) => ({ date: d, items: tasks.filter((t) => t.sub.scheduledDate === d) }))
    .filter((g) => g.items.length > 0);

  if (groups.length === 0) return <p style={styles.emptySmall}>{emptyMessage}</p>;

  return (
    <ul style={styles.todayList}>
      {groups.map((g) => {
        const dt = new Date(g.date + "T00:00:00");
        const open = openDates.has(g.date);
        const estTotal = g.items.reduce((sum, t) => sum + (t.sub.estimatedMinutes || 0), 0);
        return (
          <li key={g.date} style={styles.dateGroupCard}>
            <button type="button" onClick={() => onToggleDate(g.date)} style={styles.dateGroupHeader} aria-label={open ? "折りたたむ" : "展開する"}>
              <span style={styles.collapseBtnSm}>{open ? "▾" : "▸"}</span>
              <span style={styles.dateGroupLabel}>{formatDate(g.date)}({DAY_JP[dt.getDay()]})</span>
              <span style={styles.dateGroupCount}>{g.items.length}件</span>
              {estTotal > 0 && <span style={styles.calEstTag}>想定計{formatDuration(estTotal)}</span>}
            </button>
            {open && (
              <ul style={styles.dateGroupList}>
                {g.items.map(({ pjId, pjName, taskId, taskName, sub: s }) => (
                  <li key={s.id} style={styles.calendarCard} className="row-in">
                    <div style={styles.calendarLine1}>
                      <button onClick={() => onToggleDone(pjId, taskId, s.id)} aria-label={s.done ? "未完了に戻す" : "完了にする"} style={styles.stampWrap}>
                        {s.done ? <span style={styles.hankoStamp} className={stamping === s.id ? "hanko-pop" : ""}>済</span> : <span style={styles.hankoEmpty} />}
                      </button>
                      <span style={styles.calEstTag}>想定{s.estimatedMinutes ? formatDuration(s.estimatedMinutes) : "―"}</span>
                      {showActual && <span style={styles.calEstTag}>実績{s.actualMinutes ? formatDuration(s.actualMinutes) : "―"}</span>}
                      <span style={{ ...styles.calSubCol, textDecoration: s.done ? "line-through" : "none", color: s.done ? "#9B9B9B" : "#2C3645" }} title={s.text}>{s.text}</span>
                    </div>
                    <div style={styles.calendarLine2}>
                      <button type="button" onClick={() => onMoveDate({ pjId, taskId, subId: s.id, date: s.scheduledDate || dayViewDate })} aria-label="予定日を変更" style={styles.inlineAddBtn}>📅変更</button>
                      <span style={styles.calPjCol} title={pjName}>{pjName}</span>
                      <span style={styles.calTaskCol} title={taskName}>{taskName}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const CAL_HOUR_START = 6;
const CAL_HOUR_END = 24;
const CAL_HOUR_HEIGHT = 36;
const CAL_TIME_BANDS = [
  { start: 0, end: 7, color: "#EAE6F7" },
  { start: 7, end: 9, color: "#FFF6D9" },
  { start: 9, end: 18, color: "#E4F5E9" },
  { start: 18, end: 24, color: "#E1F0FA" },
];
function calBandColorForHour(h) {
  const band = CAL_TIME_BANDS.find((b) => h >= b.start && h < b.end);
  return band ? band.color : "#FFFFFF";
}

function CalendarMonthView({ monthDateStr, tasksByDate, todayStr, ownerColorOf, onSelectDay }) {
  const [y, m] = monthDateStr.split("-").map(Number);
  const dates = monthGridDates(monthDateStr);
  return (
    <div>
      <div style={styles.calMonthHeaderRow}>
        {MON_FIRST_LABELS.map((l) => <span key={l} style={styles.calMonthHeaderCell}>{l}</span>)}
      </div>
      <div style={styles.calMonthGrid}>
        {dates.map((d) => {
          const dt = new Date(d + "T00:00:00");
          const inMonth = dt.getMonth() + 1 === m && dt.getFullYear() === y;
          const items = tasksByDate[d] || [];
          const owners = [...new Set(items.map((i) => i.owner))];
          const holiday = isJapanHoliday(d);
          const weekday = dt.getDay();
          const dateColor = holiday || weekday === 0 ? "#D64550" : weekday === 6 ? "#2E86DE" : "#2C3645";
          return (
            <button
              type="button"
              key={d}
              onClick={() => onSelectDay(d)}
              style={{ ...styles.calMonthCell, opacity: inMonth ? 1 : 0.4, background: d === todayStr ? "#FFF6E5" : "#FFFFFF" }}
              title={holiday ? d : undefined}
            >
              <span style={{ ...styles.calMonthDateNum, color: dateColor }}>{dt.getDate()}</span>
              {items.length > 0 && <span style={styles.calMonthBadge}>{items.length}</span>}
              {owners.length > 0 && (
                <span style={styles.calMonthDots}>
                  {owners.map((o) => <span key={o} style={{ ...styles.calMonthDot, background: ownerColorOf(o) }} />)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 時間指定ありサブタスクの重なりを検出し、同時間帯のものは列分割して並列表示できるよう col/totalCols を付与する
function layoutTimedCalItems(items) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laidOut = [];
  let cluster = [];
  let clusterEnd = -Infinity;
  const flushCluster = () => {
    if (cluster.length === 0) return;
    const columnEnds = [];
    for (const it of cluster) {
      let colIndex = columnEnds.findIndex((end) => end <= it.startMin);
      if (colIndex === -1) {
        colIndex = columnEnds.length;
        columnEnds.push(it.endMin);
      } else {
        columnEnds[colIndex] = it.endMin;
      }
      it.col = colIndex;
    }
    const totalCols = columnEnds.length;
    for (const it of cluster) {
      it.totalCols = totalCols;
      laidOut.push(it);
    }
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length === 0 || it.startMin < clusterEnd) {
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.endMin);
    } else {
      flushCluster();
      cluster.push(it);
      clusterEnd = it.endMin;
    }
  }
  flushCluster();
  return laidOut;
}

const CAL_UNTIMED_COLLAPSED_ROWS = 3;

function CalendarTimeGrid({ dates, tasksByDate, todayStr, ownerColorOf, onOpenSubtask, onSelectDay }) {
  const hours = Array.from({ length: CAL_HOUR_END - CAL_HOUR_START }, (_, i) => i + CAL_HOUR_START);
  const gridHeight = hours.length * CAL_HOUR_HEIGHT;
  const rangeStartMin = CAL_HOUR_START * 60;
  const timeBands = CAL_TIME_BANDS.map((b) => {
    const visStart = Math.max(b.start, CAL_HOUR_START);
    const visEnd = Math.min(b.end, CAL_HOUR_END);
    return { color: b.color, top: (visStart - CAL_HOUR_START) * CAL_HOUR_HEIGHT, height: (visEnd - visStart) * CAL_HOUR_HEIGHT };
  }).filter((b) => b.height > 0);
  const [expandedUntimed, setExpandedUntimed] = useState(() => new Set());
  const toggleUntimedExpanded = (d) => setExpandedUntimed((prev) => {
    const next = new Set(prev);
    next.has(d) ? next.delete(d) : next.add(d);
    return next;
  });
  return (
    <div style={styles.calGridWrap}>
      <div style={styles.calGridHeaderRow}>
        <span style={styles.calGridTimeColHeader} />
        {dates.map((d) => {
          const dt = new Date(d + "T00:00:00");
          const items = tasksByDate[d] || [];
          const untimed = items.filter((i) => !i.sub.startTime);
          const expanded = expandedUntimed.has(d);
          const visibleUntimed = expanded ? untimed : untimed.slice(0, CAL_UNTIMED_COLLAPSED_ROWS);
          const hiddenCount = untimed.length - visibleUntimed.length;
          return (
            <div key={d} style={styles.calGridDayHeaderCol}>
              <button type="button" onClick={() => onSelectDay(d)} style={{ ...styles.calGridDayHeaderBtn, color: d === todayStr ? "#F39800" : "#2C3645" }}>
                {formatDate(d)}({DAY_JP[dt.getDay()]})
              </button>
              {visibleUntimed.map(({ pjId, taskId, sub: s, owner }) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => onOpenSubtask(pjId, taskId, s.id)}
                  style={{ ...styles.calGridUntimedChip, background: ownerColorOf(owner), textDecoration: s.done ? "line-through" : "none" }}
                  title={s.text}
                >
                  {s.text}
                </button>
              ))}
              {untimed.length > CAL_UNTIMED_COLLAPSED_ROWS && (
                <button type="button" onClick={() => toggleUntimedExpanded(d)} style={styles.calGridUntimedToggle}>
                  {expanded ? "▲閉じる" : `▼他${hiddenCount}件`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ ...styles.calGridBody, height: gridHeight }}>
        <div style={styles.calGridTimeCol}>
          {hours.map((h) => <div key={h} style={{ ...styles.calGridTimeLabel, height: CAL_HOUR_HEIGHT, background: calBandColorForHour(h) }}>{h}:00</div>)}
        </div>
        {dates.map((d) => {
          const rawItems = (tasksByDate[d] || [])
            .filter((i) => i.sub.startTime)
            .map((i) => {
              const startMin = timeToMinutes(i.sub.startTime);
              const endMin = startMin + Math.max(i.sub.estimatedMinutes || 30, 15);
              return { ...i, startMin, endMin };
            });
          const items = layoutTimedCalItems(rawItems);
          return (
            <div key={d} style={{ ...styles.calGridDayCol, height: gridHeight }}>
              {timeBands.map((b, i) => <div key={i} style={{ position: "absolute", left: 0, right: 0, top: b.top, height: b.height, background: b.color }} />)}
              {hours.map((h) => <div key={h} style={{ ...styles.calGridHourLine, top: (h - CAL_HOUR_START) * CAL_HOUR_HEIGHT }} />)}
              {items.map(({ pjId, taskId, pjName, sub: s, owner, startMin, col, totalCols }) => {
                const top = Math.max(0, (startMin - rangeStartMin) / 60) * CAL_HOUR_HEIGHT;
                const height = Math.max(16, ((s.estimatedMinutes || 30) / 60) * CAL_HOUR_HEIGHT);
                const widthPct = 100 / totalCols;
                const leftPct = col * widthPct;
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => onOpenSubtask(pjId, taskId, s.id)}
                    style={{
                      ...styles.calGridBlock,
                      top,
                      height,
                      left: `calc(${leftPct}% + 2px)`,
                      right: "auto",
                      width: `calc(${widthPct}% - 4px)`,
                      background: ownerColorOf(owner),
                      textDecoration: s.done ? "line-through" : "none",
                    }}
                    title={`${s.startTime} ${s.text}(${pjName})`}
                  >
                    {s.startTime} {s.text}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DASHBOARD_CATEGORICAL_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const DASHBOARD_OTHER_COLOR = "#9B9B9B";

const DASHBOARD_RANGES = [
  { key: "lastWeek", label: "先週" },
  { key: "thisWeek", label: "今週" },
  { key: "nextWeek", label: "来週" },
  { key: "thisMonth", label: "今月" },
  { key: "lastMonth", label: "先月" },
  { key: "past3Months", label: "過去3ヶ月" },
];

function dashboardRangeDates(rangeKey) {
  const today = new Date();
  const monday = startOfWeek(today);
  if (rangeKey === "thisWeek") {
    const start = toDateStr(monday);
    return { start, end: addDaysStr(start, 6) };
  }
  if (rangeKey === "lastWeek") {
    const start = addDaysStr(toDateStr(monday), -7);
    return { start, end: addDaysStr(start, 6) };
  }
  if (rangeKey === "nextWeek") {
    const start = addDaysStr(toDateStr(monday), 7);
    return { start, end: addDaysStr(start, 6) };
  }
  if (rangeKey === "thisMonth") {
    const y = today.getFullYear(), m = today.getMonth();
    return { start: toDateStr(new Date(y, m, 1)), end: toDateStr(new Date(y, m + 1, 0)) };
  }
  if (rangeKey === "lastMonth") {
    const y = today.getFullYear(), m = today.getMonth();
    return { start: toDateStr(new Date(y, m - 1, 1)), end: toDateStr(new Date(y, m, 0)) };
  }
  // past3Months
  const start = new Date(today);
  start.setMonth(start.getMonth() - 3);
  return { start: toDateStr(start), end: toDateStr(today) };
}

// 積み上げ棒グラフのY軸目盛りを「きりのいい」分単位の間隔にする(15分/30分/1〜24時間刻み)。
// 目盛りが3〜5本になる最小の間隔を選ぶ
function niceMinuteStep(maxMinutes) {
  const steps = [15, 30, 60, 120, 180, 240, 360, 480, 600, 720, 900, 1080, 1260, 1440];
  for (const step of steps) {
    if (Math.ceil(maxMinutes / step) <= 5) return step;
  }
  return Math.ceil(maxMinutes / 5 / 1440) * 1440;
}

function PieChart({ title, data }) {
  const total = data.reduce((sum, d) => sum + d.minutes, 0);
  const size = 140, outerR = 60, innerR = 34, cx = size / 2, cy = size / 2;
  const gapDeg = data.length > 1 ? 1.5 : 0;

  let acc = 0;
  const wedges = data.map((d) => {
    const span = (d.minutes / total) * 360;
    const start = acc + gapDeg / 2;
    let end = acc + span - gapDeg / 2;
    if (end - start >= 360) end = start + 359.99; // 単一カテゴリ100%の場合、弧が退化しないようにする
    const wedge = { ...d, start, end };
    acc += span;
    return wedge;
  });

  function toXY(angle, radius) {
    const rad = (angle - 90) * Math.PI / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  }
  function arcPath(w) {
    const [x1, y1] = toXY(w.start, outerR);
    const [x2, y2] = toXY(w.end, outerR);
    const [x3, y3] = toXY(w.end, innerR);
    const [x4, y4] = toXY(w.start, innerR);
    const largeArc = w.end - w.start > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
  }

  return (
    <div style={styles.dashboardChartCol}>
      <h4 style={styles.dashboardChartTitle}>{title}</h4>
      {total === 0 ? (
        <p style={styles.emptySmall}>データなし</p>
      ) : (
        <>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {wedges.map((w, i) => w.end > w.start && (
              <path key={i} d={arcPath(w)} fill={w.color}>
                <title>{w.label} {formatDuration(w.minutes)}({Math.round((w.minutes / total) * 100)}%)</title>
              </path>
            ))}
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="11" fontWeight="700" fill="#2C3645">{formatDuration(total)}</text>
          </svg>
          <ul style={styles.dashboardLegend}>
            {wedges.map((w, i) => (
              <li key={i} style={styles.dashboardLegendItem}>
                <span style={{ ...styles.dashboardLegendSwatch, background: w.color }} />
                <span style={styles.dashboardLegendLabel}>{w.label}</span>
                <span style={styles.dashboardLegendValue}>{formatDuration(w.minutes)}({Math.round((w.minutes / total) * 100)}%)</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function StackedBarChart({ dates, series }) {
  const chartH = 160, barW = 22, gap = 10, axisW = 40;
  const plotW = dates.length * (barW + gap) + gap;
  const maxTotal = Math.max(1, ...dates.map((d) => series.reduce((sum, s) => sum + (s.valuesByDate.get(d) || 0), 0)));
  const step = niceMinuteStep(maxTotal);
  const tickMax = Math.ceil(maxTotal / step) * step;
  const ticks = [];
  for (let v = 0; v <= tickMax; v += step) ticks.push(v);
  const yFor = (mins) => chartH - (mins / tickMax) * (chartH - 8);

  return (
    <div style={styles.dashboardBarWrap}>
      <h4 style={styles.dashboardChartTitle}>日別 実績/想定時間(PJ別積み上げ)</h4>
      {series.length === 0 ? (
        <p style={styles.emptySmall}>データなし</p>
      ) : (
        <>
          <div style={{ display: "flex" }}>
            <svg width={axisW} height={chartH + 24} viewBox={`0 0 ${axisW} ${chartH + 24}`} style={{ flexShrink: 0 }}>
              {ticks.map((t) => (
                <text key={t} x={axisW - 6} y={yFor(t)} textAnchor="end" dominantBaseline="middle" fontSize="9" fill="#7A7A7A">
                  {t === 0 ? "0" : formatDuration(t)}
                </text>
              ))}
            </svg>
            <div style={{ overflowX: "auto", flex: 1 }}>
              <svg width={plotW} height={chartH + 24} viewBox={`0 0 ${plotW} ${chartH + 24}`}>
                {ticks.map((t) => (
                  <line key={t} x1={0} y1={yFor(t)} x2={plotW} y2={yFor(t)} stroke="#E0E0E0" strokeWidth={1} />
                ))}
                {dates.map((d, i) => {
                  const x = gap + i * (barW + gap);
                  let y = chartH;
                  return (
                    <g key={d}>
                      {series.map((s) => {
                        const mins = s.valuesByDate.get(d) || 0;
                        if (mins <= 0) return null;
                        const h = (mins / tickMax) * (chartH - 8);
                        const barY = y - h;
                        y = barY - 2;
                        return (
                          <rect key={s.pjId} x={x} y={barY} width={barW} height={h} fill={s.color}>
                            <title>{s.label} {formatDate(d)} {formatDuration(mins)}</title>
                          </rect>
                        );
                      })}
                      <text x={x + barW / 2} y={chartH + 14} textAnchor="middle" fontSize="9" fill="#7A7A7A">{formatDate(d)}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
          <ul style={styles.dashboardLegend}>
            {series.map((s) => (
              <li key={s.pjId} style={styles.dashboardLegendItem}>
                <span style={{ ...styles.dashboardLegendSwatch, background: s.color }} />
                <span style={styles.dashboardLegendLabel}>{s.label}</span>
                <span style={styles.dashboardLegendValue}>{formatDuration([...s.valuesByDate.values()].reduce((a, b) => a + b, 0))}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DashboardModal({ projects, onClose }) {
  const [range, setRange] = useState("thisWeek");
  const { start, end } = useMemo(() => dashboardRangeDates(range), [range]);
  const todayStr = toDateStr(new Date());

  const filteredSubs = useMemo(() => {
    const list = [];
    for (const p of projects) {
      for (const t of p.tasks) {
        for (const s of t.subtasks) {
          if (s.scheduledDate && s.scheduledDate >= start && s.scheduledDate <= end) list.push({ p, s });
        }
      }
    }
    return list;
  }, [projects, start, end]);

  // 選択中の期間内の実績/想定時間(過去は実績、未来は想定)が多い順にPJを並べ、上位のみ固有色を割り当てる。
  // (プロジェクト総数が多いと全PJ分の固有色は用意できないため、それ以外は「その他」にまとめる)
  const projectTotals = useMemo(() => {
    const totals = new Map();
    for (const { p, s } of filteredSubs) {
      const cur = totals.get(p.id) || { p, minutes: 0 };
      cur.minutes += subEffectiveMinutes(s, todayStr);
      totals.set(p.id, cur);
    }
    return [...totals.values()].filter((d) => d.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  }, [filteredSubs, todayStr]);

  const topProjectIds = useMemo(
    () => new Set(projectTotals.slice(0, DASHBOARD_CATEGORICAL_COLORS.length).map((d) => d.p.id)),
    [projectTotals]
  );

  const pjColorMap = useMemo(() => {
    const map = new Map();
    projectTotals.forEach((d, i) => {
      map.set(d.p.id, i < DASHBOARD_CATEGORICAL_COLORS.length ? DASHBOARD_CATEGORICAL_COLORS[i] : DASHBOARD_OTHER_COLOR);
    });
    return map;
  }, [projectTotals]);

  const pjPieData = useMemo(() => {
    const top = projectTotals
      .filter((d) => topProjectIds.has(d.p.id))
      .map((d) => ({ label: d.p.name, minutes: d.minutes, color: pjColorMap.get(d.p.id) }));
    const otherMinutes = projectTotals
      .filter((d) => !topProjectIds.has(d.p.id))
      .reduce((sum, d) => sum + d.minutes, 0);
    if (otherMinutes > 0) top.push({ label: "その他", minutes: otherMinutes, color: DASHBOARD_OTHER_COLOR });
    return top;
  }, [projectTotals, topProjectIds, pjColorMap]);

  const priorityPieData = useMemo(() => {
    const totals = new Map();
    for (const { p, s } of filteredSubs) {
      const v = p.priority || 2;
      totals.set(v, (totals.get(v) || 0) + subEffectiveMinutes(s, todayStr));
    }
    return PJ_PRIORITIES.map((pri) => ({ label: pri.label, color: pri.color, minutes: totals.get(pri.v) || 0 })).filter((d) => d.minutes > 0);
  }, [filteredSubs, todayStr]);

  const barDates = useMemo(() => generateBuckets(start, end, "day"), [start, end]);

  const barSeries = useMemo(() => {
    const seriesMap = new Map();
    for (const { p, s } of filteredSubs) {
      const minutes = subEffectiveMinutes(s, todayStr);
      if (!minutes) continue;
      const isTop = topProjectIds.has(p.id);
      const key = isTop ? p.id : "__other__";
      let entry = seriesMap.get(key);
      if (!entry) {
        entry = { pjId: key, label: isTop ? p.name : "その他", color: isTop ? pjColorMap.get(p.id) : DASHBOARD_OTHER_COLOR, valuesByDate: new Map() };
        seriesMap.set(key, entry);
      }
      entry.valuesByDate.set(s.scheduledDate, (entry.valuesByDate.get(s.scheduledDate) || 0) + minutes);
    }
    const ordered = projectTotals.filter((d) => topProjectIds.has(d.p.id) && seriesMap.has(d.p.id)).map((d) => seriesMap.get(d.p.id));
    const other = seriesMap.get("__other__");
    if (other) ordered.push(other);
    return ordered;
  }, [filteredSubs, projectTotals, topProjectIds, pjColorMap, todayStr]);

  const totalMin = pjPieData.reduce((sum, d) => sum + d.minutes, 0);

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalBoxDashboard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>ダッシュボード</h3>
          <button type="button" onClick={onClose} aria-label="閉じる" style={styles.modalCloseBtn}>×</button>
        </div>

        <div style={styles.dashboardFilterRow}>
          {DASHBOARD_RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRange(r.key)}
              style={{ ...styles.dashboardFilterBtn, background: range === r.key ? "#2C3645" : "transparent", color: range === r.key ? "#FFFFFF" : "#2C3645", borderColor: "#2C3645" }}>
              {r.label}
            </button>
          ))}
          <span style={styles.dashboardRangeLabel}>{formatDate(start)}〜{formatDate(end)}</span>
        </div>

        {totalMin === 0 ? (
          <p style={styles.emptySmall}>この期間の実績・想定時間の記録はない。</p>
        ) : (
          <>
            <div style={styles.dashboardPieRow}>
              <PieChart title="PJ単位" data={pjPieData} />
              <PieChart title="重要度別" data={priorityPieData} />
            </div>
            <StackedBarChart dates={barDates} series={barSeries} />
          </>
        )}
      </div>
    </div>
  );
}

const BRAIN_LEVEL_COLORS = { blue: "#2E86DE", orange: "#F39800", red: "#D64550" };

function brainLevelFor(ratio) {
  if (ratio >= 1.2) return "red-steam";
  if (ratio >= 1) return "red";
  if (ratio >= 0.8) return "orange";
  return "blue";
}

function BrainIcon({ color, size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        fill={color}
        d="M17 6c-3.5 0-6.3 2.3-6.9 5.4C7.4 12.4 5.6 14.8 5.6 17.6c0 2 .9 3.8 2.3 5-.8 1.1-1.3 2.5-1.3 4 0 3.6 2.9 6.5 6.4 6.7.6 3 3.2 5.3 6.4 5.3 1.7 0 3.2-.6 4.4-1.7 1.2 1.1 2.7 1.7 4.4 1.7 3.2 0 5.9-2.3 6.4-5.3 3.5-.2 6.4-3.1 6.4-6.7 0-1.5-.5-2.9-1.3-4 1.4-1.2 2.3-3 2.3-5 0-2.8-1.8-5.2-4.5-6.2C36.4 8.4 33.9 6 30.4 6c-1.6 0-3 .5-4.2 1.4C25 6.5 23.6 6 22.2 6H17z"
      />
      <path
        stroke="rgba(0,0,0,0.28)" strokeWidth="1.3" strokeLinecap="round" fill="none"
        d="M24 8v31M15 13c2 1.2 3.2 3.2 3.2 5.5M33 13c-2 1.2-3.2 3.2-3.2 5.5M11.5 23c2.2 0 4.3 1.1 5.3 3.2M36.5 23c-2.2 0-4.3 1.1-5.3 3.2M16 31.5c1.9 0 3.2-1.1 4-3M32 31.5c-1.9 0-3.2-1.1-4-3"
      />
    </svg>
  );
}

function SteamIcon() {
  return (
    <svg width="20" height="15" viewBox="0 0 24 18" style={styles.brainSteamIcon} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 17c2.2-3.2-2-5.2 0-8.4M12 17c2.2-3.2-2-5.2 0-8.4M18 17c2.2-3.2-2-5.2 0-8.4" stroke="#9B9B9B" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BrainBadge({ label, ratio, moyaCount }) {
  const level = brainLevelFor(ratio);
  const color = BRAIN_LEVEL_COLORS[level === "red-steam" ? "red" : level];
  return (
    <div style={styles.brainBadgeWrap}>
      <div style={styles.brainIconBox}>
        {level === "red-steam" && <SteamIcon />}
        <BrainIcon color={color} />
        {typeof moyaCount === "number" && moyaCount > 0 && (
          <span style={styles.brainMoyaBadge}>{moyaCount}</span>
        )}
      </div>
      <span style={{ ...styles.brainBadgeLabel, color }}>{label}</span>
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState(null);
  const [topTab, setTopTab] = useState("kkr");
  const [subTab, setSubTab] = useState("仕事");
  const [openPJ, setOpenPJ] = useState(() => new Set());
  const [openTask, setOpenTask] = useState(() => new Set());
  const [showDoneSubtasks, setShowDoneSubtasks] = useState(() => new Set());
  const [showCompletedTasks, setShowCompletedTasks] = useState(() => new Set());
  const [showCompletedPJSections, setShowCompletedPJSections] = useState(() => new Set());
  const [ganttCollapsed, setGanttCollapsed] = useState(true);
  const [pjDetailModal, setPjDetailModal] = useState(null);
  const [runningTarget, setRunningTarget] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tm_running_target") || "null"); } catch { return null; }
  });
  const [, setTick] = useState(0);

  useEffect(() => {
    if (runningTarget) localStorage.setItem("tm_running_target", JSON.stringify(runningTarget));
    else localStorage.removeItem("tm_running_target");
  }, [runningTarget]);

  useEffect(() => {
    if (!runningTarget || runningTarget.paused) return;
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [runningTarget]);

  const [stamping, setStamping] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // idle | loading | saving | saved | error

  const [addLevel, setAddLevel] = useState("subtask");
  const [addOwner, setAddOwner] = useState("家族");
  const [addSub, setAddSub] = useState(REAL_SUBS[0].key);
  const [addPJId, setAddPJId] = useState("");
  const [addTaskId, setAddTaskId] = useState("");
  const [addText, setAddText] = useState("");
  const [addPriority, setAddPriority] = useState(2);
  const [addPJPriority, setAddPJPriority] = useState(2);
  const [collapsedPrioritySection, setCollapsedPrioritySection] = useState(() => new Set([...PJ_PRIORITIES.map((p) => p.v), ...PJ_STATUSES.map((s) => s.v)]));
  const [addTaskStartDate, setAddTaskStartDate] = useState("");
  const [addTaskEndDate, setAddTaskEndDate] = useState("");
  const [addDate, setAddDate] = useState("");
  const [addStartTime, setAddStartTime] = useState("");
  const [addEstMinutes, setAddEstMinutes] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [modalPJName, setModalPJName] = useState("");
  const [modalTaskName, setModalTaskName] = useState("");
  const [stepsModalTarget, setStepsModalTarget] = useState(null);
  const [newStepText, setNewStepText] = useState("");
  const [dayViewDate, setDayViewDate] = useState(() => toDateStr(new Date()));
  const [copyDateModal, setCopyDateModal] = useState(null);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [moveDateModal, setMoveDateModal] = useState(null);
  const [calSubtaskModal, setCalSubtaskModal] = useState(null);
  const [calGranularity, setCalGranularity] = useState("month");
  const [calDate, setCalDate] = useState(() => toDateStr(new Date()));
  const [calCollapsed, setCalCollapsed] = useState(false);
  const [calHiddenOwners, setCalHiddenOwners] = useState(() => new Set());
  const toggleCalOwner = (owner) => setCalHiddenOwners((prev) => {
    const next = new Set(prev);
    next.has(owner) ? next.delete(owner) : next.add(owner);
    return next;
  });

  const inputRef = useRef(null);
  const saveTimer = useRef(null);
  // サーバーからの読み込みに一度でも成功するまでは自動保存を止める安全弁。
  // これがないと、読み込み失敗時にサンプルデータへフォールバックした直後の
  // 自動保存でスプレッドシートの実データを上書き消去してしまう。
  const hasLoadedRef = useRef(false);
  // setProjectsは「サーバーからの読み込み」と「ユーザーの編集」を区別できないため、
  // 読み込み直後のsetProjectsで自動保存が誤発火しないようにするガード。
  // これがないと、読み込み結果がたまたま不完全だった場合にその内容がそのまま
  // 自動保存され、スプレッドシートの全件洗い替えで実データを消してしまう。
  const skipNextSaveRef = useRef(false);
  // 保存リクエストが多重に飛ぶと(GAS側はスプレッドシートのロックで直列化するため)
  // かえって待ち時間が伸びたりエラーになったりするので、実行中は次を「保留」にして
  // 完了後にまとめて最新状態を1回だけ送るようにするためのガード。
  const savingProjectsRef = useRef(false);
  const pendingProjectsSaveRef = useRef(false);
  const projectsRef = useRef(projects);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  const moyamoyaSaveTimer = useRef(null);
  const skipNextMoyamoyaSaveRef = useRef(false);
  const workAdjSaveTimer = useRef(null);
  const skipNextWorkAdjSaveRef = useRef(false);

  // 初回ロード
  const handleLoad = async () => {
    setSaveState("loading");
    try {
      const data = await loadAppData();
      if (data.projects.length > 0 || !hasLoadedRef.current) {
        skipNextSaveRef.current = true;
        setProjects(data.projects.length > 0 ? data.projects : seedProjects());
      }
      skipNextMoyamoyaSaveRef.current = true;
      setMoyamoyaNotes(data.moyamoyaNotes);
      skipNextWorkAdjSaveRef.current = true;
      setWorkAdj(data.workAdj);
      hasLoadedRef.current = true;
      setSaveState("idle");
      try {
        const kamo = await loadKamoTodos();
        setProjects((prev) => mergeKamoSync(prev, kamo.todos, kamo.subtasks));
      } catch {
        // カモの小屋側が読み込めなくても、タスクマニア自体の読み込みは成功扱いのまま続行する
      }
    } catch {
      // 既に一度でも読み込みに成功していれば、今持っているデータを保持したまま
      // エラー表示のみ行う(サンプルデータで上書きして自動保存させない)。
      if (!hasLoadedRef.current) {
        skipNextSaveRef.current = true;
        setProjects(seedProjects());
      }
      setSaveState("error");
    }
  };

  useEffect(() => { handleLoad(); }, []);

  // 変更時に自動保存(初回読み込みが成功するまでは保存しない)
  function runProjectsSave() {
    if (savingProjectsRef.current) { pendingProjectsSaveRef.current = true; return; }
    savingProjectsRef.current = true;
    gasSave(projectsRef.current)
      .then(() => {
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      })
      .catch(() => setSaveState("error"))
      .finally(() => {
        savingProjectsRef.current = false;
        if (pendingProjectsSaveRef.current) {
          pendingProjectsSaveRef.current = false;
          runProjectsSave();
        }
      });
  }
  useEffect(() => {
    if (projects === null || !hasLoadedRef.current) return;
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(runProjectsSave, 800);
    return () => clearTimeout(saveTimer.current);
  }, [projects]);

  const isFirstTabEffect = useRef(true);
  useEffect(() => {
    if (isFirstTabEffect.current) { isFirstTabEffect.current = false; if (topTab !== "総合") setAddOwner(topTab); return; }
    setSubTab("総合");
    if (topTab !== "総合") setAddOwner(topTab);
  }, [topTab]);

  const effectiveOwner = topTab === "総合" ? addOwner : topTab;
  const ownerHasSub = PERSON_KEYS.includes(effectiveOwner);
  const showTaskSections = true;

  useEffect(() => {
    if (!ownerHasSub) return;
    if (topTab === effectiveOwner && subTab !== "総合") setAddSub(subTab);
    else setAddSub((prev) => (REAL_SUBS.some((s) => s.key === prev) ? prev : REAL_SUBS[0].key));
  }, [effectiveOwner, subTab, topTab, ownerHasSub]);

  const visibleProjects = useMemo(() => {
    if (!projects) return [];
    if (topTab === "総合") return projects;
    if (topTab === "家族") return projects.filter((p) => p.owner === "家族");
    let list = projects.filter((p) => p.owner === topTab);
    if (subTab !== "総合") list = list.filter((p) => p.subcategory === subTab);
    return list;
  }, [projects, topTab, subTab]);

  const todayStr = toDateStr(new Date());
  const dayTasks = [];
  if (showTaskSections) {
    for (const p of visibleProjects) {
      for (const t of p.tasks) {
        for (const s of t.subtasks) {
          if (s.scheduledDate === dayViewDate) dayTasks.push({ pjId: p.id, pjName: p.name, taskId: t.id, taskName: t.name, sub: s });
        }
      }
    }
    dayTasks.sort((a, b) => {
      if (!a.sub.startTime && !b.sub.startTime) return 0;
      if (!a.sub.startTime) return 1;
      if (!b.sub.startTime) return -1;
      return a.sub.startTime.localeCompare(b.sub.startTime);
    });
  }

  const visibleDayTasks = dayTasks.filter((t) => !t.sub.done);

  // 残タスク: 表示中の日付(dayViewDate)より前が予定日で、まだ完了していないサブタスク
  const [overdueCollapsed, setOverdueCollapsed] = useState(true);
  const [overdueOpenDates, setOverdueOpenDates] = useState(() => new Set());
  function toggleOverdueDate(date) { setOverdueOpenDates((prev) => { const next = new Set(prev); next.has(date) ? next.delete(date) : next.add(date); return next; }); }

  const overdueTasks = [];
  if (showTaskSections) {
    for (const p of visibleProjects) {
      for (const t of p.tasks) {
        for (const s of t.subtasks) {
          if (s.scheduledDate && s.scheduledDate < dayViewDate && !s.done) overdueTasks.push({ pjId: p.id, pjName: p.name, taskId: t.id, taskName: t.name, sub: s });
        }
      }
    }
    overdueTasks.sort((a, b) => {
      if (a.sub.scheduledDate !== b.sub.scheduledDate) return a.sub.scheduledDate.localeCompare(b.sub.scheduledDate);
      if (!a.sub.startTime && !b.sub.startTime) return 0;
      if (!a.sub.startTime) return 1;
      if (!b.sub.startTime) return -1;
      return a.sub.startTime.localeCompare(b.sub.startTime);
    });
  }
  const overdueDates = [...new Set(overdueTasks.map((t) => t.sub.scheduledDate))].sort();

  // 日次未設定タスク一覧: 予定日が設定されておらず、まだ完了していないサブタスク
  const [unscheduledCollapsed, setUnscheduledCollapsed] = useState(true);
  const unscheduledTasks = [];
  if (showTaskSections) {
    for (const p of visibleProjects) {
      for (const t of p.tasks) {
        for (const s of t.subtasks) {
          if (!s.scheduledDate && !s.done) unscheduledTasks.push({ pjId: p.id, pjName: p.name, taskId: t.id, taskName: t.name, sub: s });
        }
      }
    }
    unscheduledTasks.sort((a, b) => a.pjName.localeCompare(b.pjName) || a.taskName.localeCompare(b.taskName));
  }

  // カレンダー(月/週/日)用: 予定日が入っている全サブタスクを日付ごとにグルーピング
  const calendarTasksByDate = useMemo(() => {
    const map = {};
    if (!showTaskSections) return map;
    for (const p of visibleProjects) {
      for (const t of p.tasks) {
        for (const s of t.subtasks) {
          if (!s.scheduledDate) continue;
          (map[s.scheduledDate] ||= []).push({ pjId: p.id, pjName: p.name, taskId: t.id, taskName: t.name, owner: p.owner, sub: s });
        }
      }
    }
    for (const d of Object.keys(map)) {
      map[d].sort((a, b) => {
        if (!a.sub.startTime && !b.sub.startTime) return 0;
        if (!a.sub.startTime) return 1;
        if (!b.sub.startTime) return -1;
        return a.sub.startTime.localeCompare(b.sub.startTime);
      });
    }
    return map;
  }, [visibleProjects, showTaskSections]);

  const calVisibleTasksByDate = useMemo(() => {
    if (calHiddenOwners.size === 0) return calendarTasksByDate;
    const map = {};
    for (const d of Object.keys(calendarTasksByDate)) {
      const items = calendarTasksByDate[d].filter((i) => !calHiddenOwners.has(i.owner));
      if (items.length > 0) map[d] = items;
    }
    return map;
  }, [calendarTasksByDate, calHiddenOwners]);

  function calShift(delta) {
    if (calGranularity === "month") setCalDate((d) => addMonthsStr(d, delta));
    else if (calGranularity === "week" || calGranularity === "weekday" || calGranularity === "weekend") setCalDate((d) => addDaysStr(d, delta * 7));
    else setCalDate((d) => addDaysStr(d, delta));
  }
  function calGoToday() {
    setCalDate(toDateStr(new Date()));
  }
  function calSelectDay(d) {
    setCalDate(d);
    setCalGranularity("day");
  }
  const calWeekDates = useMemo(() => {
    const monday = startOfWeek(new Date(calDate + "T00:00:00"));
    return Array.from({ length: 7 }, (_, i) => addDaysStr(toDateStr(monday), i));
  }, [calDate]);
  const calWeekdayDates = calWeekDates.slice(0, 5);
  const calWeekendDates = calWeekDates.slice(5, 7);
  const calLabel = calGranularity === "month"
    ? `${calDate.slice(0, 4)}年${Number(calDate.slice(5, 7))}月`
    : calGranularity === "week"
      ? `${formatDate(calWeekDates[0])} 〜 ${formatDate(calWeekDates[6])}`
      : calGranularity === "weekday"
        ? `${formatDate(calWeekdayDates[0])} 〜 ${formatDate(calWeekdayDates[4])}`
        : calGranularity === "weekend"
          ? `${formatDate(calWeekendDates[0])} 〜 ${formatDate(calWeekendDates[1])}`
          : `${formatDate(calDate)}(${DAY_JP[new Date(calDate + "T00:00:00").getDay()]})`;

  const showWorkSummary = topTab === "kkr" && subTab === "仕事";
  const totalEstMin = dayTasks.reduce((sum, t) => sum + (t.sub.estimatedMinutes || 0), 0);
  const totalActualMin = dayTasks.reduce((sum, t) => sum + (t.sub.actualMinutes || 0), 0);
  const estRatio = totalEstMin / WORK_MINUTES;
  const estWarnLevel = estRatio >= 0.8 ? "red" : estRatio >= 0.6 ? "amber" : null;
  // 脳バッジ用: 未来(表示中の日付が今日以降)は想定時間、過去は実績時間で集計する
  const dayBrainRatio = (dayViewDate >= todayStr ? totalEstMin : totalActualMin) / WORK_MINUTES;

  // もやもや(フリーテキストのメモ。スプレッドシート経由で端末間同期)
  const [moyamoyaNotes, setMoyamoyaNotes] = useState([]);
  const [moyamoyaNewText, setMoyamoyaNewText] = useState("");
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    if (skipNextMoyamoyaSaveRef.current) { skipNextMoyamoyaSaveRef.current = false; return; }
    clearTimeout(moyamoyaSaveTimer.current);
    moyamoyaSaveTimer.current = setTimeout(() => {
      gasSaveMoyamoyaNotes(moyamoyaNotes).catch(() => {});
    }, 800);
    return () => clearTimeout(moyamoyaSaveTimer.current);
  }, [moyamoyaNotes]);

  function addMoyamoyaNote(e) {
    if (e && e.preventDefault) e.preventDefault();
    const trimmed = moyamoyaNewText.trim();
    if (!trimmed) return;
    setMoyamoyaNotes((prev) => [...prev, { id: uid(), text: trimmed }]);
    setMoyamoyaNewText("");
  }
  function updateMoyamoyaNote(id, text) {
    setMoyamoyaNotes((prev) => prev.map((n) => (n.id === id ? { ...n, text } : n)));
  }
  function removeMoyamoyaNote(id) {
    setMoyamoyaNotes((prev) => prev.filter((n) => n.id !== id));
  }
  const moyamoyaPjCount = useMemo(() => visibleProjects.filter((pp) => !pp.status && pp.moyamoya).length, [visibleProjects]);
  const totalMoyamoyaCount = moyamoyaNotes.length + moyamoyaPjCount;

  // 稼働調整(今週・来週・先週で共通の日付単位の調整値。スプレッドシート経由で端末間同期)
  const [workAdj, setWorkAdj] = useState([]);
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    if (skipNextWorkAdjSaveRef.current) { skipNextWorkAdjSaveRef.current = false; return; }
    clearTimeout(workAdjSaveTimer.current);
    workAdjSaveTimer.current = setTimeout(() => {
      gasSaveWorkAdj(workAdj).catch(() => {});
    }, 800);
    return () => clearTimeout(workAdjSaveTimer.current);
  }, [workAdj]);

  // 今週のタスク
  const [adjDateVal, setAdjDateVal] = useState(() => {
    const today = new Date(); const day = today.getDay();
    if (day >= 1 && day <= 5) return toDateStr(today);
    const next = new Date(today); next.setDate(today.getDate() + (day === 0 ? 1 : 8 - day));
    return toDateStr(next);
  });
  const [adjHoursVal, setAdjHoursVal] = useState(1);
  const [weekCollapsed, setWeekCollapsed] = useState(true);
  const [weekOpenDates, setWeekOpenDates] = useState(() => new Set());
  function toggleWeekDate(date) { setWeekOpenDates((prev) => { const next = new Set(prev); next.has(date) ? next.delete(date) : next.add(date); return next; }); }

  const weekDates = useMemo(() => {
    const monday = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i); return toDateStr(d);
    });
  }, []);

  const weekTasks = useMemo(() => {
    if (!showTaskSections) return [];
    const tasks = [];
    for (const p of visibleProjects) {
      for (const t of p.tasks) {
        for (const s of t.subtasks) {
          if (weekDates.includes(s.scheduledDate))
            tasks.push({ pjId: p.id, pjName: p.name, taskId: t.id, taskName: t.name, sub: s });
        }
      }
    }
    tasks.sort((a, b) => {
      if (a.sub.scheduledDate !== b.sub.scheduledDate) return a.sub.scheduledDate.localeCompare(b.sub.scheduledDate);
      if (!a.sub.startTime && !b.sub.startTime) return 0;
      if (!a.sub.startTime) return 1; if (!b.sub.startTime) return -1;
      return a.sub.startTime.localeCompare(b.sub.startTime);
    });
    return tasks;
  }, [visibleProjects, weekDates, showTaskSections]);

  const weekSummary = useMemo(() => {
    const futureWeekdays = weekDates.filter(d => d >= todayStr && isWeekdayStr(d));
    const baseMinutes = futureWeekdays.length * 8 * 60;
    const adjMinutes = workAdj.filter(a => futureWeekdays.includes(a.date)).reduce((sum, a) => sum + a.hours * 60, 0);
    const effectiveMinutes = Math.max(0, baseMinutes - adjMinutes);
    const estMinutes = weekTasks.filter(t => t.sub.scheduledDate >= todayStr).reduce((sum, t) => sum + (t.sub.estimatedMinutes || 0), 0);
    const ratio = effectiveMinutes > 0 ? estMinutes / effectiveMinutes : 0;
    const warnLevel = ratio >= 0.8 ? "red" : ratio >= 0.6 ? "black" : null;
    // 脳バッジ用: 未来(今日以降)は想定時間、過去(週内の今日より前の日)は実績時間で集計し、
    // 分母も週全体の稼働可能時間(過去分含む)にする
    const weekdayDates = weekDates.filter(isWeekdayStr);
    const fullBaseMinutes = weekdayDates.length * 8 * 60;
    const fullAdjMinutes = workAdj.filter(a => weekdayDates.includes(a.date)).reduce((sum, a) => sum + a.hours * 60, 0);
    const fullEffectiveMinutes = Math.max(0, fullBaseMinutes - fullAdjMinutes);
    const pastActualMinutes = weekTasks.filter(t => t.sub.scheduledDate < todayStr).reduce((sum, t) => sum + (t.sub.actualMinutes || 0), 0);
    const brainRatio = fullEffectiveMinutes > 0 ? (estMinutes + pastActualMinutes) / fullEffectiveMinutes : 0;
    return { baseMinutes, adjMinutes, effectiveMinutes, estMinutes, ratio, warnLevel, brainRatio };
  }, [weekTasks, workAdj, weekDates, todayStr]);

  const addWeekAdj = () => {
    if (!adjDateVal || !adjHoursVal) return;
    setWorkAdj((prev) => {
      const others = prev.filter((a) => a.date !== adjDateVal);
      return [...others, { date: adjDateVal, hours: Number(adjHoursVal) }].sort((a, b) => a.date.localeCompare(b.date));
    });
  };
  const removeWeekAdj = (date) => setWorkAdj((prev) => prev.filter((a) => a.date !== date));

  // 来週のタスク(今週のタスクと同じ内容、期間のみ+7日)
  const [nextAdjDateVal, setNextAdjDateVal] = useState(() => {
    const today = new Date(); const day = today.getDay();
    const monday = startOfWeek(today);
    if (day >= 1 && day <= 5) { const d = new Date(today); d.setDate(today.getDate() + 7); return toDateStr(d); }
    const nextMonday = new Date(monday); nextMonday.setDate(monday.getDate() + 7);
    return toDateStr(nextMonday);
  });
  const [nextAdjHoursVal, setNextAdjHoursVal] = useState(1);
  const [nextWeekCollapsed, setNextWeekCollapsed] = useState(true);
  const [nextWeekOpenDates, setNextWeekOpenDates] = useState(() => new Set());
  function toggleNextWeekDate(date) { setNextWeekOpenDates((prev) => { const next = new Set(prev); next.has(date) ? next.delete(date) : next.add(date); return next; }); }

  const nextWeekDates = useMemo(() => {
    const monday = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + 7 + i); return toDateStr(d);
    });
  }, []);

  const nextWeekTasks = useMemo(() => {
    if (!showTaskSections) return [];
    const tasks = [];
    for (const p of visibleProjects) {
      for (const t of p.tasks) {
        for (const s of t.subtasks) {
          if (nextWeekDates.includes(s.scheduledDate))
            tasks.push({ pjId: p.id, pjName: p.name, taskId: t.id, taskName: t.name, sub: s });
        }
      }
    }
    tasks.sort((a, b) => {
      if (a.sub.scheduledDate !== b.sub.scheduledDate) return a.sub.scheduledDate.localeCompare(b.sub.scheduledDate);
      if (!a.sub.startTime && !b.sub.startTime) return 0;
      if (!a.sub.startTime) return 1; if (!b.sub.startTime) return -1;
      return a.sub.startTime.localeCompare(b.sub.startTime);
    });
    return tasks;
  }, [visibleProjects, nextWeekDates, showTaskSections]);

  const nextWeekSummary = useMemo(() => {
    const futureWeekdays = nextWeekDates.filter(d => d >= todayStr && isWeekdayStr(d));
    const baseMinutes = futureWeekdays.length * 8 * 60;
    const adjMinutes = workAdj.filter(a => futureWeekdays.includes(a.date)).reduce((sum, a) => sum + a.hours * 60, 0);
    const effectiveMinutes = Math.max(0, baseMinutes - adjMinutes);
    const estMinutes = nextWeekTasks.filter(t => t.sub.scheduledDate >= todayStr).reduce((sum, t) => sum + (t.sub.estimatedMinutes || 0), 0);
    const ratio = effectiveMinutes > 0 ? estMinutes / effectiveMinutes : 0;
    const warnLevel = ratio >= 0.8 ? "red" : ratio >= 0.6 ? "black" : null;
    return { baseMinutes, adjMinutes, effectiveMinutes, estMinutes, ratio, warnLevel };
  }, [nextWeekTasks, workAdj, nextWeekDates, todayStr]);

  const addNextWeekAdj = () => {
    if (!nextAdjDateVal || !nextAdjHoursVal) return;
    setWorkAdj((prev) => {
      const others = prev.filter((a) => a.date !== nextAdjDateVal);
      return [...others, { date: nextAdjDateVal, hours: Number(nextAdjHoursVal) }].sort((a, b) => a.date.localeCompare(b.date));
    });
  };
  const removeNextWeekAdj = (date) => setWorkAdj((prev) => prev.filter((a) => a.date !== date));

  // 先週のタスク(今週のタスクと同じ内容、期間のみ-7日。稼働調整はworkAdjを日付で参照)
  const [lastWeekCollapsed, setLastWeekCollapsed] = useState(true);
  const [lastWeekOpenDates, setLastWeekOpenDates] = useState(() => new Set());
  function toggleLastWeekDate(date) { setLastWeekOpenDates((prev) => { const next = new Set(prev); next.has(date) ? next.delete(date) : next.add(date); return next; }); }

  const lastWeekDates = useMemo(() => {
    const monday = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() - 7 + i); return toDateStr(d);
    });
  }, []);

  const lastWeekTasks = useMemo(() => {
    if (!showTaskSections) return [];
    const tasks = [];
    for (const p of visibleProjects) {
      for (const t of p.tasks) {
        for (const s of t.subtasks) {
          if (lastWeekDates.includes(s.scheduledDate))
            tasks.push({ pjId: p.id, pjName: p.name, taskId: t.id, taskName: t.name, sub: s });
        }
      }
    }
    tasks.sort((a, b) => {
      if (a.sub.scheduledDate !== b.sub.scheduledDate) return a.sub.scheduledDate.localeCompare(b.sub.scheduledDate);
      if (!a.sub.startTime && !b.sub.startTime) return 0;
      if (!a.sub.startTime) return 1; if (!b.sub.startTime) return -1;
      return a.sub.startTime.localeCompare(b.sub.startTime);
    });
    return tasks;
  }, [visibleProjects, lastWeekDates, showTaskSections]);

  const lastWeekSummary = useMemo(() => {
    const estMinutes = lastWeekTasks.reduce((sum, t) => sum + (t.sub.estimatedMinutes || 0), 0);
    const actualMinutes = lastWeekTasks.reduce((sum, t) => sum + (t.sub.actualMinutes || 0), 0);
    const weekdayDates = lastWeekDates.filter(isWeekdayStr);
    const rawMinutes = weekdayDates.length * 8 * 60;
    const adjMinutes = workAdj.filter((a) => weekdayDates.includes(a.date)).reduce((sum, a) => sum + a.hours * 60, 0);
    const baseMinutes = Math.max(0, rawMinutes - adjMinutes);
    const ratio = baseMinutes > 0 ? actualMinutes / baseMinutes : 0;
    return { estMinutes, actualMinutes, baseMinutes, ratio };
  }, [lastWeekTasks, lastWeekDates, workAdj]);

  const openCountFor = (owner, subcat) => {
    if (!projects) return 0;
    let open = 0;
    for (const p of projects) {
      if (p.owner !== owner) continue;
      if (subcat != null && p.subcategory !== subcat) continue;
      for (const t of p.tasks) for (const s of t.subtasks) if (!s.done) open += 1;
    }
    return open;
  };

  const topBadge = (key) => {
    if (!projects) return 0;
    if (key === "総合") { let open = 0; for (const p of projects) for (const t of p.tasks) for (const s of t.subtasks) if (!s.done) open += 1; return open; }
    return openCountFor(key, null);
  };

  function toggleOpenPJ(id) { setOpenPJ((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  function toggleOpenTask(id) { setOpenTask((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  function toggleShowDoneSubtasks(id) { setShowDoneSubtasks((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  function toggleShowCompletedTasks(pjId) { setShowCompletedTasks((prev) => { const next = new Set(prev); next.has(pjId) ? next.delete(pjId) : next.add(pjId); return next; }); }
  function toggleShowCompletedPJSection(key) { setShowCompletedPJSections((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; }); }
  function togglePrioritySection(v) { setCollapsedPrioritySection((prev) => { const next = new Set(prev); next.has(v) ? next.delete(v) : next.add(v); return next; }); }

  function updatePJPriority(pjId, priority) {
    setProjects((prev) => prev.map((p) => (p.id === pjId ? { ...p, priority } : p)));
  }

  function togglePJMoyamoya(pjId) {
    setProjects((prev) => prev.map((p) => (p.id === pjId ? { ...p, moyamoya: !p.moyamoya } : p)));
  }

  function movePJInSection(groupIds, pjId, direction) {
    const idx = groupIds.indexOf(pjId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= groupIds.length) return;
    const targetId = groupIds[swapIdx];
    setProjects((prev) => {
      const a = prev.findIndex((p) => p.id === pjId);
      const b = prev.findIndex((p) => p.id === targetId);
      if (a === -1 || b === -1) return prev;
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  }

  function moveTaskInPJ(pjId, taskId, direction) {
    setProjects((prev) => prev.map((p) => {
      if (p.id !== pjId) return p;
      const idx = p.tasks.findIndex((t) => t.id === taskId);
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (idx === -1 || swapIdx < 0 || swapIdx >= p.tasks.length) return p;
      const tasks = [...p.tasks];
      [tasks[idx], tasks[swapIdx]] = [tasks[swapIdx], tasks[idx]];
      return { ...p, tasks };
    }));
  }

  function updatePJStatus(pjId, status) {
    setProjects((prev) => prev.map((p) => (p.id === pjId ? { ...p, status: status || null } : p)));
  }

  function updatePJName(pjId, name) {
    setProjects((prev) => prev.map((p) => (p.id === pjId ? { ...p, name } : p)));
  }

  function updatePJNote(pjId, field, value) {
    setProjects((prev) => prev.map((p) => (p.id === pjId ? { ...p, [field]: value } : p)));
  }

  function updateTaskName(pjId, taskId, name) {
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, name } : t)) }));
  }

  function toggleTaskDone(pjId, taskId) {
    const p = projects.find((p) => p.id === pjId);
    const t = p?.tasks.find((t) => t.id === taskId);
    if (t && !t.done) {
      setStamping(taskId);
      setTimeout(() => setStamping(null), 550);
    }
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) }));
  }

  function updateSubtaskText(pjId, taskId, subId, text) {
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : { ...p, tasks: p.tasks.map((t) => t.id !== taskId ? t : { ...t, subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, text } : s)) }) }));
  }

  function addItem(e) {
    if (e && e.preventDefault) e.preventDefault();
    const trimmed = (inputRef.current ? inputRef.current.value : addText).trim();
    if (!trimmed) return;
    if (addLevel === "pj") {
      setProjects((prev) => [...prev, project(effectiveOwner, trimmed, [], ownerHasSub ? addSub : null, addPJPriority)]);
    } else if (addLevel === "task") {
      if (!addPJId) return;
      setProjects((prev) => prev.map((p) => (p.id === addPJId ? { ...p, tasks: [...p.tasks, task(trimmed, [], addTaskStartDate, addTaskEndDate)] } : p)));
    } else {
      if (!addPJId || !addTaskId) return;
      const parentTask = projects.find((p) => p.id === addPJId)?.tasks.find((t) => t.id === addTaskId);
      let clampedDate = addDate || null;
      if (clampedDate && parentTask) {
        if (parentTask.startDate && clampedDate < parentTask.startDate) clampedDate = parentTask.startDate;
        if (parentTask.endDate && clampedDate > parentTask.endDate) clampedDate = parentTask.endDate;
      }
      setProjects((prev) => prev.map((p) => {
        if (p.id !== addPJId) return p;
        return { ...p, tasks: p.tasks.map((t) => t.id === addTaskId ? { ...t, subtasks: [...t.subtasks, sub(trimmed, false, addPriority, clampedDate, addStartTime, addEstMinutes ? Number(addEstMinutes) : null)] } : t) };
      }));
    }
    setAddText(""); setAddDate(""); setAddStartTime(""); setAddEstMinutes(""); setAddTaskStartDate(""); setAddTaskEndDate("");
    setAddModalOpen(false);
  }

  function openAddPJModal() {
    setAddLevel("pj");
    setAddText("");
    setAddModalOpen(true);
  }

  function openAddTaskModal(pjId, pjName) {
    setAddLevel("task");
    setAddPJId(pjId);
    setModalPJName(pjName);
    setAddText(""); setAddTaskStartDate(""); setAddTaskEndDate("");
    setAddModalOpen(true);
  }

  function openAddSubtaskModal(pjId, taskId, pjName, taskName) {
    setAddLevel("subtask");
    setAddPJId(pjId);
    setAddTaskId(taskId);
    setModalPJName(pjName);
    setModalTaskName(taskName);
    setAddText(""); setAddDate(""); setAddStartTime(""); setAddEstMinutes("");
    setAddModalOpen(true);
  }

  function toggleSubtaskDone(pjId, taskId, subId) {
    const p = projects.find((p) => p.id === pjId);
    const t = p?.tasks.find((t) => t.id === taskId);
    const s = t?.subtasks.find((s) => s.id === subId);
    const completing = s && !s.done;
    if (completing) {
      setStamping(subId);
      setTimeout(() => setStamping(null), 550);
      if (runningTarget && runningTarget.subId === subId) {
        commitStopwatch(runningTarget);
        setRunningTarget(null);
      }
    }
    setProjects((prev) => prev.map((pp) => {
      if (pp.id !== pjId) return pp;
      return {
        ...pp, tasks: pp.tasks.map((tt) => {
          if (tt.id !== taskId) return tt;
          const subtasks = tt.subtasks.map((ss) => (ss.id === subId ? { ...ss, done: !ss.done, doneUpdatedAt: Date.now() } : ss));
          if (completing && s.repeatWeekday != null && s.scheduledDate) {
            const shiftHoliday = pp.owner === "kkr" && pp.subcategory === "仕事";
            const nextDate = computeNextRecurrenceDate(s.scheduledDate, s.repeatWeekday, shiftHoliday);
            if (!tt.endDate || nextDate <= tt.endDate) {
              const idx = subtasks.findIndex((ss) => ss.id === subId);
              const nextSub = {
                ...s,
                id: uid(),
                done: false,
                actualMinutes: null,
                scheduledDate: nextDate,
                createdAt: Date.now(),
                steps: (s.steps || []).map((st) => ({ ...st, id: uid(), done: false })),
              };
              subtasks.splice(idx + 1, 0, nextSub);
            }
          }
          return { ...tt, subtasks };
        }),
      };
    }));
  }

  function updateSubtaskSchedule(pjId, taskId, subId, field, value) {
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : {
      ...p, tasks: p.tasks.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t, subtasks: t.subtasks.map((s) => {
            if (s.id !== subId) return s;
            let v = value === "" ? null : value;
            if (field === "scheduledDate" && v) {
              if (t.startDate && v < t.startDate) v = t.startDate;
              if (t.endDate && v > t.endDate) v = t.endDate;
            }
            return { ...s, [field]: v };
          }),
        };
      }),
    }));
  }

  function updateTaskDate(pjId, taskId, field, value) {
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, [field]: value || null } : t)) }));
  }

  function updateTaskEstimatedMinutes(pjId, taskId, value) {
    const v = value === "" ? null : Number(value);
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, estimatedMinutes: v } : t)) }));
  }

  function stopwatchElapsedMs(target) {
    if (!target) return 0;
    return (target.accumulatedMs || 0) + (target.paused ? 0 : Date.now() - target.startAt);
  }

  function commitStopwatch(target) {
    if (!target) return;
    const rawMin = stopwatchElapsedMs(target) / 60000;
    if (rawMin <= 0) return;
    const elapsedMin = Math.max(15, Math.round(rawMin / 15) * 15);
    const { pjId, taskId, subId } = target;
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : { ...p, tasks: p.tasks.map((t) => t.id !== taskId ? t : { ...t, subtasks: t.subtasks.map((s) => s.id === subId ? { ...s, actualMinutes: (s.actualMinutes || 0) + elapsedMin } : s) }) }));
  }

  function toggleStopwatch(pjId, taskId, subId) {
    if (runningTarget && runningTarget.subId === subId) {
      if (runningTarget.paused) {
        setRunningTarget({ ...runningTarget, paused: false, startAt: Date.now() });
      } else {
        setRunningTarget({ ...runningTarget, paused: true, accumulatedMs: stopwatchElapsedMs(runningTarget), startAt: null });
      }
      return;
    }
    if (runningTarget) commitStopwatch(runningTarget);
    setRunningTarget({ pjId, taskId, subId, startAt: Date.now(), accumulatedMs: 0, paused: false });
  }

  // 一時停止中の計測時間を手修正(止め忘れて計測が長くなりすぎた場合の救済用)
  function updateRunningAccumulatedMinutes(value) {
    if (!runningTarget || !runningTarget.paused) return;
    const minutes = Math.max(0, Number(value) || 0);
    setRunningTarget({ ...runningTarget, accumulatedMs: minutes * 60000 });
  }

  function renderStopwatchControl(pjId, taskId, subId) {
    const isActive = runningTarget?.subId === subId;
    const isPaused = isActive && runningTarget.paused;
    const isRunning = isActive && !runningTarget.paused;
    if (isPaused) {
      const minutes = Math.floor(stopwatchElapsedMs(runningTarget) / 60000);
      return (
        <span style={styles.stopwatchEditGroup}>
          <input type="number" min="0" step="1" value={minutes}
            onChange={(e) => updateRunningAccumulatedMinutes(e.target.value)}
            style={styles.stopwatchEditInput} aria-label="計測時間を修正(分)" />
          <button type="button" onClick={() => toggleStopwatch(pjId, taskId, subId)}
            style={{ ...styles.stopwatchBtn, background: "transparent", color: "#12314F", borderColor: "#12314F" }}
            aria-label="計測を再開">▶</button>
        </span>
      );
    }
    return (
      <button type="button" onClick={() => toggleStopwatch(pjId, taskId, subId)}
        style={{ ...styles.stopwatchBtn, background: isRunning ? "#F39800" : "transparent", color: isRunning ? "#FFFFFF" : "#12314F", borderColor: "#12314F" }}
        aria-label={isActive ? "一時停止" : "計測を開始"}>
        {isRunning ? (() => { const sec = Math.max(0, Math.floor(stopwatchElapsedMs(runningTarget) / 1000)); return `⏸ ${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; })() : "▶"}
      </button>
    );
  }

  // サブタスクをGoogleカレンダーへ送る(予定日が入っているサブタスクのみ)
  const [sendingCalId, setSendingCalId] = useState(null);
  const [calSendFeedback, setCalSendFeedback] = useState({});
  async function sendSubtaskToCalendar(s) {
    setSendingCalId(s.id);
    try {
      await gasSendToCalendar({ title: s.text, date: s.scheduledDate, startTime: s.startTime, estimatedMinutes: s.estimatedMinutes });
      setCalSendFeedback((prev) => ({ ...prev, [s.id]: "ok" }));
    } catch {
      setCalSendFeedback((prev) => ({ ...prev, [s.id]: "error" }));
    } finally {
      setSendingCalId(null);
      setTimeout(() => setCalSendFeedback((prev) => {
        const next = { ...prev };
        delete next[s.id];
        return next;
      }), 2000);
    }
  }
  function renderSendToCalendarButton(s) {
    if (!s.scheduledDate) return null;
    const sending = sendingCalId === s.id;
    const feedback = calSendFeedback[s.id];
    const label = sending ? "送信中" : feedback === "ok" ? "✓送った" : feedback === "error" ? "!失敗" : "📤送る";
    return (
      <button type="button" onClick={() => sendSubtaskToCalendar(s)} disabled={sending} aria-label="Googleカレンダーに送る" style={styles.inlineAddBtn}>
        {label}
      </button>
    );
  }

  function moveSubtask(fromPjId, fromTaskId, subId, toPjId, toTaskId) {
    setProjects((prev) => {
      let moved = null;
      const removed = prev.map((p) => {
        if (p.id !== fromPjId) return p;
        return { ...p, tasks: p.tasks.map((t) => {
          if (t.id !== fromTaskId) return t;
          const idx = t.subtasks.findIndex((s) => s.id === subId);
          if (idx === -1) return t;
          moved = t.subtasks[idx];
          return { ...t, subtasks: t.subtasks.filter((s) => s.id !== subId) };
        }) };
      });
      if (!moved) return prev;
      return removed.map((p) => (p.id !== toPjId ? p : { ...p, tasks: p.tasks.map((t) => (t.id === toTaskId ? { ...t, subtasks: [...t.subtasks, moved] } : t)) }));
    });
  }

  function moveTask(fromPjId, taskId, toPjId) {
    if (fromPjId === toPjId) return;
    setProjects((prev) => {
      let moved = null;
      const removed = prev.map((p) => {
        if (p.id !== fromPjId) return p;
        const idx = p.tasks.findIndex((t) => t.id === taskId);
        if (idx === -1) return p;
        moved = p.tasks[idx];
        return { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) };
      });
      if (!moved) return prev;
      return removed.map((p) => (p.id === toPjId ? { ...p, tasks: [...p.tasks, moved] } : p));
    });
  }

  function removePJ(id) {
    const p = projects.find((pp) => pp.id === id);
    if (!window.confirm(`PJ「${p?.name || ""}」を削除します。配下のタスク・サブタスクも全て消えるが、よいか?`)) return;
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }
  function removeTask(pjId, taskId) {
    const p = projects.find((pp) => pp.id === pjId);
    const t = p?.tasks.find((tt) => tt.id === taskId);
    if (!window.confirm(`タスク「${t?.name || ""}」を削除します。配下のサブタスクも全て消えるが、よいか?`)) return;
    setProjects((prev) => prev.map((p) => (p.id === pjId ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) } : p)));
  }
  function removeSubtask(pjId, taskId, subId) {
    const p = projects.find((pp) => pp.id === pjId);
    const t = p?.tasks.find((tt) => tt.id === taskId);
    const s = t?.subtasks.find((ss) => ss.id === subId);
    if (!window.confirm(`サブタスク「${s?.text || ""}」を削除するが、よいか?`)) return;
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : { ...p, tasks: p.tasks.map((t) => t.id !== taskId ? t : { ...t, subtasks: t.subtasks.filter((s) => s.id !== subId) }) }));
  }
  function duplicateSubtask(pjId, taskId, subId, overrides = {}) {
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : {
      ...p, tasks: p.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const idx = t.subtasks.findIndex((s) => s.id === subId);
        if (idx === -1) return t;
        const orig = t.subtasks[idx];
        const copy = {
          ...orig,
          ...overrides,
          id: uid(),
          done: false,
          actualMinutes: null,
          createdAt: Date.now(),
          steps: (orig.steps || []).map((st) => ({ ...st, id: uid(), done: false })),
        };
        const subtasks = [...t.subtasks];
        subtasks.splice(idx + 1, 0, copy);
        return { ...t, subtasks };
      }),
    }));
  }

  function openStepsModal(pjId, taskId, subId) { setStepsModalTarget({ pjId, taskId, subId }); setNewStepText(""); }
  function closeStepsModal() { setStepsModalTarget(null); setNewStepText(""); }

  function toggleStepDone(pjId, taskId, subId, stepId) {
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : {
      ...p, tasks: p.tasks.map((t) => t.id !== taskId ? t : {
        ...t, subtasks: t.subtasks.map((s) => {
          if (s.id !== subId) return s;
          const steps = (s.steps || []).map((st) => (st.id === stepId ? { ...st, done: !st.done } : st));
          const allDone = steps.length > 0 && steps.every((st) => st.done);
          return { ...s, steps, done: allDone, doneUpdatedAt: allDone !== s.done ? Date.now() : s.doneUpdatedAt };
        }),
      }),
    }));
  }

  function addStep(pjId, taskId, subId, text) {
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : {
      ...p, tasks: p.tasks.map((t) => t.id !== taskId ? t : {
        ...t, subtasks: t.subtasks.map((s) => (s.id !== subId ? s : { ...s, steps: [...(s.steps || []), step(text)] })),
      }),
    }));
  }

  function removeStep(pjId, taskId, subId, stepId) {
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : {
      ...p, tasks: p.tasks.map((t) => t.id !== taskId ? t : {
        ...t, subtasks: t.subtasks.map((s) => {
          if (s.id !== subId) return s;
          const steps = (s.steps || []).filter((st) => st.id !== stepId);
          const allDone = steps.length > 0 && steps.every((st) => st.done);
          const nextDone = steps.length > 0 ? allDone : s.done;
          return { ...s, steps, done: nextDone, doneUpdatedAt: nextDone !== s.done ? Date.now() : s.doneUpdatedAt };
        }),
      }),
    }));
  }

  function updateStepText(pjId, taskId, subId, stepId, text) {
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : {
      ...p, tasks: p.tasks.map((t) => t.id !== taskId ? t : {
        ...t, subtasks: t.subtasks.map((s) => (s.id !== subId ? s : { ...s, steps: (s.steps || []).map((st) => (st.id === stepId ? { ...st, text } : st)) })),
      }),
    }));
  }

  const activeTopColor = TOP_TABS.find((c) => c.key === topTab).color;
  const ownerColorOf = (key) => TOP_TABS.find((c) => c.key === key)?.color || activeTopColor;

  const saveLabel = { idle: "", loading: "読込中…", saving: "保存中…", saved: "保存済み", error: "保存失敗" }[saveState];

  function renderPrioritySection(sec) {
    const group = sec.group;
    if (group.length === 0 && !sec.moyamoya) return null;
    const sectionOpen = !collapsedPrioritySection.has(sec.key);
    return (
      <div key={sec.key} style={sec.small ? styles.statusSection : styles.prioritySection}>
        <div style={{ display: "flex", alignItems: "center", width: "100%", borderBottom: sec.small ? "1px dashed" : "1.5px solid", borderColor: sec.color, paddingBottom: sec.small ? 3 : 4, opacity: sec.small ? 0.85 : 1 }}>
          <button type="button" onClick={() => togglePrioritySection(sec.key)} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: sec.small ? 11 : 12.5, fontWeight: 700, textAlign: "left", color: sec.color }}>
            <span>{sectionOpen ? "▾" : "▸"}</span>
            <span>{sec.label}</span>
            <span style={styles.prioritySectionCount}>{group.length}</span>
          </button>
          {!sec.small && !sec.moyamoya && (
            <button type="button" onClick={() => toggleShowCompletedPJSection(sec.key)}
              style={{ ...styles.eyeToggleBtn, background: showCompletedPJSections.has(sec.key) ? "#F0F0F0" : "transparent" }}
              aria-label={showCompletedPJSections.has(sec.key) ? "完了済みPJを隠す" : "完了済みPJを表示"}>
              {showCompletedPJSections.has(sec.key) ? "👁" : "🙈"}
            </button>
          )}
        </div>
        {sectionOpen && (
          <div style={styles.prioritySectionBody}>
            {sec.moyamoya && (
              <div style={styles.moyamoyaNotes}>
                <form onSubmit={addMoyamoyaNote} style={styles.moyamoyaAddForm}>
                  <input type="text" value={moyamoyaNewText} onChange={(e) => setMoyamoyaNewText(e.target.value)}
                    placeholder="もやもやしていることを書く…" style={styles.moyamoyaInput} aria-label="もやもやを追加" />
                  <button type="submit" style={styles.moyamoyaAddBtn}>＋</button>
                </form>
                {moyamoyaNotes.map((n) => (
                  <div key={n.id} style={styles.moyamoyaNoteRow}>
                    <input type="text" value={n.text} onChange={(e) => updateMoyamoyaNote(n.id, e.target.value)}
                      style={styles.moyamoyaInput} aria-label="もやもやを編集" />
                    <button type="button" onClick={() => removeMoyamoyaNote(n.id)} aria-label="もやもやを削除" style={styles.deleteBtn}>×</button>
                  </div>
                ))}
              </div>
            )}
            {!sec.small && !sec.moyamoya && !showCompletedPJSections.has(sec.key) && group.length > 0 && group.every(pjEffectivelyDone) && (
              <p style={styles.emptySmall}>完了済みPJのみ(👁で表示できる)</p>
            )}
            {group.map((p, pIdx) => {
              if (!sec.small && !sec.moyamoya && !showCompletedPJSections.has(sec.key) && pjEffectivelyDone(p)) return null;
              const groupIds = group.map((gp) => gp.id);
              const pjOpen = openPJ.has(p.id);
              const { done: pd, total: pt } = pjProgress(p);
              const oColor = ownerColorOf(p.owner);
              return (
                <div key={p.id} style={{ ...styles.pjCard, borderLeftColor: oColor }} className="row-in">
                  <div style={styles.pjHeader} className="pj-header">
                    <div style={styles.reorderBtns}>
                      <button type="button" onClick={() => movePJInSection(groupIds, p.id, "up")} disabled={pIdx === 0} style={{ ...styles.reorderBtn, opacity: pIdx === 0 ? 0.3 : 1, cursor: pIdx === 0 ? "default" : "pointer" }} aria-label="上へ移動">▲</button>
                      <button type="button" onClick={() => movePJInSection(groupIds, p.id, "down")} disabled={pIdx === groupIds.length - 1} style={{ ...styles.reorderBtn, opacity: pIdx === groupIds.length - 1 ? 0.3 : 1, cursor: pIdx === groupIds.length - 1 ? "default" : "pointer" }} aria-label="下へ移動">▼</button>
                    </div>
                    <button onClick={() => toggleOpenPJ(p.id)} style={styles.collapseBtn} aria-label={pjOpen ? "折りたたむ" : "展開する"}>{pjOpen ? "▾" : "▸"}</button>
                    <input type="text" value={p.name} onChange={(e) => updatePJName(p.id, e.target.value)} style={styles.pjNameInput} className="pj-title-input" aria-label="PJ名を編集" />
                    {pt > 0 && pd === pt && <span style={styles.doneMark}>✅</span>}
                    <button type="button" onClick={() => setPjDetailModal(p.id)} style={styles.ganttToggleBtn} aria-label="ガントチャートを表示">📊</button>
                    <button type="button" onClick={() => toggleShowCompletedTasks(p.id)}
                      style={{ ...styles.eyeToggleBtn, background: showCompletedTasks.has(p.id) ? "#F0F0F0" : "transparent" }}
                      aria-label={showCompletedTasks.has(p.id) ? "完了済みタスクを隠す" : "完了済みタスクを表示"}>
                      {showCompletedTasks.has(p.id) ? "👁" : "🙈"}
                    </button>
                    <button type="button" onClick={() => togglePJMoyamoya(p.id)}
                      style={{ ...styles.moyamoyaToggleBtn, background: p.moyamoya ? MOYAMOYA_COLOR : "transparent", color: p.moyamoya ? "#FFFFFF" : MOYAMOYA_COLOR, borderColor: MOYAMOYA_COLOR }}
                      aria-label={p.moyamoya ? "もやもやから外す" : "もやもやに入れる"}>もや</button>
                    <select value={p.priority || 2} onChange={(e) => updatePJPriority(p.id, Number(e.target.value))} style={styles.moveSelect} aria-label="優先度を変更">
                      {PJ_PRIORITIES.map((pr) => <option key={pr.v} value={pr.v}>{pr.label}</option>)}
                    </select>
                    <select value={p.status || ""} onChange={(e) => updatePJStatus(p.id, e.target.value)} style={styles.moveSelect} aria-label="状態を変更">
                      <option value="">進行中</option>
                      {PJ_STATUSES.map((st) => <option key={st.v} value={st.v}>{st.label}</option>)}
                    </select>
                    {topTab === "総合" && <span style={{ ...styles.metaTag, borderColor: oColor, color: oColor }}>{TOP_TABS.find((c) => c.key === p.owner)?.label}</span>}
                    {(topTab === "総合" || subTab === "総合") && p.subcategory && (
                      <span style={{ ...styles.metaTag, borderColor: SUB_TABS.find((s) => s.key === p.subcategory)?.color, color: SUB_TABS.find((s) => s.key === p.subcategory)?.color }}>{p.subcategory}</span>
                    )}
                    <span style={styles.progressTag}>{pd}/{pt}</span>
                    <button type="button" onClick={() => openAddTaskModal(p.id, p.name)} style={styles.inlineAddBtn}>＋タスク</button>
                    <button onClick={() => removePJ(p.id)} aria-label="PJを削除" style={styles.deleteBtn}>×</button>
                  </div>
                  {pjOpen && (
                    <div style={styles.taskList}>
                      {p.tasks.length === 0 && <p style={styles.emptySmall}>タスクなし</p>}
                      {p.tasks.length > 0 && !showCompletedTasks.has(p.id) && p.tasks.every(taskEffectivelyDone) && (
                        <p style={styles.emptySmall}>完了済みタスクのみ(👁で表示できる)</p>
                      )}
                      {p.tasks.map((t, tIdx) => {
                        if (!showCompletedTasks.has(p.id) && taskEffectivelyDone(t)) return null;
                        const taskOpen = openTask.has(t.id);
                        const { done: td, total: tt } = taskProgress(t);
                        return (
                          <div key={t.id} style={styles.taskCard} className="row-in">
                            <div style={styles.taskHeader} className="task-header">
                              <div style={styles.reorderBtns}>
                                <button type="button" onClick={() => moveTaskInPJ(p.id, t.id, "up")} disabled={tIdx === 0} style={{ ...styles.reorderBtn, opacity: tIdx === 0 ? 0.3 : 1, cursor: tIdx === 0 ? "default" : "pointer" }} aria-label="上へ移動">▲</button>
                                <button type="button" onClick={() => moveTaskInPJ(p.id, t.id, "down")} disabled={tIdx === p.tasks.length - 1} style={{ ...styles.reorderBtn, opacity: tIdx === p.tasks.length - 1 ? 0.3 : 1, cursor: tIdx === p.tasks.length - 1 ? "default" : "pointer" }} aria-label="下へ移動">▼</button>
                              </div>
                              <button onClick={() => toggleOpenTask(t.id)} style={styles.collapseBtnSm} aria-label={taskOpen ? "折りたたむ" : "展開する"}>{taskOpen ? "▾" : "▸"}</button>
                              <button onClick={() => toggleTaskDone(p.id, t.id)} aria-label={t.done ? "未完了に戻す" : "完了にする"} style={styles.stampWrap}>
                                {t.done ? <span style={styles.hankoStamp} className={stamping === t.id ? "hanko-pop" : ""}>済</span> : <span style={styles.hankoEmpty} />}
                              </button>
                              <input type="text" value={t.name} onChange={(e) => updateTaskName(p.id, t.id, e.target.value)} style={{ ...styles.taskNameInput, textDecoration: t.done ? "line-through" : "underline", color: t.done ? "#9B9B9B" : "#2C3645" }} className="task-title-input" aria-label="タスク名を編集" />
                              {(t.done || (tt > 0 && td === tt)) && <span style={styles.doneMark}>✅</span>}
                              <span style={styles.progressTagSm}>{td}/{tt}</span>
                              <button type="button" onClick={() => toggleShowDoneSubtasks(t.id)}
                                style={{ ...styles.eyeToggleBtn, background: showDoneSubtasks.has(t.id) ? "#F0F0F0" : "transparent" }}
                                aria-label={showDoneSubtasks.has(t.id) ? "完了済みサブタスクを隠す" : "完了済みサブタスクを表示"}>
                                {showDoneSubtasks.has(t.id) ? "👁" : "🙈"}
                              </button>
                              <select value={p.id} onChange={(e) => moveTask(p.id, t.id, e.target.value)} style={styles.moveSelect} aria-label="PJを変更">
                                {projects.map((pp) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                              </select>
                              <button type="button" onClick={() => openAddSubtaskModal(p.id, t.id, p.name, t.name)} style={styles.inlineAddBtn}>＋サブ</button>
                              <button onClick={() => removeTask(p.id, t.id)} aria-label="タスクを削除" style={styles.deleteBtn}>×</button>
                            </div>
                            <div style={styles.taskDatesRow}>
                              <label style={styles.scheduleEditField}>
                                <span style={styles.scheduleEditLabel}>開始日</span>
                                <input type="date" value={t.startDate || ""} onChange={(e) => updateTaskDate(p.id, t.id, "startDate", e.target.value)} max={t.endDate || undefined} style={styles.scheduleEditInput} aria-label="タスク開始日" />
                              </label>
                              <label style={styles.scheduleEditField}>
                                <span style={styles.scheduleEditLabel}>終了日</span>
                                <input type="date" value={t.endDate || ""} onChange={(e) => updateTaskDate(p.id, t.id, "endDate", e.target.value)} min={t.startDate || undefined} style={styles.scheduleEditInput} aria-label="タスク終了日" />
                              </label>
                              <label style={styles.scheduleEditField}>
                                <span style={styles.scheduleEditLabel}>想定(分・手入力優先)</span>
                                <input type="number" min="0" step="15" value={t.estimatedMinutes ?? ""} onChange={(e) => updateTaskEstimatedMinutes(p.id, t.id, e.target.value)}
                                  placeholder={taskEstimatedSubtotal(t) ? String(taskEstimatedSubtotal(t)) : "―"} style={{ ...styles.scheduleEditInput, width: 64 }} aria-label="タスク想定時間(分)" />
                              </label>
                              <span style={styles.calEstTag} title={t.estimatedMinutes != null ? "手入力値" : "サブタスクの想定(分)の合計"}>想定{taskEstimatedEffective(t) ? formatDuration(taskEstimatedEffective(t)) : "―"}</span>
                              <span style={styles.calEstTag} title="サブタスクの実績(分)の合計">実績{taskActualSubtotal(t) ? formatDuration(taskActualSubtotal(t)) : "―"}</span>
                            </div>
                            {taskOpen && (() => {
                              const doneHidden = !showDoneSubtasks.has(t.id);
                              const visibleSubtasks = doneHidden ? t.subtasks.filter((s) => !s.done) : t.subtasks;
                              return (
                              <ul style={styles.subList}>
                                {t.subtasks.length === 0 && <li style={styles.emptySmall}>サブタスクなし</li>}
                                {t.subtasks.length > 0 && visibleSubtasks.length === 0 && <li style={styles.emptySmall}>完了済みサブタスクのみ(👁で表示できる)</li>}
                                {visibleSubtasks.map((s) => {
                                  const pInfo = PRIORITIES.find((pr) => pr.v === s.priority);
                                  return (
                                    <li key={s.id} style={styles.subRowWrap} className="row-in">
                                      <div style={styles.subRow} className="sub-row">
                                        <button onClick={() => toggleSubtaskDone(p.id, t.id, s.id)} aria-label={s.done ? "未完了に戻す" : "完了にする"} style={styles.stampWrap}>
                                          {s.done ? <span style={styles.hankoStamp} className={stamping === s.id ? "hanko-pop" : ""}>済</span> : <span style={styles.hankoEmpty} />}
                                        </button>
                                        <div style={styles.subBody} className="sub-body">
                                          <input type="text" value={s.text} onChange={(e) => updateSubtaskText(p.id, t.id, s.id, e.target.value)} style={{ ...styles.subTextInput, textDecoration: s.done ? "line-through" : "none", color: s.done ? "#9B9B9B" : "#2C3645" }} aria-label="サブタスク名を編集" />
                                          <div style={styles.scheduleEditRow}>
                                            <label style={styles.scheduleEditField}>
                                              <span style={styles.scheduleEditLabel}>予定日</span>
                                              <input type="date" value={s.scheduledDate || ""} onChange={(e) => updateSubtaskSchedule(p.id, t.id, s.id, "scheduledDate", e.target.value)} min={t.startDate || undefined} max={t.endDate || undefined} style={styles.scheduleEditInput} />
                                            </label>
                                            <label style={styles.scheduleEditField}>
                                              <span style={styles.scheduleEditLabel}>繰り返し{p.owner === "kkr" && p.subcategory === "仕事" ? "(休日は翌日へ)" : ""}</span>
                                              <select value={s.repeatWeekday ?? ""} onChange={(e) => updateSubtaskSchedule(p.id, t.id, s.id, "repeatWeekday", e.target.value === "" ? "" : (["weekday", "satsun"].includes(e.target.value) ? e.target.value : Number(e.target.value)))} style={styles.scheduleEditInput}>
                                                <option value="">なし</option>
                                                <option value="weekday">平日(月〜金・祝日除く)</option>
                                                <option value="satsun">毎週土曜・日曜</option>
                                                {WEEKDAY_LABELS.map((label, idx) => <option key={idx} value={idx}>毎週{label}曜</option>)}
                                              </select>
                                            </label>
                                            <label style={styles.scheduleEditField}>
                                              <span style={styles.scheduleEditLabel}>想定(分)</span>
                                              <select value={s.estimatedMinutes || ""} onChange={(e) => updateSubtaskSchedule(p.id, t.id, s.id, "estimatedMinutes", e.target.value ? Number(e.target.value) : "")} style={{ ...styles.scheduleEditInput, width: 64 }}>
                                                <option value="">―</option>
                                                {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{formatDuration(m)}</option>)}
                                              </select>
                                            </label>
                                            <label style={styles.scheduleEditField}>
                                              <span style={styles.scheduleEditLabel}>実績(分)</span>
                                              <div style={styles.actualRow}>
                                                <select value={s.actualMinutes || ""} onChange={(e) => updateSubtaskSchedule(p.id, t.id, s.id, "actualMinutes", e.target.value ? Number(e.target.value) : "")} style={{ ...styles.scheduleEditInput, width: 64 }}>
                                                  <option value="">―</option>
                                                  {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{formatDuration(m)}</option>)}
                                                </select>
                                                {renderStopwatchControl(p.id, t.id, s.id)}
                                              </div>
                                            </label>
                                            <label style={styles.scheduleEditField}>
                                              <span style={styles.scheduleEditLabel}>PJ</span>
                                              <select value={p.id} onChange={(e) => {
                                                const toPjId = e.target.value;
                                                const toPj = projects.find((pp) => pp.id === toPjId);
                                                const toTaskId = toPj?.tasks[0]?.id;
                                                if (toTaskId) moveSubtask(p.id, t.id, s.id, toPjId, toTaskId);
                                              }} style={styles.moveSelect}>
                                                {projects.map((pp) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                                              </select>
                                            </label>
                                            <label style={styles.scheduleEditField}>
                                              <span style={styles.scheduleEditLabel}>タスク</span>
                                              <select value={t.id} onChange={(e) => moveSubtask(p.id, t.id, s.id, p.id, e.target.value)} style={styles.moveSelect} disabled={p.tasks.length <= 1}>
                                                {p.tasks.map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
                                              </select>
                                            </label>
                                          </div>
                                        </div>
                                        <span style={{ ...styles.metaTag, borderColor: pInfo.color, color: pInfo.color }}>{pInfo.label}</span>
                                        <button type="button" onClick={() => openStepsModal(p.id, t.id, s.id)} aria-label="ステップを開く" style={styles.inlineAddBtn}>☑ステップ</button>
                                        <button type="button" onClick={() => setCopyDateModal({ pjId: p.id, taskId: t.id, subId: s.id, date: s.scheduledDate || todayStr, text: s.text })} aria-label="サブタスクをコピー" style={styles.inlineAddBtn}>📋コピー</button>
                                        {renderSendToCalendarButton(s)}
                                        <button onClick={() => removeSubtask(p.id, t.id, s.id)} aria-label="削除" style={styles.deleteBtn}>×</button>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={styles.page} className="tm-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .row-in { animation: fadeIn 0.2s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px);} to { opacity:1; transform: translateY(0);} }
        @keyframes stampIn {
          0% { transform: scale(2.4) rotate(-14deg); opacity: 0; }
          55% { transform: scale(0.92) rotate(-10deg); opacity: 1; }
          75% { transform: scale(1.06) rotate(-11deg); }
          100% { transform: scale(1) rotate(-10deg); opacity: 1; }
        }
        .hanko-pop { animation: stampIn 0.5s cubic-bezier(.2,.9,.3,1.2); }
        @keyframes wobble {
          0%, 100% { transform: rotate(-8deg); }
          50% { transform: rotate(8deg); }
        }
        .loading-wobble { animation: wobble 0.9s ease-in-out infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin-loading { animation: spin 0.8s linear infinite; }
        input:focus, select:focus, button:focus-visible { outline: 2px solid #12314F; outline-offset: 2px; }
        ::placeholder { color: #9B9B9B; }
        @media (min-width: 768px) {
          .tm-page { padding: 24px 32px 60px !important; }
        }
        @media (max-width: 767px) {
          .pj-header { flex-wrap: wrap; }
          .pj-header .pj-title-input { order: -1; flex: 1 1 100% !important; width: 100%; }
          .task-header { flex-wrap: wrap; }
          .task-header .task-title-input { order: -1; flex: 1 1 100% !important; width: 100%; }
          .sub-row { flex-wrap: wrap; }
          .sub-row .sub-body { order: -1; flex: 1 1 100% !important; width: 100%; }
        }
      `}</style>

      {saveState === "loading" && (
        <div style={styles.loadingOverlay}>
          <img src={`${import.meta.env.BASE_URL}icon-512.png`} alt="読み込み中" className="loading-wobble" style={styles.loadingOverlayIcon} />
        </div>
      )}

      <div style={styles.shell}>
        <header style={styles.header}>
          <div style={styles.logoRow}>
            <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" style={styles.logoMark} />
            <div>
              <h1 style={styles.title}>タスクマニア！</h1>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={styles.saveIndicator} aria-live="polite">{saveLabel}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={openAddPJModal} style={styles.reloadBtn}>
                PJ追加
              </button>
              <button type="button" onClick={handleLoad} disabled={saveState === "loading"} style={styles.reloadBtn}>
                読込
              </button>
            </div>
          </div>
        </header>

        <nav style={styles.tabs} role="tablist" aria-label="メインタブ">
          {TOP_TABS.map((c) => {
            const active = topTab === c.key;
            const count = topBadge(c.key);
            return (
              <button key={c.key} role="tab" aria-selected={active} onClick={() => setTopTab(c.key)}
                style={{ ...styles.tabBtn, color: active ? "#FFFFFF" : c.color, background: active ? c.color : "transparent", borderColor: c.color }}>
                <span style={{ ...styles.tabDot, background: active ? "#FFFFFF" : c.color }} />
                {c.label}
                <span style={{ ...styles.tabCount, color: active ? "#FFFFFF" : c.color, opacity: count ? 1 : 0.35 }}>{count}</span>
              </button>
            );
          })}
        </nav>

        {PERSON_KEYS.includes(topTab) && (
          <nav style={styles.subTabs} role="tablist" aria-label="サブタブ">
            {SUB_TABS.map((s) => {
              const active = subTab === s.key;
              const color = s.color || activeTopColor;
              const count = s.key === "総合" ? topBadge(topTab) : openCountFor(topTab, s.key);
              return (
                <button key={s.key} role="tab" aria-selected={active} onClick={() => setSubTab(s.key)}
                  style={{ ...styles.subTabBtn, color: active ? "#FFFFFF" : color, background: active ? color : "transparent", borderColor: color }}>
                  {s.label}
                  <span style={{ ...styles.subTabCount, color: active ? "#FFFFFF" : color, opacity: count ? 1 : 0.35 }}>{count}</span>
                </button>
              );
            })}
          </nav>
        )}

        <section style={{ ...styles.panel, borderColor: activeTopColor }}>
          {showTaskSections && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button type="button" onClick={() => setDashboardOpen(true)} style={styles.addBtn}>📊ダッシュボード</button>
            </div>
          )}
          {dashboardOpen && <DashboardModal projects={visibleProjects} onClose={() => setDashboardOpen(false)} />}
          {showTaskSections && (
            <>
              {showWorkSummary && (
                <div style={styles.brainRow}>
                  <BrainBadge label="1日" ratio={dayBrainRatio} moyaCount={totalMoyamoyaCount} />
                  <BrainBadge label="今週" ratio={weekSummary.brainRatio} />
                  <BrainBadge label="来週" ratio={nextWeekSummary.ratio} />
                  <BrainBadge label="先週" ratio={lastWeekSummary.ratio} />
                </div>
              )}
              {showWorkSummary && projects !== null && renderPrioritySection({ key: "moyamoya", label: "もやもや", color: MOYAMOYA_COLOR, small: false, moyamoya: true, group: visibleProjects.filter((pp) => !pp.status && pp.moyamoya) })}

              {topTab === "総合" && (
                <>
                  <div style={styles.sectionTitleRow}>
                    <h3 style={styles.sectionTitleFlush}>カレンダー</h3>
                    <button type="button" onClick={() => setCalCollapsed((v) => !v)} style={styles.collapseBtnSm} aria-label={calCollapsed ? "カレンダーを展開する" : "カレンダーを折りたたむ"}>
                      {calCollapsed ? "▸" : "▾"}
                    </button>
                  </div>
                  {!calCollapsed && (
                    <div style={styles.calWrap}>
                      <div style={styles.calToolbar}>
                        <div style={styles.granularityGroup}>
                          {[{ key: "month", label: "月" }, { key: "week", label: "週" }, { key: "weekday", label: "平日" }, { key: "weekend", label: "休日" }, { key: "day", label: "日" }].map((g) => (
                            <button
                              key={g.key}
                              type="button"
                              onClick={() => setCalGranularity(g.key)}
                              style={{ ...styles.granularityBtn, background: calGranularity === g.key ? "#2C3645" : "transparent", color: calGranularity === g.key ? "#FFFFFF" : "#2C3645" }}
                            >
                              {g.label}
                            </button>
                          ))}
                        </div>
                        <div style={styles.calNavGroup}>
                          <button type="button" onClick={() => calShift(-1)} aria-label="前へ" style={styles.calNavBtn}>◀</button>
                          <span style={styles.calNavLabel}>{calLabel}</span>
                          <button type="button" onClick={() => calShift(1)} aria-label="次へ" style={styles.calNavBtn}>▶</button>
                          <button type="button" onClick={calGoToday} style={styles.inlineAddBtn}>今日</button>
                          <button type="button" onClick={handleLoad} disabled={saveState === "loading"} aria-label="カレンダーを更新" style={styles.calNavBtn}>
                            <span className={saveState === "loading" ? "spin-loading" : ""} style={{ display: "inline-block" }}>🔄</span>
                          </button>
                        </div>
                      </div>
                      <div style={styles.calLegend}>
                        {TOP_TABS.filter((c) => c.key !== "総合").map((c) => {
                          const hidden = calHiddenOwners.has(c.key);
                          return (
                            <button type="button" key={c.key} onClick={() => toggleCalOwner(c.key)} style={{ ...styles.calLegendItem, opacity: hidden ? 0.4 : 1 }}>
                              <span style={{ ...styles.calMonthDot, background: c.color }} />
                              {c.label}
                            </button>
                          );
                        })}
                      </div>
                      {calGranularity === "month" && (
                        <CalendarMonthView monthDateStr={calDate} tasksByDate={calVisibleTasksByDate} todayStr={todayStr} ownerColorOf={ownerColorOf} onSelectDay={calSelectDay} />
                      )}
                      {calGranularity === "week" && (
                        <CalendarTimeGrid dates={calWeekDates} tasksByDate={calVisibleTasksByDate} todayStr={todayStr} ownerColorOf={ownerColorOf} onOpenSubtask={(pjId, taskId, subId) => setCalSubtaskModal({ pjId, taskId, subId })} onSelectDay={calSelectDay} />
                      )}
                      {calGranularity === "weekday" && (
                        <CalendarTimeGrid dates={calWeekdayDates} tasksByDate={calVisibleTasksByDate} todayStr={todayStr} ownerColorOf={ownerColorOf} onOpenSubtask={(pjId, taskId, subId) => setCalSubtaskModal({ pjId, taskId, subId })} onSelectDay={calSelectDay} />
                      )}
                      {calGranularity === "weekend" && (
                        <CalendarTimeGrid dates={calWeekendDates} tasksByDate={calVisibleTasksByDate} todayStr={todayStr} ownerColorOf={ownerColorOf} onOpenSubtask={(pjId, taskId, subId) => setCalSubtaskModal({ pjId, taskId, subId })} onSelectDay={calSelectDay} />
                      )}
                      {calGranularity === "day" && (
                        <CalendarTimeGrid dates={[calDate]} tasksByDate={calVisibleTasksByDate} todayStr={todayStr} ownerColorOf={ownerColorOf} onOpenSubtask={(pjId, taskId, subId) => setCalSubtaskModal({ pjId, taskId, subId })} onSelectDay={calSelectDay} />
                      )}
                    </div>
                  )}
                </>
              )}

              <div style={styles.sectionTitleRow}>
                <h3 style={{ ...styles.sectionTitleFlush, fontWeight: 900 }}>1日のタスク</h3>
                <input type="date" value={dayViewDate} onChange={(e) => setDayViewDate(e.target.value)} style={styles.scheduleEditInput} aria-label="表示する日付" />
              </div>
              <div style={styles.workSummaryBar}>
                {showWorkSummary && <span style={styles.workSummaryItem}>業務時間 8時間</span>}
                <span style={styles.workSummaryItem}>
                  想定時間計 {totalEstMin ? formatDuration(totalEstMin) : "0分"}
                  {showWorkSummary && estWarnLevel && <span style={{ ...styles.workWarnIcon, color: estWarnLevel === "red" ? "#F39800" : "#2C3645" }}>⚠</span>}
                </span>
                <span style={styles.workSummaryItem}>実績計 {totalActualMin ? formatDuration(totalActualMin) : "0分"}</span>
              </div>
              {visibleDayTasks.length === 0 ? (
                <p style={styles.emptySmall}>この日の予定日が入ってるサブタスクはない。</p>
              ) : (
                <ul style={styles.todayList}>
                  {visibleDayTasks.map(({ pjId, pjName, taskId, taskName, sub: s }) => (
                    <li key={s.id} style={styles.calendarCard} className="row-in">
                      <div style={styles.calendarLine1}>
                        <button onClick={() => toggleSubtaskDone(pjId, taskId, s.id)} aria-label={s.done ? "未完了に戻す" : "完了にする"} style={styles.stampWrap}>
                          {s.done ? <span style={styles.hankoStamp} className={stamping === s.id ? "hanko-pop" : ""}>済</span> : <span style={styles.hankoEmpty} />}
                        </button>
                        <TimeDropdown value={s.startTime || ""} onChange={(v) => updateSubtaskSchedule(pjId, taskId, s.id, "startTime", v)} style={{ width: 54 }} />
                        <span style={{ ...styles.calTimeCol, width: 40 }}>{addMinutesToTime(s.startTime, s.estimatedMinutes) || "―"}</span>
                        <input
                          type="text"
                          value={s.text}
                          onChange={(e) => updateSubtaskText(pjId, taskId, s.id, e.target.value)}
                          aria-label="サブタスク名を編集"
                          style={{ ...styles.calSubCol, border: "none", background: "transparent", fontFamily: "inherit", padding: 0, textDecoration: s.done ? "line-through" : "none", color: s.done ? "#9B9B9B" : "#2C3645" }}
                        />
                        {s.repeatWeekday != null && <span title={s.repeatWeekday === "weekday" ? "平日(月〜金・祝日除く)" : s.repeatWeekday === "satsun" ? "毎週土曜・日曜" : `毎週${WEEKDAY_LABELS[s.repeatWeekday]}曜`} style={styles.calEstTag}>🔁{s.repeatWeekday === "weekday" ? "平日" : s.repeatWeekday === "satsun" ? "土日" : WEEKDAY_LABELS[s.repeatWeekday]}</span>}
                      </div>
                      <div style={styles.calendarLine2}>
                        <span style={styles.calendarLine2Label}>想定</span>
                        <select value={s.estimatedMinutes || ""} onChange={(e) => updateSubtaskSchedule(pjId, taskId, s.id, "estimatedMinutes", e.target.value ? Number(e.target.value) : "")} style={{ ...styles.scheduleEditInput, width: 64 }}>
                          <option value="">―</option>
                          {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{formatDuration(m)}</option>)}
                        </select>
                        <span style={styles.calendarLine2Label}>実績</span>
                        <select value={s.actualMinutes || ""} onChange={(e) => updateSubtaskSchedule(pjId, taskId, s.id, "actualMinutes", e.target.value ? Number(e.target.value) : "")} style={{ ...styles.scheduleEditInput, width: 64 }}>
                          <option value="">―</option>
                          {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{formatDuration(m)}</option>)}
                        </select>
                        {renderStopwatchControl(pjId, taskId, s.id)}
                        <button type="button" onClick={() => openStepsModal(pjId, taskId, s.id)} aria-label="ステップを開く" style={styles.inlineAddBtn}>☑ステップ</button>
                        <button type="button" onClick={() => setMoveDateModal({ pjId, taskId, subId: s.id, date: s.scheduledDate || dayViewDate })} aria-label="予定日を変更" style={styles.inlineAddBtn}>📅変更</button>
                        <button type="button" onClick={() => setCopyDateModal({ pjId, taskId, subId: s.id, date: dayViewDate, text: s.text })} aria-label="サブタスクをコピー" style={styles.inlineAddBtn}>📋コピー</button>
                        {renderSendToCalendarButton(s)}
                        <span style={styles.calPjCol} title={pjName}>{pjName}</span>
                        <span style={styles.calTaskCol} title={taskName}>{taskName}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div style={styles.sectionTitleRow}>
                <h3 style={{ ...styles.sectionTitleFlush, fontWeight: 900 }}>残タスク</h3>
                <button type="button" onClick={() => setOverdueCollapsed((v) => !v)} style={styles.collapseBtnSm} aria-label={overdueCollapsed ? "詳細を展開する" : "詳細を折りたたむ"}>
                  {overdueCollapsed ? "▸" : "▾"}
                </button>
              </div>

              {!overdueCollapsed && (
                <DateGroupedTaskList
                  dates={overdueDates}
                  tasks={overdueTasks}
                  openDates={overdueOpenDates}
                  onToggleDate={toggleOverdueDate}
                  onToggleDone={toggleSubtaskDone}
                  onMoveDate={setMoveDateModal}
                  stamping={stamping}
                  dayViewDate={dayViewDate}
                  emptyMessage="予定日が過去で残っているタスクはない。"
                />
              )}

              <div style={styles.sectionTitleRow}>
                <h3 style={{ ...styles.sectionTitleFlush, fontWeight: 900 }}>日次未設定タスク一覧</h3>
                <button type="button" onClick={() => setUnscheduledCollapsed((v) => !v)} style={styles.collapseBtnSm} aria-label={unscheduledCollapsed ? "詳細を展開する" : "詳細を折りたたむ"}>
                  {unscheduledCollapsed ? "▸" : "▾"}
                </button>
              </div>

              {!unscheduledCollapsed && (
                unscheduledTasks.length === 0 ? (
                  <p style={styles.emptySmall}>予定日が未設定のタスクはない。</p>
                ) : (
                  <ul style={styles.todayList}>
                    {unscheduledTasks.map(({ pjId, pjName, taskId, taskName, sub: s }) => (
                      <li key={s.id} style={styles.calendarCard} className="row-in">
                        <div style={styles.calendarLine1}>
                          <button onClick={() => toggleSubtaskDone(pjId, taskId, s.id)} aria-label={s.done ? "未完了に戻す" : "完了にする"} style={styles.stampWrap}>
                            {s.done ? <span style={styles.hankoStamp} className={stamping === s.id ? "hanko-pop" : ""}>済</span> : <span style={styles.hankoEmpty} />}
                          </button>
                          <input
                            type="text"
                            value={s.text}
                            onChange={(e) => updateSubtaskText(pjId, taskId, s.id, e.target.value)}
                            aria-label="サブタスク名を編集"
                            style={{ ...styles.calSubCol, border: "none", background: "transparent", fontFamily: "inherit", padding: 0, textDecoration: s.done ? "line-through" : "none", color: s.done ? "#9B9B9B" : "#2C3645" }}
                          />
                        </div>
                        <div style={styles.calendarLine2}>
                          <span style={styles.calendarLine2Label}>想定</span>
                          <select value={s.estimatedMinutes || ""} onChange={(e) => updateSubtaskSchedule(pjId, taskId, s.id, "estimatedMinutes", e.target.value ? Number(e.target.value) : "")} style={{ ...styles.scheduleEditInput, width: 64 }}>
                            <option value="">―</option>
                            {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{formatDuration(m)}</option>)}
                          </select>
                          <span style={styles.calendarLine2Label}>実績</span>
                          <select value={s.actualMinutes || ""} onChange={(e) => updateSubtaskSchedule(pjId, taskId, s.id, "actualMinutes", e.target.value ? Number(e.target.value) : "")} style={{ ...styles.scheduleEditInput, width: 64 }}>
                            <option value="">―</option>
                            {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{formatDuration(m)}</option>)}
                          </select>
                          {renderStopwatchControl(pjId, taskId, s.id)}
                          <button type="button" onClick={() => openStepsModal(pjId, taskId, s.id)} aria-label="ステップを開く" style={styles.inlineAddBtn}>☑ステップ</button>
                          <button type="button" onClick={() => setMoveDateModal({ pjId, taskId, subId: s.id, date: s.scheduledDate || dayViewDate })} aria-label="予定日を設定" style={styles.inlineAddBtn}>📅設定</button>
                          <button type="button" onClick={() => setCopyDateModal({ pjId, taskId, subId: s.id, date: dayViewDate, text: s.text })} aria-label="サブタスクをコピー" style={styles.inlineAddBtn}>📋コピー</button>
                          <span style={styles.calPjCol} title={pjName}>{pjName}</span>
                          <span style={styles.calTaskCol} title={taskName}>{taskName}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              )}

              <div style={styles.sectionTitleRow}>
                <h3 style={{ ...styles.sectionTitleFlush, fontWeight: 900 }}>今週のタスク</h3>
                <button type="button" onClick={() => exportWeekTasksExcel("今週のタスク", weekTasks)} style={styles.inlineAddBtn}>Excelで出力</button>
              </div>
              <div style={styles.workSummaryBar}>
                <span style={styles.workSummaryItem}>稼働可能 {formatDuration(weekSummary.effectiveMinutes) || "0分"}</span>
                <span style={styles.workSummaryItem}>
                  想定時間計 {weekSummary.estMinutes ? formatDuration(weekSummary.estMinutes) : "0分"}
                  {weekSummary.warnLevel && <span style={{ ...styles.workWarnIcon, color: weekSummary.warnLevel === "red" ? "#F39800" : "#2C3645" }}>⚠</span>}
                </span>
                <button type="button" onClick={() => setWeekCollapsed((v) => !v)} style={styles.collapseBtnSm} aria-label={weekCollapsed ? "詳細を展開する" : "詳細を折りたたむ"}>
                  {weekCollapsed ? "▸" : "▾"}
                </button>
              </div>

              {!weekCollapsed && (
                <>
                  <div style={styles.scheduleEditRow}>
                    <label style={styles.scheduleEditField}>
                      <span style={styles.scheduleEditLabel}>稼働調整日</span>
                      <select value={adjDateVal} onChange={(e) => setAdjDateVal(e.target.value)} style={styles.scheduleEditInput}>
                        {weekDates.filter(isWeekdayStr).map((d) => {
                          const dt = new Date(d + "T00:00:00");
                          return <option key={d} value={d}>{formatDate(d)}({DAY_JP[dt.getDay()]})</option>;
                        })}
                      </select>
                    </label>
                    <label style={styles.scheduleEditField}>
                      <span style={styles.scheduleEditLabel}>減らす時間</span>
                      <select value={adjHoursVal} onChange={(e) => setAdjHoursVal(Number(e.target.value))} style={{ ...styles.scheduleEditInput, width: 64 }}>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((h) => <option key={h} value={h}>{h}時間</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={addWeekAdj} style={styles.addBtn}>調整を追加</button>
                  </div>

                  {workAdj.filter((a) => weekDates.includes(a.date)).length > 0 && (
                    <ul style={styles.todayList}>
                      {workAdj.filter((a) => weekDates.includes(a.date)).map((a) => {
                        const dt = new Date(a.date + "T00:00:00");
                        return (
                          <li key={a.date} style={{ ...styles.calendarLine1, justifyContent: "space-between" }}>
                            <span style={styles.calSubCol}>{formatDate(a.date)}({DAY_JP[dt.getDay()]}) 稼働 -{a.hours}時間</span>
                            <button type="button" onClick={() => removeWeekAdj(a.date)} style={styles.deleteBtn} aria-label="調整を削除">×</button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <DateGroupedTaskList
                    dates={weekDates}
                    tasks={weekTasks}
                    openDates={weekOpenDates}
                    onToggleDate={toggleWeekDate}
                    onToggleDone={toggleSubtaskDone}
                    onMoveDate={setMoveDateModal}
                    stamping={stamping}
                    dayViewDate={dayViewDate}
                    emptyMessage="今週の予定日が入ってるサブタスクはない。"
                  />
                </>
              )}

              <div style={styles.sectionTitleRow}>
                <h3 style={{ ...styles.sectionTitleFlush, fontWeight: 900 }}>来週のタスク</h3>
                <button type="button" onClick={() => exportWeekTasksExcel("来週のタスク", nextWeekTasks)} style={styles.inlineAddBtn}>Excelで出力</button>
              </div>
              <div style={styles.workSummaryBar}>
                <span style={styles.workSummaryItem}>稼働可能 {formatDuration(nextWeekSummary.effectiveMinutes) || "0分"}</span>
                <span style={styles.workSummaryItem}>
                  想定時間計 {nextWeekSummary.estMinutes ? formatDuration(nextWeekSummary.estMinutes) : "0分"}
                  {nextWeekSummary.warnLevel && <span style={{ ...styles.workWarnIcon, color: nextWeekSummary.warnLevel === "red" ? "#F39800" : "#2C3645" }}>⚠</span>}
                </span>
                <button type="button" onClick={() => setNextWeekCollapsed((v) => !v)} style={styles.collapseBtnSm} aria-label={nextWeekCollapsed ? "詳細を展開する" : "詳細を折りたたむ"}>
                  {nextWeekCollapsed ? "▸" : "▾"}
                </button>
              </div>

              {!nextWeekCollapsed && (
                <>
                  <div style={styles.scheduleEditRow}>
                    <label style={styles.scheduleEditField}>
                      <span style={styles.scheduleEditLabel}>稼働調整日</span>
                      <select value={nextAdjDateVal} onChange={(e) => setNextAdjDateVal(e.target.value)} style={styles.scheduleEditInput}>
                        {nextWeekDates.filter(isWeekdayStr).map((d) => {
                          const dt = new Date(d + "T00:00:00");
                          return <option key={d} value={d}>{formatDate(d)}({DAY_JP[dt.getDay()]})</option>;
                        })}
                      </select>
                    </label>
                    <label style={styles.scheduleEditField}>
                      <span style={styles.scheduleEditLabel}>減らす時間</span>
                      <select value={nextAdjHoursVal} onChange={(e) => setNextAdjHoursVal(Number(e.target.value))} style={{ ...styles.scheduleEditInput, width: 64 }}>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((h) => <option key={h} value={h}>{h}時間</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={addNextWeekAdj} style={styles.addBtn}>調整を追加</button>
                  </div>

                  {workAdj.filter((a) => nextWeekDates.includes(a.date)).length > 0 && (
                    <ul style={styles.todayList}>
                      {workAdj.filter((a) => nextWeekDates.includes(a.date)).map((a) => {
                        const dt = new Date(a.date + "T00:00:00");
                        return (
                          <li key={a.date} style={{ ...styles.calendarLine1, justifyContent: "space-between" }}>
                            <span style={styles.calSubCol}>{formatDate(a.date)}({DAY_JP[dt.getDay()]}) 稼働 -{a.hours}時間</span>
                            <button type="button" onClick={() => removeNextWeekAdj(a.date)} style={styles.deleteBtn} aria-label="調整を削除">×</button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <DateGroupedTaskList
                    dates={nextWeekDates}
                    tasks={nextWeekTasks}
                    openDates={nextWeekOpenDates}
                    onToggleDate={toggleNextWeekDate}
                    onToggleDone={toggleSubtaskDone}
                    onMoveDate={setMoveDateModal}
                    stamping={stamping}
                    dayViewDate={dayViewDate}
                    emptyMessage="来週の予定日が入ってるサブタスクはない。"
                  />
                </>
              )}

              <div style={styles.sectionTitleRow}>
                <h3 style={{ ...styles.sectionTitleFlush, fontWeight: 900 }}>先週のタスク</h3>
                <button type="button" onClick={() => exportWeekTasksExcel("先週のタスク", lastWeekTasks)} style={styles.inlineAddBtn}>Excelで出力</button>
              </div>
              <div style={styles.workSummaryBar}>
                <span style={styles.workSummaryItem}>想定時間計 {lastWeekSummary.estMinutes ? formatDuration(lastWeekSummary.estMinutes) : "0分"}</span>
                <span style={styles.workSummaryItem}>実績時間計 {lastWeekSummary.actualMinutes ? formatDuration(lastWeekSummary.actualMinutes) : "0分"}</span>
                <button type="button" onClick={() => setLastWeekCollapsed((v) => !v)} style={styles.collapseBtnSm} aria-label={lastWeekCollapsed ? "詳細を展開する" : "詳細を折りたたむ"}>
                  {lastWeekCollapsed ? "▸" : "▾"}
                </button>
              </div>

              {!lastWeekCollapsed && (
                <DateGroupedTaskList
                  dates={lastWeekDates}
                  tasks={lastWeekTasks}
                  openDates={lastWeekOpenDates}
                  onToggleDate={toggleLastWeekDate}
                  onToggleDone={toggleSubtaskDone}
                  onMoveDate={setMoveDateModal}
                  stamping={stamping}
                  dayViewDate={dayViewDate}
                  emptyMessage="先週の予定日が入ってるサブタスクはない。"
                  showActual
                />
              )}
            </>
          )}

          {showTaskSections && (
            <>
              <div style={styles.sectionTitleRow}>
                <h3 style={{ ...styles.sectionTitleFlush, fontWeight: 900 }}>総合ガントチャート</h3>
                <button type="button" onClick={() => setGanttCollapsed((v) => !v)} style={styles.collapseBtnSm} aria-label={ganttCollapsed ? "総合ガントチャートを展開する" : "総合ガントチャートを折りたたむ"}>
                  {ganttCollapsed ? "▸" : "▾"}
                </button>
              </div>
              {!ganttCollapsed && <OverviewGanttChart projects={visibleProjects} />}
            </>
          )}

          {showTaskSections && <h3 style={{ ...styles.sectionTitle, fontWeight: 900 }}>タスク一覧</h3>}

          {(() => {
            const modalTargetTask = addLevel === "subtask" ? (projects || []).find((pp) => pp.id === addPJId)?.tasks.find((tt) => tt.id === addTaskId) : null;
            return addModalOpen && (
            <div style={styles.modalOverlay} onClick={() => setAddModalOpen(false)}>
              <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <h3 style={styles.modalTitle}>
                    {addLevel === "pj" ? "PJを追加" : addLevel === "task" ? "タスクを追加" : "サブタスクを追加"}
                  </h3>
                  <button type="button" onClick={() => setAddModalOpen(false)} aria-label="閉じる" style={styles.modalCloseBtn}>×</button>
                </div>
                {addLevel !== "pj" && (
                  <p style={styles.modalContext}>
                    {addLevel === "task" ? `PJ: ${modalPJName}` : `PJ: ${modalPJName} ／ タスク: ${modalTaskName}`}
                  </p>
                )}
                <form onSubmit={addItem}>
                  <div style={styles.formRow}>
                    {addLevel === "pj" && topTab === "総合" && (
                      <select value={addOwner} onChange={(e) => setAddOwner(e.target.value)} style={styles.select}>
                        {TOP_TABS.filter((c) => c.key !== "総合").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    )}
                    {addLevel === "pj" && ownerHasSub && (
                      <select value={addSub} onChange={(e) => setAddSub(e.target.value)} style={styles.select}>
                        {REAL_SUBS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    )}
                  </div>
                  <div style={styles.inputRow}>
                    <input ref={inputRef} autoFocus value={addText} onChange={(e) => setAddText(e.target.value)}
                      placeholder={addLevel === "pj" ? "新しいPJ名…" : addLevel === "task" ? "新しいタスク名…" : "新しいサブタスク…"}
                      style={styles.input} />
                    {addLevel === "pj" && (
                      <div style={styles.priorityGroup}>
                        {PJ_PRIORITIES.map((p) => (
                          <button type="button" key={p.v} onClick={() => setAddPJPriority(p.v)}
                            style={{ ...styles.priorityBtn, background: addPJPriority === p.v ? p.color : "transparent", color: addPJPriority === p.v ? "#FFFFFF" : p.color, borderColor: p.color }}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {addLevel === "subtask" && (
                      <div style={styles.priorityGroup}>
                        {PRIORITIES.map((p) => (
                          <button type="button" key={p.v} onClick={() => setAddPriority(p.v)}
                            style={{ ...styles.priorityBtn, background: addPriority === p.v ? p.color : "transparent", color: addPriority === p.v ? "#FFFFFF" : p.color, borderColor: p.color }}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {addLevel === "task" && (
                    <div style={styles.scheduleRow}>
                      <label style={styles.scheduleField}>
                        <span style={styles.scheduleLabel}>開始日</span>
                        <input type="date" value={addTaskStartDate} onChange={(e) => setAddTaskStartDate(e.target.value)} max={addTaskEndDate || undefined} style={styles.scheduleInput} />
                      </label>
                      <label style={styles.scheduleField}>
                        <span style={styles.scheduleLabel}>終了日</span>
                        <input type="date" value={addTaskEndDate} onChange={(e) => setAddTaskEndDate(e.target.value)} min={addTaskStartDate || undefined} style={styles.scheduleInput} />
                      </label>
                    </div>
                  )}
                  {addLevel === "subtask" && (
                    <div style={styles.scheduleRow}>
                      <label style={styles.scheduleField}>
                        <span style={styles.scheduleLabel}>予定日</span>
                        <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)}
                          min={modalTargetTask?.startDate || undefined} max={modalTargetTask?.endDate || undefined}
                          style={styles.scheduleInput} />
                      </label>
                      <label style={styles.scheduleField}>
                        <span style={styles.scheduleLabel}>開始</span>
                        <TimeDropdown value={addStartTime} onChange={setAddStartTime} style={styles.scheduleInput} />
                      </label>
                      <label style={styles.scheduleField}>
                        <span style={styles.scheduleLabel}>想定(分)</span>
                        <select value={addEstMinutes} onChange={(e) => setAddEstMinutes(e.target.value)} style={{ ...styles.scheduleInput, width: 72 }}>
                          <option value="">―</option>
                          {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{formatDuration(m)}</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                  <div style={styles.modalActions}>
                    <button type="submit" style={styles.addBtn}>記す</button>
                  </div>
                </form>
              </div>
            </div>
            );
          })()}

          {stepsModalTarget && (() => {
            const p = (projects || []).find((pp) => pp.id === stepsModalTarget.pjId);
            const t = p?.tasks.find((tt) => tt.id === stepsModalTarget.taskId);
            const s = t?.subtasks.find((ss) => ss.id === stepsModalTarget.subId);
            if (!s) return null;
            return (
              <div style={styles.modalOverlay} onClick={closeStepsModal}>
                <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
                  <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>ステップ</h3>
                    <button type="button" onClick={closeStepsModal} aria-label="閉じる" style={styles.modalCloseBtn}>×</button>
                  </div>
                  <p style={styles.modalContext}>{s.text}</p>
                  <ul style={styles.stepList}>
                    {(s.steps || []).length === 0 && <li style={styles.emptySmall}>ステップなし</li>}
                    {(s.steps || []).map((st) => (
                      <li key={st.id} style={styles.stepRow}>
                        <button onClick={() => toggleStepDone(p.id, t.id, s.id, st.id)} aria-label={st.done ? "未完了に戻す" : "完了にする"} style={styles.stampWrap}>
                          {st.done ? <span style={styles.hankoStamp}>済</span> : <span style={styles.hankoEmpty} />}
                        </button>
                        <input type="text" value={st.text} onChange={(e) => updateStepText(p.id, t.id, s.id, st.id, e.target.value)}
                          style={{ ...styles.subTextInput, textDecoration: st.done ? "line-through" : "none", color: st.done ? "#9B9B9B" : "#2C3645" }}
                          aria-label="ステップ名を編集" />
                        <button onClick={() => removeStep(p.id, t.id, s.id, st.id)} aria-label="削除" style={styles.deleteBtn}>×</button>
                      </li>
                    ))}
                  </ul>
                  <form onSubmit={(e) => { e.preventDefault(); const trimmed = newStepText.trim(); if (!trimmed) return; addStep(p.id, t.id, s.id, trimmed); setNewStepText(""); }} style={styles.inputRow}>
                    <input autoFocus value={newStepText} onChange={(e) => setNewStepText(e.target.value)} placeholder="新しいステップ…" style={styles.input} />
                    <button type="submit" style={styles.addBtn}>追加</button>
                  </form>
                </div>
              </div>
            );
          })()}

          {copyDateModal && (() => {
            const p = (projects || []).find((pp) => pp.id === copyDateModal.pjId);
            const t = p?.tasks.find((tt) => tt.id === copyDateModal.taskId);
            const s = t?.subtasks.find((ss) => ss.id === copyDateModal.subId);
            if (!s) return null;
            return (
              <div style={styles.modalOverlay} onClick={() => setCopyDateModal(null)}>
                <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
                  <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>サブタスクをコピー</h3>
                    <button type="button" onClick={() => setCopyDateModal(null)} aria-label="閉じる" style={styles.modalCloseBtn}>×</button>
                  </div>
                  <label style={styles.scheduleEditField}>
                    <span style={styles.scheduleEditLabel}>タイトル</span>
                    <input type="text" value={copyDateModal.text} onChange={(e) => setCopyDateModal((prev) => ({ ...prev, text: e.target.value }))} style={styles.scheduleEditInput} />
                  </label>
                  <label style={styles.scheduleEditField}>
                    <span style={styles.scheduleEditLabel}>コピー先の予定日</span>
                    <input type="date" value={copyDateModal.date} onChange={(e) => setCopyDateModal((prev) => ({ ...prev, date: e.target.value }))} style={styles.scheduleEditInput} />
                  </label>
                  <div style={styles.modalActions}>
                    <button type="button" onClick={() => { duplicateSubtask(p.id, t.id, s.id, { scheduledDate: copyDateModal.date || null, text: (copyDateModal.text || "").trim() || s.text }); setCopyDateModal(null); }} style={styles.addBtn}>コピー</button>
                  </div>
                </div>
              </div>
            );
          })()}

          {moveDateModal && (() => {
            const p = (projects || []).find((pp) => pp.id === moveDateModal.pjId);
            const t = p?.tasks.find((tt) => tt.id === moveDateModal.taskId);
            const s = t?.subtasks.find((ss) => ss.id === moveDateModal.subId);
            if (!s) return null;
            return (
              <div style={styles.modalOverlay} onClick={() => setMoveDateModal(null)}>
                <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
                  <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>予定日を変更</h3>
                    <button type="button" onClick={() => setMoveDateModal(null)} aria-label="閉じる" style={styles.modalCloseBtn}>×</button>
                  </div>
                  <p style={styles.modalContext}>{s.text}</p>
                  <label style={styles.scheduleEditField}>
                    <span style={styles.scheduleEditLabel}>新しい予定日</span>
                    <input type="date" value={moveDateModal.date} onChange={(e) => setMoveDateModal((prev) => ({ ...prev, date: e.target.value }))} min={t.startDate || undefined} max={t.endDate || undefined} style={styles.scheduleEditInput} />
                  </label>
                  <div style={styles.modalActions}>
                    <button type="button" onClick={() => { updateSubtaskSchedule(p.id, t.id, s.id, "scheduledDate", moveDateModal.date || null); setMoveDateModal(null); }} style={styles.addBtn}>変更</button>
                  </div>
                </div>
              </div>
            );
          })()}

          {calSubtaskModal && (() => {
            const p = (projects || []).find((pp) => pp.id === calSubtaskModal.pjId);
            const t = p?.tasks.find((tt) => tt.id === calSubtaskModal.taskId);
            const s = t?.subtasks.find((ss) => ss.id === calSubtaskModal.subId);
            if (!s) return null;
            const { pjId, taskId } = calSubtaskModal;
            return (
              <div style={styles.modalOverlay} onClick={() => setCalSubtaskModal(null)}>
                <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
                  <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>サブタスクを編集</h3>
                    <button type="button" onClick={() => setCalSubtaskModal(null)} aria-label="閉じる" style={styles.modalCloseBtn}>×</button>
                  </div>
                  <p style={styles.modalContext}>{p.name} ／ {t.name}</p>
                  <div style={{ ...styles.calendarLine1, marginBottom: 10 }}>
                    <button onClick={() => toggleSubtaskDone(pjId, taskId, s.id)} aria-label={s.done ? "未完了に戻す" : "完了にする"} style={styles.stampWrap}>
                      {s.done ? <span style={styles.hankoStamp} className={stamping === s.id ? "hanko-pop" : ""}>済</span> : <span style={styles.hankoEmpty} />}
                    </button>
                    <input
                      type="text"
                      value={s.text}
                      onChange={(e) => updateSubtaskText(pjId, taskId, s.id, e.target.value)}
                      aria-label="サブタスク名を編集"
                      style={{ ...styles.calSubCol, border: "1.5px solid #E5E5E5", borderRadius: 5, padding: "3px 6px", fontFamily: "inherit", textDecoration: s.done ? "line-through" : "none", color: s.done ? "#9B9B9B" : "#2C3645" }}
                    />
                  </div>
                  <div style={styles.scheduleEditRow}>
                    <label style={styles.scheduleEditField}>
                      <span style={styles.scheduleEditLabel}>予定日</span>
                      <input type="date" value={s.scheduledDate || ""} onChange={(e) => updateSubtaskSchedule(pjId, taskId, s.id, "scheduledDate", e.target.value)} min={t.startDate || undefined} max={t.endDate || undefined} style={styles.scheduleEditInput} />
                    </label>
                    <label style={styles.scheduleEditField}>
                      <span style={styles.scheduleEditLabel}>開始時刻</span>
                      <TimeDropdown value={s.startTime || ""} onChange={(v) => updateSubtaskSchedule(pjId, taskId, s.id, "startTime", v)} />
                    </label>
                    <label style={styles.scheduleEditField}>
                      <span style={styles.scheduleEditLabel}>想定</span>
                      <select value={s.estimatedMinutes || ""} onChange={(e) => updateSubtaskSchedule(pjId, taskId, s.id, "estimatedMinutes", e.target.value ? Number(e.target.value) : "")} style={{ ...styles.scheduleEditInput, width: 72 }}>
                        <option value="">―</option>
                        {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{formatDuration(m)}</option>)}
                      </select>
                    </label>
                    <label style={styles.scheduleEditField}>
                      <span style={styles.scheduleEditLabel}>実績</span>
                      <select value={s.actualMinutes || ""} onChange={(e) => updateSubtaskSchedule(pjId, taskId, s.id, "actualMinutes", e.target.value ? Number(e.target.value) : "")} style={{ ...styles.scheduleEditInput, width: 72 }}>
                        <option value="">―</option>
                        {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{formatDuration(m)}</option>)}
                      </select>
                    </label>
                  </div>
                  <div style={{ ...styles.modalActions, justifyContent: "flex-start", flexWrap: "wrap", gap: 6 }}>
                    {renderStopwatchControl(pjId, taskId, s.id)}
                    <button type="button" onClick={() => openStepsModal(pjId, taskId, s.id)} aria-label="ステップを開く" style={styles.inlineAddBtn}>☑ステップ</button>
                    <button type="button" onClick={() => setCopyDateModal({ pjId, taskId, subId: s.id, date: s.scheduledDate || dayViewDate, text: s.text })} aria-label="サブタスクをコピー" style={styles.inlineAddBtn}>📋コピー</button>
                    {renderSendToCalendarButton(s)}
                  </div>
                </div>
              </div>
            );
          })()}

          {pjDetailModal && (() => {
            const p = (projects || []).find((pp) => pp.id === pjDetailModal);
            if (!p) return null;
            return <PJDetailModal project={p} onUpdateNote={updatePJNote} onClose={() => setPjDetailModal(null)} />;
          })()}

          <div style={styles.tree}>
            {projects === null && <p style={styles.empty}>読み込み中…</p>}
            {projects !== null && visibleProjects.length === 0 && <p style={styles.empty}>まだPJがない。上のフォームから作成できる。</p>}
            {projects !== null && visibleProjects.length > 0 && [
              ...PJ_PRIORITIES.map((pri) => ({ key: pri.v, label: pri.label, color: pri.color, small: false, group: visibleProjects.filter((pp) => !pp.status && (pp.priority || 2) === pri.v) })),
              ...PJ_STATUSES.map((st) => ({ key: st.v, label: st.label, color: st.color, small: true, group: visibleProjects.filter((pp) => pp.status === st.v) })),
            ].map(renderPrioritySection)}
          </div>
        </section>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#FFFFFF", backgroundImage: "repeating-linear-gradient(0deg, rgba(44,54,69,0.025) 0px, rgba(44,54,69,0.025) 1px, transparent 1px, transparent 28px)", fontFamily: "'Zen Kaku Gothic New', sans-serif", padding: "20px 12px 60px" },
  shell: { width: "fit-content", maxWidth: "100%", margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  logoRow: { display: "flex", alignItems: "center", gap: 12 },
  logoMark: { width: 80, height: 80, flexShrink: 0, objectFit: "contain" },
  loadingOverlay: { position: "fixed", inset: 0, background: "rgba(255,255,255,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 },
  loadingOverlayIcon: { width: 120, height: 120, objectFit: "contain" },
  title: { fontFamily: "Arial, sans-serif", fontWeight: 700, fontSize: 32, color: "#2C3645", margin: 0, letterSpacing: "0.02em" },
  saveIndicator: { fontSize: 11, color: "#7A7A7A", minWidth: 60, textAlign: "right" },
  reloadBtn: { fontSize: 11, fontWeight: 700, color: "#12314F", background: "transparent", border: "1.5px solid #12314F", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit" },
  tabs: { display: "flex", gap: 6, marginBottom: -1, position: "relative", zIndex: 2 },
  tabBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 4px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", border: "1.5px solid", borderBottom: "none", borderRadius: "8px 8px 0 0", cursor: "pointer", transition: "background 0.15s, color 0.15s" },
  tabDot: { width: 6, height: 6, borderRadius: "50%", flexShrink: 0 },
  tabCount: { fontSize: 10.5, fontWeight: 700 },
  subTabs: { display: "flex", gap: 5, padding: "8px 8px 8px", background: "#F5F5F5", borderLeft: "1.5px solid #D8D8D8", borderRight: "1.5px solid #D8D8D8", position: "relative", zIndex: 1 },
  subTabBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "6px 2px", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", border: "1.5px solid", borderRadius: 6, cursor: "pointer" },
  subTabCount: { fontSize: 9.5, fontWeight: 700 },
  panel: { background: "#FFFFFF", border: "1.5px solid", borderRadius: "0 6px 10px 10px", padding: 16, boxShadow: "0 3px 14px rgba(44,54,69,0.08)" },
  formRow: { display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(44,54,69,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 },
  modalBox: { width: "100%", maxWidth: 420, maxHeight: "86vh", overflowY: "auto", background: "#FFFFFF", border: "1.5px solid #2C3645", borderRadius: 10, padding: 18, boxShadow: "0 8px 28px rgba(44,54,69,0.3)" },
  modalHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  modalTitle: { fontFamily: "'Shippori Mincho', serif", fontSize: 16, fontWeight: 700, color: "#2C3645", margin: 0 },
  modalCloseBtn: { background: "none", border: "none", fontSize: 20, lineHeight: 1, color: "#7A7A7A", cursor: "pointer", padding: 4 },
  modalContext: { fontSize: 11.5, color: "#7A7A7A", margin: "0 0 12px" },
  modalActions: { display: "flex", justifyContent: "flex-end", marginTop: 12 },
  modalBoxLarge: { width: "100%", maxWidth: 860, maxHeight: "88vh", overflowY: "auto", background: "#FFFFFF", border: "1.5px solid #2C3645", borderRadius: 10, padding: 18, boxShadow: "0 8px 28px rgba(44,54,69,0.3)", display: "flex", flexDirection: "column", gap: 10 },
  modalBoxDashboard: { width: "100%", maxWidth: 960, maxHeight: "90vh", overflowY: "auto", background: "#FFFFFF", border: "1.5px solid #2C3645", borderRadius: 10, padding: 18, boxShadow: "0 8px 28px rgba(44,54,69,0.3)", display: "flex", flexDirection: "column", gap: 12 },
  dashboardFilterRow: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
  dashboardFilterBtn: { padding: "6px 12px", fontSize: 12, fontWeight: 700, border: "1.5px solid", borderRadius: 6, cursor: "pointer", fontFamily: "inherit" },
  dashboardRangeLabel: { fontSize: 11, color: "#7A7A7A", marginLeft: "auto" },
  dashboardPieRow: { display: "flex", gap: 20, flexWrap: "wrap" },
  dashboardChartCol: { flex: "1 1 220px", minWidth: 200 },
  dashboardChartTitle: { fontSize: 12, fontWeight: 700, color: "#2C3645", margin: "0 0 8px" },
  dashboardLegend: { listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 },
  dashboardLegendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 11 },
  dashboardLegendSwatch: { width: 10, height: 10, borderRadius: 2, flexShrink: 0 },
  dashboardLegendLabel: { flex: 1, color: "#2C3645", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  dashboardLegendValue: { color: "#7A7A7A", fontWeight: 700, whiteSpace: "nowrap" },
  dashboardBarWrap: { display: "flex", flexDirection: "column" },
  detailTaskList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4, maxHeight: 420, overflowY: "auto" },
  detailTaskGroup: { display: "flex", flexDirection: "column" },
  detailTaskRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", borderBottom: "1px dashed #E5E5E5" },
  detailTaskName: { flex: 1, fontSize: 12.5, fontWeight: 600, color: "#2C3645", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  noteTextarea: { minHeight: 64, padding: "8px 10px", fontSize: 13, border: "1.5px solid #D8D8D8", borderRadius: 6, background: "#FFFFFF", color: "#2C3645", fontFamily: "inherit", resize: "vertical" },
  detailSubList: { listStyle: "none", margin: 0, padding: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" },
  detailSubRow: { display: "flex", alignItems: "center", gap: 8, padding: "4px 4px", borderBottom: "1px dashed #E5E5E5" },
  inlineAddBtn: { fontSize: 10.5, fontWeight: 700, color: "#12314F", background: "transparent", border: "1.5px solid #12314F", borderRadius: 5, padding: "2px 7px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 },
  select: { flex: 1, minWidth: 100, fontSize: 12.5, padding: "7px 6px", borderRadius: 6, border: "1.5px solid #D8D8D8", background: "#FFFFFF", color: "#2C3645", fontFamily: "inherit" },
  hint: { fontSize: 11.5, color: "#F39800", margin: "0 0 6px" },
  sectionTitle: { fontSize: 12.5, fontWeight: 700, color: "#2C3645", margin: "14px 0 8px", paddingBottom: 4, borderBottom: "1.5px solid #E0E0E0" },
  sectionTitleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0 8px", paddingBottom: 4, borderBottom: "1.5px solid #E0E0E0" },
  sectionTitleFlush: { fontSize: 12.5, fontWeight: 700, color: "#2C3645", margin: 0 },
  workSummaryBar: { display: "flex", gap: 10, flexWrap: "wrap", padding: "6px 8px", marginBottom: 8, background: "#FFFFFF", border: "1px solid #E0E0E0", borderRadius: 6 },
  workSummaryItem: { fontSize: 11, fontWeight: 700, color: "#2C3645", display: "flex", alignItems: "center" },
  workWarnIcon: { marginLeft: 4, fontSize: 13, fontWeight: 900 },
  todayList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 },
  calendarCard: { padding: "7px 2px", borderBottom: "1px dashed #E0E0E0", display: "flex", flexDirection: "column", gap: 4 },
  calendarLine1: { display: "flex", alignItems: "center", gap: 8 },
  calendarLine2: { display: "flex", alignItems: "center", gap: 6, paddingLeft: 34 },
  calendarLine2Label: { fontSize: 9.5, color: "#9B9B9B", fontWeight: 700 },
  calTimeCol: { width: 40, flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: "#7A7A7A", fontVariantNumeric: "tabular-nums" },
  calEstTag: { fontSize: 9.5, fontWeight: 700, color: "#6B7F6E", background: "#F0F0F0", padding: "1px 6px", borderRadius: 8, flexShrink: 0, whiteSpace: "nowrap" },
  calSubCol: { flex: "1 1 auto", minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  calPjCol: { fontSize: 10, color: "#12314F", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 },
  calTaskCol: { fontSize: 10, color: "#8B6F3E", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 },
  dateGroupCard: { border: "1px solid #E0E0E0", borderRadius: 6, background: "#FFFFFF", overflow: "hidden" },
  dateGroupHeader: { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" },
  dateGroupLabel: { fontSize: 12.5, fontWeight: 700, color: "#2C3645" },
  dateGroupCount: { fontSize: 10, fontWeight: 700, color: "#9B9B9B" },
  dateGroupList: { listStyle: "none", margin: 0, padding: "0 8px 4px", display: "flex", flexDirection: "column", gap: 4, borderTop: "1px dashed #E0E0E0" },
  inputRow: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  input: { flex: "1 1 160px", padding: "10px 12px", fontSize: 14, border: "1.5px solid #D8D8D8", borderRadius: 6, background: "#FFFFFF", color: "#2C3645", fontFamily: "inherit" },
  priorityGroup: { display: "flex", gap: 4 },
  priorityBtn: { padding: "7px 9px", fontSize: 12, fontWeight: 700, border: "1.5px solid", borderRadius: 6, cursor: "pointer", fontFamily: "inherit" },
  scheduleRow: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" },
  scheduleField: { display: "flex", flexDirection: "column", gap: 2 },
  scheduleLabel: { fontSize: 10, color: "#7A7A7A", fontWeight: 700 },
  scheduleInput: { fontSize: 12.5, padding: "6px 6px", borderRadius: 6, border: "1.5px solid #D8D8D8", background: "#FFFFFF", color: "#2C3645", fontFamily: "inherit" },
  addBtn: { padding: "9px 14px", fontSize: 13, fontWeight: 700, color: "#FFFFFF", background: "#2C3645", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  tree: { display: "flex", flexDirection: "column", gap: 14 },
  prioritySection: { display: "flex", flexDirection: "column", gap: 8 },
  prioritySectionHeader: { display: "flex", alignItems: "center", gap: 6, width: "100%", background: "transparent", border: "none", borderBottom: "1.5px solid", padding: "0 0 4px", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, textAlign: "left" },
  prioritySectionCount: { marginLeft: "auto", fontSize: 10.5, fontWeight: 700, color: "#7A7A7A" },
  prioritySectionBody: { display: "flex", flexDirection: "column", gap: 10 },
  statusSection: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4, paddingTop: 10, borderTop: "1px dashed #D8D8D8" },
  statusSectionHeader: { display: "flex", alignItems: "center", gap: 6, width: "100%", background: "transparent", border: "none", borderBottom: "1px dashed", padding: "0 0 3px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, textAlign: "left", opacity: 0.85 },
  empty: { padding: "18px 4px", color: "#9B9B9B", fontSize: 13, textAlign: "center" },
  emptySmall: { padding: "6px 4px", color: "#9B9B9B", fontSize: 11.5, margin: 0 },
  pjCard: { background: "#FFFFFF", border: "1px solid #E0E0E0", borderLeft: "4px solid", borderRadius: 8, padding: 10 },
  pjHeader: { display: "flex", alignItems: "center", gap: 6 },
  reorderBtns: { display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 },
  reorderBtn: { background: "none", border: "none", fontSize: 8, lineHeight: 1, color: "#7A7A7A", cursor: "pointer", width: 14, height: 9, padding: 0 },
  collapseBtn: { background: "none", border: "none", fontSize: 13, color: "#2C3645", cursor: "pointer", width: 18, padding: 0, flexShrink: 0 },
  collapseBtnSm: { background: "none", border: "none", fontSize: 11, color: "#12314F", cursor: "pointer", width: 16, padding: 0, flexShrink: 0 },
  pjNameInput: { flex: 1, fontSize: 14, fontWeight: 700, color: "#2C3645", minWidth: 0, textAlign: "left", border: "none", background: "transparent", fontFamily: "inherit", padding: "3px 5px", borderRadius: 5 },
  taskNameInput: { flex: 1, fontSize: 13, fontWeight: 600, color: "#2C3645", minWidth: 0, border: "none", background: "transparent", fontFamily: "inherit", padding: "2px 4px", borderRadius: 5, textDecoration: "underline" },
  ganttToggleBtn: { flexShrink: 0, border: "none", borderRadius: 5, padding: "3px 6px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 },
  eyeToggleBtn: { flexShrink: 0, border: "none", borderRadius: 5, padding: "3px 6px", fontSize: 12, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 },
  doneMark: { flexShrink: 0, fontSize: 12 },
  progressTag: { fontSize: 10.5, fontWeight: 700, color: "#6B7F6E", background: "#F0F0F0", padding: "2px 6px", borderRadius: 8, flexShrink: 0 },
  progressTagSm: { fontSize: 10, fontWeight: 700, color: "#6B7F6E", background: "#F0F0F0", padding: "1px 5px", borderRadius: 8, flexShrink: 0 },
  taskList: { marginTop: 8, display: "flex", flexDirection: "column", gap: 6, paddingLeft: 18 },
  taskDatesRow: { display: "flex", gap: 8, marginTop: 6, paddingLeft: 24, flexWrap: "wrap" },
  ganttWrap: { marginTop: 8, padding: 10, background: "#FFFFFF", border: "1px dashed #D8D8D8", borderRadius: 8 },
  ganttEmpty: { fontSize: 11.5, color: "#9B9B9B", margin: 0, lineHeight: 1.5 },
  ganttToolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  granularityGroup: { display: "flex", gap: 3 },
  granularityBtn: { padding: "4px 8px", fontSize: 10.5, fontWeight: 700, border: "1.5px solid #2C3645", borderRadius: 5, cursor: "pointer", fontFamily: "inherit" },
  ganttLegend: { display: "flex", gap: 10, flexWrap: "wrap" },
  ganttLegendItem: { display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "#7A7A7A", fontWeight: 700 },
  ganttLegendDot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block" },
  ganttScroll: { overflowX: "auto", paddingBottom: 4, flex: 1, minWidth: 0 },
  ganttSplitWrap: { display: "flex", gap: 6 },
  ganttLabelCol: { flexShrink: 0, width: 112, display: "flex", flexDirection: "column", gap: 3 },
  ganttLabelHeaderCell: { height: 26 },
  ganttLabelCell: { height: 22, display: "flex", alignItems: "center", fontSize: 10.5, color: "#2C3645", paddingRight: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ganttGrid: { display: "grid", rowGap: 3, columnGap: 2, alignItems: "center" },
  ganttDateCell: { fontSize: 9.5, fontWeight: 700, color: "#7A7A7A", textAlign: "center", paddingBottom: 4, borderBottom: "1px solid #E0E0E0" },
  ganttBarTrack: { height: 14, background: "#E5E5E5", borderRadius: 5, overflow: "hidden", display: "flex", alignItems: "stretch" },
  ganttBarFill: { height: "100%", borderRadius: 5, minWidth: 4 },
  ganttPjRow: { display: "flex", alignItems: "center", gap: 6, background: "#E5E5E5", border: "none", borderRadius: 5, padding: "0 6px", height: 22, boxSizing: "border-box", cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, color: "#2C3645", textAlign: "left", width: "100%" },
  ganttPjName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ganttPjCount: { fontSize: 9.5, color: "#7A7A7A", fontWeight: 700, marginLeft: "auto", flexShrink: 0 },
  taskCard: { background: "#FFFFFF", border: "1px solid #E5E5E5", borderRadius: 6, padding: 8 },
  taskHeader: { display: "flex", alignItems: "center", gap: 6 },
  subList: { listStyle: "none", margin: "6px 0 0", padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 2 },
  subRowWrap: { borderBottom: "1px dashed #E5E5E5" },
  subRow: { display: "flex", alignItems: "flex-start", gap: 7, padding: "6px 0" },
  stepList: { listStyle: "none", margin: "0 0 10px", padding: 0, display: "flex", flexDirection: "column", gap: 2 },
  stepRow: { display: "flex", alignItems: "center", gap: 7, padding: "5px 0", borderBottom: "1px dashed #E5E5E5" },
  subBody: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, paddingTop: 2 },
  scheduleEditRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  scheduleEditField: { display: "flex", flexDirection: "column", gap: 1 },
  scheduleEditLabel: { fontSize: 9, color: "#9B9B9B", fontWeight: 700 },
  scheduleEditInput: { fontSize: 11, padding: "3px 5px", borderRadius: 5, border: "1.5px solid #E5E5E5", background: "#FFFFFF", color: "#2C3645", fontFamily: "inherit" },
  moveSelect: { fontSize: 10, padding: "2px 4px", borderRadius: 5, border: "1.5px solid #D8D8D8", background: "#FFFFFF", color: "#2C3645", fontFamily: "inherit", maxWidth: 92 },
  moyamoyaToggleBtn: { fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 5, border: "1.5px solid", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 },
  brainRow: { display: "flex", gap: 18, marginBottom: 12, flexWrap: "wrap" },
  brainBadgeWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3 },
  brainIconBox: { position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, flexShrink: 0 },
  brainSteamIcon: { position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)" },
  brainBadgeLabel: { fontSize: 10, fontWeight: 700 },
  brainMoyaBadge: { position: "absolute", bottom: -3, right: -7, minWidth: 15, height: 15, borderRadius: 8, background: MOYAMOYA_COLOR, color: "#FFFFFF", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", lineHeight: 1 },
  moyamoyaNotes: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, paddingBottom: 10, borderBottom: "1px dashed #D8D8D8" },
  moyamoyaAddForm: { display: "flex", gap: 6 },
  moyamoyaNoteRow: { display: "flex", gap: 6, alignItems: "center" },
  moyamoyaInput: { flex: 1, fontSize: 13, padding: "7px 9px", borderRadius: 6, border: "1.5px solid #D8D8D8", background: "#FFFFFF", color: "#2C3645", fontFamily: "inherit" },
  moyamoyaAddBtn: { fontSize: 15, fontWeight: 700, color: "#FFFFFF", background: MOYAMOYA_COLOR, border: "none", borderRadius: 6, padding: "0 12px", cursor: "pointer", fontFamily: "inherit" },
  timeDropdownList: { position: "absolute", top: "100%", left: 0, zIndex: 10, marginTop: 2, width: 90, maxHeight: 180, overflowY: "auto", background: "#FFFFFF", border: "1.5px solid #D8D8D8", borderRadius: 6, boxShadow: "0 4px 12px rgba(44,54,69,0.18)" },
  timeDropdownItem: { padding: "5px 8px", fontSize: 11.5, cursor: "pointer", borderBottom: "1px solid #F0F0F0" },
  actualRow: { display: "flex", gap: 3, alignItems: "center" },
  stopwatchBtn: { fontSize: 10.5, fontWeight: 700, padding: "3px 6px", borderRadius: 5, border: "1.5px solid", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  stopwatchEditGroup: { display: "inline-flex", gap: 3, alignItems: "center" },
  stopwatchEditInput: { width: 44, fontSize: 11, padding: "3px 4px", borderRadius: 5, border: "1.5px solid #F39800", background: "#FFFFFF", color: "#2C3645", fontFamily: "inherit" },
  stampWrap: { background: "none", border: "none", padding: 0, cursor: "pointer", width: 26, height: 26, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" },
  hankoEmpty: { width: 20, height: 20, borderRadius: "50%", border: "2px solid #D8D8D8", display: "block" },
  hankoStamp: { width: 22, height: 22, borderRadius: "50%", border: "2px solid #F39800", color: "#F39800", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Shippori Mincho', serif", fontWeight: 700, fontSize: 9.5, transform: "rotate(-10deg)" },
  subText: { flex: 1, fontSize: 13, lineHeight: 1.4, wordBreak: "break-word", minWidth: 0 },
  subTextInput: { flex: 1, fontSize: 13, fontWeight: 700, lineHeight: 1.4, minWidth: 0, border: "none", background: "transparent", fontFamily: "inherit", padding: "2px 4px", borderRadius: 5, width: "100%" },
  metaTag: { fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 10, border: "1px solid", flexShrink: 0 },
  deleteBtn: { background: "none", border: "none", color: "#D8D8D8", fontSize: 16, cursor: "pointer", padding: "0 2px", flexShrink: 0, lineHeight: 1 },

  calWrap: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 },
  calToolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
  calNavGroup: { display: "flex", alignItems: "center", gap: 6 },
  calNavBtn: { background: "none", border: "1.5px solid #D8D8D8", borderRadius: 5, color: "#2C3645", fontSize: 11, cursor: "pointer", width: 22, height: 22, padding: 0, fontFamily: "inherit" },
  calNavLabel: { fontSize: 12.5, fontWeight: 700, color: "#2C3645", minWidth: 90, textAlign: "center" },
  calLegend: { display: "flex", gap: 12, flexWrap: "wrap" },
  calLegendItem: { display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "#7A7A7A", fontWeight: 700, background: "none", border: "none", padding: "2px 4px", cursor: "pointer", fontFamily: "inherit" },

  calMonthHeaderRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 },
  calMonthHeaderCell: { fontSize: 10, fontWeight: 700, color: "#9B9B9B", textAlign: "center" },
  calMonthGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 },
  calMonthCell: { position: "relative", aspectRatio: "1", minHeight: 40, border: "1px solid #E0E0E0", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "flex-start", padding: 4, gap: 2 },
  calMonthDateNum: { fontSize: 11, fontWeight: 700 },
  calMonthBadge: { position: "absolute", top: 3, right: 3, minWidth: 14, height: 14, borderRadius: 7, background: "#12314F", color: "#FFFFFF", fontSize: 8.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" },
  calMonthDots: { display: "flex", gap: 2, marginTop: "auto" },
  calMonthDot: { width: 6, height: 6, borderRadius: "50%", flexShrink: 0 },

  calGridWrap: { border: "1px solid #E0E0E0", borderRadius: 6, overflow: "hidden" },
  calGridHeaderRow: { display: "flex", borderBottom: "1px solid #E0E0E0", background: "#F9F9F9" },
  calGridTimeColHeader: { width: 40, flexShrink: 0 },
  calGridDayHeaderCol: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, padding: "4px 3px", borderLeft: "1px solid #E0E0E0" },
  calGridDayHeaderBtn: { background: "none", border: "none", fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textAlign: "left" },
  calGridUntimedChip: { fontSize: 9, fontWeight: 700, color: "#FFFFFF", border: "none", borderRadius: 4, padding: "1px 4px", cursor: "pointer", fontFamily: "inherit", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  calGridUntimedToggle: { fontSize: 8.5, fontWeight: 700, color: "#12314F", background: "none", border: "none", padding: "1px 2px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" },
  calGridBody: { display: "flex", position: "relative", overflowY: "auto", maxHeight: 480 },
  calGridTimeCol: { width: 40, flexShrink: 0 },
  calGridTimeLabel: { fontSize: 9, color: "#9B9B9B", textAlign: "right", paddingRight: 4, boxSizing: "border-box", borderTop: "1px solid #F0F0F0" },
  calGridDayCol: { flex: 1, minWidth: 0, position: "relative", borderLeft: "1px solid #E0E0E0" },
  calGridHourLine: { position: "absolute", left: 0, right: 0, borderTop: "1px solid #F0F0F0" },
  calGridBlock: { position: "absolute", left: 2, right: 2, border: "none", borderRadius: 4, color: "#FFFFFF", fontSize: 9.5, fontWeight: 700, padding: "1px 4px", cursor: "pointer", fontFamily: "inherit", textAlign: "left", overflow: "hidden", whiteSpace: "nowrap" },
};
