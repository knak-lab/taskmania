import { useState, useEffect, useMemo, useRef } from "react";
import { loadProjects as gasLoad, saveProjects as gasSave } from "./api/gas";

const TOP_TABS = [
  { key: "総合", label: "総合", color: "#2C3645" },
  { key: "家族", label: "家族", color: "#6B7F6E" },
  { key: "kkr", label: "kkr", color: "#3E5C76" },
  { key: "acco", label: "acco", color: "#A63D34" },
];

const PERSON_KEYS = ["kkr", "acco"];
const SUB_TABS = [
  { key: "総合", label: "総合" },
  { key: "仕事", label: "仕事", color: "#8B6F3E" },
  { key: "趣味", label: "趣味", color: "#A63D34" },
  { key: "研鑽", label: "研鑽", color: "#3E5C76" },
];
const REAL_SUBS = SUB_TABS.slice(1);

const PRIORITIES = [
  { v: 1, label: "急", color: "#A63D34" },
  { v: 2, label: "並", color: "#3E5C76" },
  { v: 3, label: "低", color: "#8B8578" },
];

const PJ_PRIORITIES = [
  { v: 1, label: "重要・緊急", color: "#A63D34" },
  { v: 2, label: "重要・不急", color: "#8B6F3E" },
  { v: 3, label: "軽微・緊急", color: "#3E5C76" },
  { v: 4, label: "軽微・不急", color: "#8B8578" },
];

const MINUTE_OPTIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 15);
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
            style={{ ...styles.timeDropdownItem, fontWeight: 700, color: "#A63D34" }}
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
                color: tm === value ? "#F5F2E9" : "#2C3645",
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
  };
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

function task(name, subtasks) {
  return { id: uid(), name, subtasks };
}

function project(owner, name, tasks, subcategory, priority) {
  return { id: uid(), owner, name, tasks, subcategory: subcategory || null, priority: priority || 2 };
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

function pjProgress(p) {
  let done = 0, total = 0;
  for (const t of p.tasks) {
    const r = taskProgress(t);
    done += r.done;
    total += r.total;
  }
  return { done, total };
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

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
    const dated = t.subtasks.filter((s) => s.scheduledDate);
    if (dated.length === 0) continue;
    const dates = dated.map((s) => s.scheduledDate).sort();
    const { done, total } = taskProgress(t);
    const minPriorityVal = Math.min(...dated.map((s) => s.priority));
    const pInfo = PRIORITIES.find((pr) => pr.v === minPriorityVal) || PRIORITIES[1];
    rows.push({ id: t.id, name: t.name, startDate: dates[0], endDate: dates[dates.length - 1], done, total, color: pInfo.color });
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
              style={{ ...styles.granularityBtn, background: granularity === g.key ? "#2C3645" : "transparent", color: granularity === g.key ? "#F5F2E9" : "#2C3645" }}>
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
      {rowsSorted.length === 0 && <p style={styles.ganttEmpty}>予定日が設定されたサブタスクがまだない。</p>}
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
      const dated = t.subtasks.filter((s) => s.scheduledDate && s.scheduledDate >= todayStr && s.scheduledDate <= monthLaterStr);
      if (dated.length === 0) continue;
      const dates = dated.map((s) => s.scheduledDate).sort();
      const { done, total } = taskProgress(t);
      const minPriorityVal = Math.min(...dated.map((s) => s.priority));
      const pInfo = PRIORITIES.find((pr) => pr.v === minPriorityVal) || PRIORITIES[1];
      taskRows.push({ id: t.id, name: t.name, startDate: dates[0], endDate: dates[dates.length - 1], done, total, color: pInfo.color });
    }
    return { id: p.id, name: p.name, taskRows };
  }).filter((p) => p.taskRows.length > 0);

  if (pjData.length === 0) {
    return <p style={styles.ganttEmpty}>本日から1ヶ月以内に予定日が設定されたサブタスクがまだない。各カテゴリでサブタスクに予定日を入れると、ここに全PJ分がまとまって並ぶ。</p>;
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
              style={{ ...styles.granularityBtn, background: granularity === g.key ? "#2C3645" : "transparent", color: granularity === g.key ? "#F5F2E9" : "#2C3645" }}>
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
              if (r.type === "pj") return <div key={r.id + "-pjband"} style={{ gridRow: idx + 2, gridColumn: `1 / ${buckets.length + 1}`, background: "#E3DECF", borderRadius: 5 }} />;
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

export default function App() {
  const [projects, setProjects] = useState(null);
  const [topTab, setTopTab] = useState("kkr");
  const [subTab, setSubTab] = useState("仕事");
  const [openPJ, setOpenPJ] = useState(() => new Set());
  const [openTask, setOpenTask] = useState(() => new Set());
  const [ganttPJId, setGanttPJId] = useState(null);
  const [runningTarget, setRunningTarget] = useState(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!runningTarget) return;
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
  const [collapsedPrioritySection, setCollapsedPrioritySection] = useState(() => new Set(PJ_PRIORITIES.map((p) => p.v)));
  const [addDate, setAddDate] = useState("");
  const [addStartTime, setAddStartTime] = useState("");
  const [addEstMinutes, setAddEstMinutes] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [modalPJName, setModalPJName] = useState("");
  const [modalTaskName, setModalTaskName] = useState("");

  const inputRef = useRef(null);
  const saveTimer = useRef(null);

  // 初回ロード
  const handleLoad = async () => {
    setSaveState("loading");
    try {
      const data = await gasLoad();
      setProjects(data.length > 0 ? data : seedProjects());
      setSaveState("idle");
    } catch {
      setProjects(seedProjects());
      setSaveState("error");
    }
  };

  useEffect(() => { handleLoad(); }, []);

  // 変更時に自動保存
  useEffect(() => {
    if (projects === null) return;
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await gasSave(projects);
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      } catch {
        setSaveState("error");
      }
    }, 800);
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
  const showPersonSections = PERSON_KEYS.includes(topTab);
  const ownerProjects = useMemo(
    () => (projects || []).filter((p) => p.owner === effectiveOwner),
    [projects, effectiveOwner]
  );
  const categoryProjects = useMemo(
    () => (subTab === "総合" ? ownerProjects : ownerProjects.filter((p) => p.subcategory === subTab)),
    [ownerProjects, subTab]
  );

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
  const todayTasks = [];
  if (showPersonSections) {
    for (const p of categoryProjects) {
      for (const t of p.tasks) {
        for (const s of t.subtasks) {
          if (s.scheduledDate === todayStr) todayTasks.push({ pjId: p.id, pjName: p.name, taskId: t.id, taskName: t.name, sub: s });
        }
      }
    }
    todayTasks.sort((a, b) => {
      if (!a.sub.startTime && !b.sub.startTime) return 0;
      if (!a.sub.startTime) return 1;
      if (!b.sub.startTime) return -1;
      return a.sub.startTime.localeCompare(b.sub.startTime);
    });
  }

  const visibleTodayTasks = todayTasks.filter((t) => !t.sub.done);

  const showWorkSummary = topTab === "kkr" && subTab === "仕事";
  const totalEstMin = todayTasks.reduce((sum, t) => sum + (t.sub.estimatedMinutes || 0), 0);
  const totalActualMin = todayTasks.reduce((sum, t) => sum + (t.sub.actualMinutes || 0), 0);
  const estRatio = totalEstMin / WORK_MINUTES;
  const estWarnLevel = estRatio >= 0.8 ? "red" : estRatio >= 0.6 ? "amber" : null;

  // 今週のタスク
  const DAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

  const [weekAdj, setWeekAdj] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tm_week_adj") || "[]"); } catch { return []; }
  });
  const [adjDateVal, setAdjDateVal] = useState(() => {
    const today = new Date(); const day = today.getDay();
    if (day >= 1 && day <= 5) return toDateStr(today);
    const next = new Date(today); next.setDate(today.getDate() + (day === 0 ? 1 : 8 - day));
    return toDateStr(next);
  });
  const [adjHoursVal, setAdjHoursVal] = useState(1);
  const [weekCollapsed, setWeekCollapsed] = useState(true);

  useEffect(() => { localStorage.setItem("tm_week_adj", JSON.stringify(weekAdj)); }, [weekAdj]);

  const weekDates = useMemo(() => {
    const monday = startOfWeek(new Date());
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i); return toDateStr(d);
    });
  }, []);

  const weekTasks = useMemo(() => {
    if (!showPersonSections) return [];
    const tasks = [];
    for (const p of categoryProjects) {
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
  }, [categoryProjects, weekDates, showPersonSections]);

  const weekSummary = useMemo(() => {
    const futureDates = weekDates.filter(d => d >= todayStr);
    const baseMinutes = futureDates.length * 8 * 60;
    const adjMinutes = weekAdj.filter(a => futureDates.includes(a.date)).reduce((sum, a) => sum + a.hours * 60, 0);
    const effectiveMinutes = Math.max(0, baseMinutes - adjMinutes);
    const estMinutes = weekTasks.filter(t => t.sub.scheduledDate >= todayStr).reduce((sum, t) => sum + (t.sub.estimatedMinutes || 0), 0);
    const ratio = effectiveMinutes > 0 ? estMinutes / effectiveMinutes : 0;
    const warnLevel = ratio >= 0.8 ? "red" : ratio >= 0.6 ? "black" : null;
    return { baseMinutes, adjMinutes, effectiveMinutes, estMinutes, ratio, warnLevel };
  }, [weekTasks, weekAdj, weekDates, todayStr]);

  const addWeekAdj = () => {
    if (!adjDateVal || !adjHoursVal) return;
    setWeekAdj((prev) => {
      const others = prev.filter((a) => a.date !== adjDateVal);
      return [...others, { date: adjDateVal, hours: Number(adjHoursVal) }].sort((a, b) => a.date.localeCompare(b.date));
    });
  };
  const removeWeekAdj = (date) => setWeekAdj((prev) => prev.filter((a) => a.date !== date));

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
  function toggleGantt(id) { setGanttPJId((prev) => (prev === id ? null : id)); }
  function togglePrioritySection(v) { setCollapsedPrioritySection((prev) => { const next = new Set(prev); next.has(v) ? next.delete(v) : next.add(v); return next; }); }

  function updatePJPriority(pjId, priority) {
    setProjects((prev) => prev.map((p) => (p.id === pjId ? { ...p, priority } : p)));
  }

  function addItem(e) {
    if (e && e.preventDefault) e.preventDefault();
    const trimmed = (inputRef.current ? inputRef.current.value : addText).trim();
    if (!trimmed) return;
    if (addLevel === "pj") {
      setProjects((prev) => [...prev, project(effectiveOwner, trimmed, [], ownerHasSub ? addSub : null, addPJPriority)]);
    } else if (addLevel === "task") {
      if (!addPJId) return;
      setProjects((prev) => prev.map((p) => (p.id === addPJId ? { ...p, tasks: [...p.tasks, task(trimmed, [])] } : p)));
    } else {
      if (!addPJId || !addTaskId) return;
      setProjects((prev) => prev.map((p) => {
        if (p.id !== addPJId) return p;
        return { ...p, tasks: p.tasks.map((t) => t.id === addTaskId ? { ...t, subtasks: [...t.subtasks, sub(trimmed, false, addPriority, addDate, addStartTime, addEstMinutes ? Number(addEstMinutes) : null)] } : t) };
      }));
    }
    setAddText(""); setAddDate(""); setAddStartTime(""); setAddEstMinutes("");
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
    setAddText("");
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
    if (s && !s.done) { setStamping(subId); setTimeout(() => setStamping(null), 550); }
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : { ...p, tasks: p.tasks.map((t) => t.id !== taskId ? t : { ...t, subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) }) }));
  }

  function updateSubtaskSchedule(pjId, taskId, subId, field, value) {
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : { ...p, tasks: p.tasks.map((t) => t.id !== taskId ? t : { ...t, subtasks: t.subtasks.map((s) => s.id === subId ? { ...s, [field]: value === "" ? null : value } : s) }) }));
  }

  function commitStopwatch(target) {
    if (!target) return;
    const rawMin = (Date.now() - target.startAt) / 60000;
    const elapsedMin = Math.max(15, Math.round(rawMin / 15) * 15);
    const { pjId, taskId, subId } = target;
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : { ...p, tasks: p.tasks.map((t) => t.id !== taskId ? t : { ...t, subtasks: t.subtasks.map((s) => s.id === subId ? { ...s, actualMinutes: (s.actualMinutes || 0) + elapsedMin } : s) }) }));
  }

  function toggleStopwatch(pjId, taskId, subId) {
    if (runningTarget && runningTarget.subId === subId) { commitStopwatch(runningTarget); setRunningTarget(null); return; }
    if (runningTarget) commitStopwatch(runningTarget);
    setRunningTarget({ pjId, taskId, subId, startAt: Date.now() });
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

  function removePJ(id) { setProjects((prev) => prev.filter((p) => p.id !== id)); }
  function removeTask(pjId, taskId) { setProjects((prev) => prev.map((p) => (p.id === pjId ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) } : p))); }
  function removeSubtask(pjId, taskId, subId) {
    setProjects((prev) => prev.map((p) => p.id !== pjId ? p : { ...p, tasks: p.tasks.map((t) => t.id !== taskId ? t : { ...t, subtasks: t.subtasks.filter((s) => s.id !== subId) }) }));
  }

  const activeTopColor = TOP_TABS.find((c) => c.key === topTab).color;
  const ownerColorOf = (key) => TOP_TABS.find((c) => c.key === key)?.color || activeTopColor;

  const saveLabel = { idle: "", loading: "読込中…", saving: "保存中…", saved: "保存済み", error: "保存失敗" }[saveState];

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
        input:focus, select:focus, button:focus-visible { outline: 2px solid #3E5C76; outline-offset: 2px; }
        ::placeholder { color: #A39D8C; }
        @media (min-width: 768px) {
          .tm-page { padding: 24px 32px 60px !important; }
        }
      `}</style>

      <div style={styles.shell}>
        <header style={styles.header}>
          <div style={styles.logoRow}>
            <span style={styles.logoMark}>⏳️</span>
            <div>
              <h1 style={styles.title}>タスクマニア</h1>
              <p style={styles.subtitle}>PJ・タスク・サブタスクの3段管理</p>
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
                style={{ ...styles.tabBtn, color: active ? "#F5F2E9" : c.color, background: active ? c.color : "transparent", borderColor: c.color }}>
                <span style={{ ...styles.tabDot, background: active ? "#F5F2E9" : c.color }} />
                {c.label}
                <span style={{ ...styles.tabCount, color: active ? "#F5F2E9" : c.color, opacity: count ? 1 : 0.35 }}>{count}</span>
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
                  style={{ ...styles.subTabBtn, color: active ? "#F5F2E9" : color, background: active ? color : "transparent", borderColor: color }}>
                  {s.label}
                  <span style={{ ...styles.subTabCount, color: active ? "#F5F2E9" : color, opacity: count ? 1 : 0.35 }}>{count}</span>
                </button>
              );
            })}
          </nav>
        )}

        <section style={{ ...styles.panel, borderColor: activeTopColor }}>
          {showPersonSections && (
            <>
              <h3 style={styles.sectionTitle}>総合ガントチャート</h3>
              <OverviewGanttChart projects={categoryProjects} />
              <h3 style={styles.sectionTitle}>今日のタスク</h3>
              {showWorkSummary && (
                <div style={styles.workSummaryBar}>
                  <span style={styles.workSummaryItem}>業務時間 8時間</span>
                  <span style={styles.workSummaryItem}>
                    想定時間計 {totalEstMin ? formatDuration(totalEstMin) : "0分"}
                    {estWarnLevel && <span style={{ ...styles.workWarnIcon, color: estWarnLevel === "red" ? "#A63D34" : "#2C3645" }}>⚠</span>}
                  </span>
                  <span style={styles.workSummaryItem}>実績計 {totalActualMin ? formatDuration(totalActualMin) : "0分"}</span>
                </div>
              )}
              {visibleTodayTasks.length === 0 ? (
                <p style={styles.emptySmall}>今日の予定日が入ってるサブタスクはない。</p>
              ) : (
                <ul style={styles.todayList}>
                  {visibleTodayTasks.map(({ pjId, pjName, taskId, taskName, sub: s }) => (
                    <li key={s.id} style={styles.calendarCard} className="row-in">
                      <div style={styles.calendarLine1}>
                        <button onClick={() => toggleSubtaskDone(pjId, taskId, s.id)} aria-label={s.done ? "未完了に戻す" : "完了にする"} style={styles.stampWrap}>
                          {s.done ? <span style={styles.hankoStamp} className={stamping === s.id ? "hanko-pop" : ""}>済</span> : <span style={styles.hankoEmpty} />}
                        </button>
                        <TimeDropdown value={s.startTime || ""} onChange={(v) => updateSubtaskSchedule(pjId, taskId, s.id, "startTime", v)} style={{ width: 54 }} />
                        <span style={{ ...styles.calTimeCol, width: 40 }}>{addMinutesToTime(s.startTime, s.estimatedMinutes) || "―"}</span>
                        <span style={{ ...styles.calSubCol, textDecoration: s.done ? "line-through" : "none", color: s.done ? "#A39D8C" : "#2C3645" }} title={s.text}>{s.text}</span>
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
                        <button type="button" onClick={() => toggleStopwatch(pjId, taskId, s.id)}
                          style={{ ...styles.stopwatchBtn, background: runningTarget?.subId === s.id ? "#A63D34" : "transparent", color: runningTarget?.subId === s.id ? "#F5F2E9" : "#3E5C76", borderColor: "#3E5C76" }}
                          aria-label={runningTarget?.subId === s.id ? "計測を終了" : "計測を開始"}>
                          {runningTarget?.subId === s.id ? (() => { const sec = Math.max(0, Math.floor((Date.now() - runningTarget.startAt) / 1000)); return `■ ${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; })() : "▶"}
                        </button>
                        <span style={styles.calPjCol} title={pjName}>{pjName}</span>
                        <span style={styles.calTaskCol} title={taskName}>{taskName}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <h3 style={styles.sectionTitle}>今週のタスク</h3>
              <div style={styles.workSummaryBar}>
                <span style={styles.workSummaryItem}>稼働可能 {formatDuration(weekSummary.effectiveMinutes) || "0分"}</span>
                <span style={styles.workSummaryItem}>
                  想定時間計 {weekSummary.estMinutes ? formatDuration(weekSummary.estMinutes) : "0分"}
                  {weekSummary.warnLevel && <span style={{ ...styles.workWarnIcon, color: weekSummary.warnLevel === "red" ? "#A63D34" : "#2C3645" }}>⚠</span>}
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
                        {weekDates.map((d) => {
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

                  {weekAdj.filter((a) => weekDates.includes(a.date)).length > 0 && (
                    <ul style={styles.todayList}>
                      {weekAdj.filter((a) => weekDates.includes(a.date)).map((a) => {
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

                  {weekTasks.length === 0 ? (
                    <p style={styles.emptySmall}>今週の予定日が入ってるサブタスクはない。</p>
                  ) : (
                    <ul style={styles.todayList}>
                      {weekTasks.map(({ pjId, pjName, taskId, taskName, sub: s }) => {
                        const dt = new Date(s.scheduledDate + "T00:00:00");
                        return (
                          <li key={s.id} style={styles.calendarCard} className="row-in">
                            <div style={styles.calendarLine1}>
                              <button onClick={() => toggleSubtaskDone(pjId, taskId, s.id)} aria-label={s.done ? "未完了に戻す" : "完了にする"} style={styles.stampWrap}>
                                {s.done ? <span style={styles.hankoStamp} className={stamping === s.id ? "hanko-pop" : ""}>済</span> : <span style={styles.hankoEmpty} />}
                              </button>
                              <span style={{ ...styles.calTimeCol, width: 60 }}>{formatDate(s.scheduledDate)}({DAY_JP[dt.getDay()]})</span>
                              <span style={styles.calEstTag}>想定{s.estimatedMinutes ? formatDuration(s.estimatedMinutes) : "―"}</span>
                              <span style={{ ...styles.calSubCol, textDecoration: s.done ? "line-through" : "none", color: s.done ? "#A39D8C" : "#2C3645" }} title={s.text}>{s.text}</span>
                            </div>
                            <div style={styles.calendarLine2}>
                              <span style={styles.calPjCol} title={pjName}>{pjName}</span>
                              <span style={styles.calTaskCol} title={taskName}>{taskName}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </>
          )}

          {showPersonSections && <h3 style={styles.sectionTitle}>タスク一覧</h3>}

          {addModalOpen && (
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
                            style={{ ...styles.priorityBtn, background: addPJPriority === p.v ? p.color : "transparent", color: addPJPriority === p.v ? "#F5F2E9" : p.color, borderColor: p.color }}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {addLevel === "subtask" && (
                      <div style={styles.priorityGroup}>
                        {PRIORITIES.map((p) => (
                          <button type="button" key={p.v} onClick={() => setAddPriority(p.v)}
                            style={{ ...styles.priorityBtn, background: addPriority === p.v ? p.color : "transparent", color: addPriority === p.v ? "#F5F2E9" : p.color, borderColor: p.color }}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {addLevel === "subtask" && (
                    <div style={styles.scheduleRow}>
                      <label style={styles.scheduleField}>
                        <span style={styles.scheduleLabel}>予定日</span>
                        <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} style={styles.scheduleInput} />
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
          )}

          <div style={styles.tree}>
            {projects === null && <p style={styles.empty}>読み込み中…</p>}
            {projects !== null && visibleProjects.length === 0 && <p style={styles.empty}>まだPJがない。上のフォームから作成できる。</p>}
            {projects !== null && visibleProjects.length > 0 && PJ_PRIORITIES.map((pri) => {
              const group = visibleProjects.filter((pp) => (pp.priority || 2) === pri.v);
              if (group.length === 0) return null;
              const sectionOpen = !collapsedPrioritySection.has(pri.v);
              return (
                <div key={pri.v} style={styles.prioritySection}>
                  <button type="button" onClick={() => togglePrioritySection(pri.v)} style={{ ...styles.prioritySectionHeader, color: pri.color, borderColor: pri.color }}>
                    <span>{sectionOpen ? "▾" : "▸"}</span>
                    <span>{pri.label}</span>
                    <span style={styles.prioritySectionCount}>{group.length}</span>
                  </button>
                  {sectionOpen && (
                    <div style={styles.prioritySectionBody}>
                      {group.map((p) => {
              const pjOpen = openPJ.has(p.id);
              const { done: pd, total: pt } = pjProgress(p);
              const oColor = ownerColorOf(p.owner);
              return (
                <div key={p.id} style={{ ...styles.pjCard, borderLeftColor: oColor }} className="row-in">
                  <div style={styles.pjHeader}>
                    <button onClick={() => toggleOpenPJ(p.id)} style={styles.collapseBtn} aria-label={pjOpen ? "折りたたむ" : "展開する"}>{pjOpen ? "▾" : "▸"}</button>
                    <button onClick={() => toggleGantt(p.id)} style={{ ...styles.pjName, background: ganttPJId === p.id ? "#EAE6DB" : "transparent" }} aria-label="ガントチャートを表示">{p.name}</button>
                    <select value={p.priority || 2} onChange={(e) => updatePJPriority(p.id, Number(e.target.value))} style={styles.moveSelect} aria-label="優先度を変更">
                      {PJ_PRIORITIES.map((pr) => <option key={pr.v} value={pr.v}>{pr.label}</option>)}
                    </select>
                    {topTab === "総合" && <span style={{ ...styles.metaTag, borderColor: oColor, color: oColor }}>{TOP_TABS.find((c) => c.key === p.owner)?.label}</span>}
                    {(topTab === "総合" || subTab === "総合") && p.subcategory && (
                      <span style={{ ...styles.metaTag, borderColor: SUB_TABS.find((s) => s.key === p.subcategory)?.color, color: SUB_TABS.find((s) => s.key === p.subcategory)?.color }}>{p.subcategory}</span>
                    )}
                    <span style={styles.progressTag}>{pd}/{pt}</span>
                    <button type="button" onClick={() => openAddTaskModal(p.id, p.name)} style={styles.inlineAddBtn}>＋タスク</button>
                    <button onClick={() => removePJ(p.id)} aria-label="PJを削除" style={styles.deleteBtn}>×</button>
                  </div>
                  {ganttPJId === p.id && <GanttChart project={p} />}
                  {pjOpen && (
                    <div style={styles.taskList}>
                      {p.tasks.length === 0 && <p style={styles.emptySmall}>タスクなし</p>}
                      {p.tasks.map((t) => {
                        const taskOpen = openTask.has(t.id);
                        const { done: td, total: tt } = taskProgress(t);
                        return (
                          <div key={t.id} style={styles.taskCard} className="row-in">
                            <div style={styles.taskHeader}>
                              <button onClick={() => toggleOpenTask(t.id)} style={styles.collapseBtnSm} aria-label={taskOpen ? "折りたたむ" : "展開する"}>{taskOpen ? "▾" : "▸"}</button>
                              <span style={styles.taskName}>{t.name}</span>
                              <span style={styles.progressTagSm}>{td}/{tt}</span>
                              <select value={p.id} onChange={(e) => moveTask(p.id, t.id, e.target.value)} style={styles.moveSelect} aria-label="PJを変更">
                                {projects.map((pp) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                              </select>
                              <button type="button" onClick={() => openAddSubtaskModal(p.id, t.id, p.name, t.name)} style={styles.inlineAddBtn}>＋サブ</button>
                              <button onClick={() => removeTask(p.id, t.id)} aria-label="タスクを削除" style={styles.deleteBtn}>×</button>
                            </div>
                            {taskOpen && (
                              <ul style={styles.subList}>
                                {t.subtasks.length === 0 && <li style={styles.emptySmall}>サブタスクなし</li>}
                                {t.subtasks.map((s) => {
                                  const pInfo = PRIORITIES.find((pr) => pr.v === s.priority);
                                  return (
                                    <li key={s.id} style={styles.subRowWrap} className="row-in">
                                      <div style={styles.subRow}>
                                        <button onClick={() => toggleSubtaskDone(p.id, t.id, s.id)} aria-label={s.done ? "未完了に戻す" : "完了にする"} style={styles.stampWrap}>
                                          {s.done ? <span style={styles.hankoStamp} className={stamping === s.id ? "hanko-pop" : ""}>済</span> : <span style={styles.hankoEmpty} />}
                                        </button>
                                        <div style={styles.subBody}>
                                          <span style={{ ...styles.subText, textDecoration: s.done ? "line-through" : "none", color: s.done ? "#A39D8C" : "#2C3645" }}>{s.text}</span>
                                          <div style={styles.scheduleEditRow}>
                                            <label style={styles.scheduleEditField}>
                                              <span style={styles.scheduleEditLabel}>予定日</span>
                                              <input type="date" value={s.scheduledDate || ""} onChange={(e) => updateSubtaskSchedule(p.id, t.id, s.id, "scheduledDate", e.target.value)} style={styles.scheduleEditInput} />
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
                                                <button type="button" onClick={() => toggleStopwatch(p.id, t.id, s.id)}
                                                  style={{ ...styles.stopwatchBtn, background: runningTarget?.subId === s.id ? "#A63D34" : "transparent", color: runningTarget?.subId === s.id ? "#F5F2E9" : "#3E5C76", borderColor: "#3E5C76" }}
                                                  aria-label={runningTarget?.subId === s.id ? "計測を終了" : "計測を開始"}>
                                                  {runningTarget?.subId === s.id ? (() => { const sec = Math.max(0, Math.floor((Date.now() - runningTarget.startAt) / 1000)); return `■ ${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; })() : "▶"}
                                                </button>
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
                                        <button onClick={() => removeSubtask(p.id, t.id, s.id)} aria-label="削除" style={styles.deleteBtn}>×</button>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
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
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#EAE6DB", backgroundImage: "repeating-linear-gradient(0deg, rgba(44,54,69,0.025) 0px, rgba(44,54,69,0.025) 1px, transparent 1px, transparent 28px)", fontFamily: "'Zen Kaku Gothic New', sans-serif", padding: "20px 12px 60px" },
  shell: { width: "100%" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  logoRow: { display: "flex", alignItems: "center", gap: 12 },
  logoMark: { fontFamily: "'Shippori Mincho', serif", fontWeight: 700, fontSize: 22, color: "#F5F2E9", background: "#A63D34", width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 0 rgba(44,54,69,0.25)" },
  title: { fontFamily: "'Shippori Mincho', serif", fontWeight: 700, fontSize: 21, color: "#2C3645", margin: 0, letterSpacing: "0.02em" },
  subtitle: { fontSize: 11.5, color: "#8B8578", margin: "2px 0 0" },
  saveIndicator: { fontSize: 11, color: "#8B8578", minWidth: 60, textAlign: "right" },
  reloadBtn: { fontSize: 11, fontWeight: 700, color: "#3E5C76", background: "transparent", border: "1.5px solid #3E5C76", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit" },
  tabs: { display: "flex", gap: 6, marginBottom: -1, position: "relative", zIndex: 2 },
  tabBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 4px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", border: "1.5px solid", borderBottom: "none", borderRadius: "8px 8px 0 0", cursor: "pointer", transition: "background 0.15s, color 0.15s" },
  tabDot: { width: 6, height: 6, borderRadius: "50%", flexShrink: 0 },
  tabCount: { fontSize: 10.5, fontWeight: 700 },
  subTabs: { display: "flex", gap: 5, padding: "8px 8px 8px", background: "#DFDACB", borderLeft: "1.5px solid #C9C2B2", borderRight: "1.5px solid #C9C2B2", position: "relative", zIndex: 1 },
  subTabBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "6px 2px", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", border: "1.5px solid", borderRadius: 6, cursor: "pointer" },
  subTabCount: { fontSize: 9.5, fontWeight: 700 },
  panel: { background: "#F5F2E9", border: "1.5px solid", borderRadius: "0 6px 10px 10px", padding: 16, boxShadow: "0 3px 14px rgba(44,54,69,0.08)" },
  formRow: { display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(44,54,69,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 },
  modalBox: { width: "100%", maxWidth: 420, maxHeight: "86vh", overflowY: "auto", background: "#F5F2E9", border: "1.5px solid #2C3645", borderRadius: 10, padding: 18, boxShadow: "0 8px 28px rgba(44,54,69,0.3)" },
  modalHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  modalTitle: { fontFamily: "'Shippori Mincho', serif", fontSize: 16, fontWeight: 700, color: "#2C3645", margin: 0 },
  modalCloseBtn: { background: "none", border: "none", fontSize: 20, lineHeight: 1, color: "#8B8578", cursor: "pointer", padding: 4 },
  modalContext: { fontSize: 11.5, color: "#8B8578", margin: "0 0 12px" },
  modalActions: { display: "flex", justifyContent: "flex-end", marginTop: 12 },
  inlineAddBtn: { fontSize: 10.5, fontWeight: 700, color: "#3E5C76", background: "transparent", border: "1.5px solid #3E5C76", borderRadius: 5, padding: "2px 7px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 },
  select: { flex: 1, minWidth: 100, fontSize: 12.5, padding: "7px 6px", borderRadius: 6, border: "1.5px solid #C9C2B2", background: "#FDFCF8", color: "#2C3645", fontFamily: "inherit" },
  hint: { fontSize: 11.5, color: "#A63D34", margin: "0 0 6px" },
  sectionTitle: { fontSize: 12.5, fontWeight: 700, color: "#2C3645", margin: "14px 0 8px", paddingBottom: 4, borderBottom: "1.5px solid #DAD4C4" },
  workSummaryBar: { display: "flex", gap: 10, flexWrap: "wrap", padding: "6px 8px", marginBottom: 8, background: "#F5F2E9", border: "1px solid #DAD4C4", borderRadius: 6 },
  workSummaryItem: { fontSize: 11, fontWeight: 700, color: "#2C3645", display: "flex", alignItems: "center" },
  workWarnIcon: { marginLeft: 4, fontSize: 13, fontWeight: 900 },
  todayList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 },
  calendarCard: { padding: "7px 2px", borderBottom: "1px dashed #DAD4C4", display: "flex", flexDirection: "column", gap: 4 },
  calendarLine1: { display: "flex", alignItems: "center", gap: 8 },
  calendarLine2: { display: "flex", alignItems: "center", gap: 6, paddingLeft: 34 },
  calendarLine2Label: { fontSize: 9.5, color: "#A39D8C", fontWeight: 700 },
  calTimeCol: { width: 40, flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: "#8B8578", fontVariantNumeric: "tabular-nums" },
  calEstTag: { fontSize: 9.5, fontWeight: 700, color: "#6B7F6E", background: "#EAE6DB", padding: "1px 6px", borderRadius: 8, flexShrink: 0, whiteSpace: "nowrap" },
  calSubCol: { flex: "1 1 auto", minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  calPjCol: { fontSize: 10, color: "#3E5C76", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 },
  calTaskCol: { fontSize: 10, color: "#8B6F3E", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 },
  inputRow: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  input: { flex: "1 1 160px", padding: "10px 12px", fontSize: 14, border: "1.5px solid #C9C2B2", borderRadius: 6, background: "#FDFCF8", color: "#2C3645", fontFamily: "inherit" },
  priorityGroup: { display: "flex", gap: 4 },
  priorityBtn: { padding: "7px 9px", fontSize: 12, fontWeight: 700, border: "1.5px solid", borderRadius: 6, cursor: "pointer", fontFamily: "inherit" },
  scheduleRow: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" },
  scheduleField: { display: "flex", flexDirection: "column", gap: 2 },
  scheduleLabel: { fontSize: 10, color: "#8B8578", fontWeight: 700 },
  scheduleInput: { fontSize: 12.5, padding: "6px 6px", borderRadius: 6, border: "1.5px solid #C9C2B2", background: "#FDFCF8", color: "#2C3645", fontFamily: "inherit" },
  addBtn: { padding: "9px 14px", fontSize: 13, fontWeight: 700, color: "#F5F2E9", background: "#2C3645", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  tree: { display: "flex", flexDirection: "column", gap: 14 },
  prioritySection: { display: "flex", flexDirection: "column", gap: 8 },
  prioritySectionHeader: { display: "flex", alignItems: "center", gap: 6, width: "100%", background: "transparent", border: "none", borderBottom: "1.5px solid", padding: "0 0 4px", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, textAlign: "left" },
  prioritySectionCount: { marginLeft: "auto", fontSize: 10.5, fontWeight: 700, color: "#8B8578" },
  prioritySectionBody: { display: "flex", flexDirection: "column", gap: 10 },
  empty: { padding: "18px 4px", color: "#A39D8C", fontSize: 13, textAlign: "center" },
  emptySmall: { padding: "6px 4px", color: "#A39D8C", fontSize: 11.5, margin: 0 },
  pjCard: { background: "#FDFCF8", border: "1px solid #DAD4C4", borderLeft: "4px solid", borderRadius: 8, padding: 10 },
  pjHeader: { display: "flex", alignItems: "center", gap: 6 },
  collapseBtn: { background: "none", border: "none", fontSize: 13, color: "#2C3645", cursor: "pointer", width: 18, padding: 0, flexShrink: 0 },
  collapseBtnSm: { background: "none", border: "none", fontSize: 11, color: "#3E5C76", cursor: "pointer", width: 16, padding: 0, flexShrink: 0 },
  pjName: { flex: 1, fontSize: 14, fontWeight: 700, color: "#2C3645", minWidth: 0, textAlign: "left", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "3px 5px", borderRadius: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  taskName: { flex: 1, fontSize: 13, fontWeight: 600, color: "#2C3645", minWidth: 0 },
  progressTag: { fontSize: 10.5, fontWeight: 700, color: "#6B7F6E", background: "#EAE6DB", padding: "2px 6px", borderRadius: 8, flexShrink: 0 },
  progressTagSm: { fontSize: 10, fontWeight: 700, color: "#6B7F6E", background: "#EAE6DB", padding: "1px 5px", borderRadius: 8, flexShrink: 0 },
  taskList: { marginTop: 8, display: "flex", flexDirection: "column", gap: 6, paddingLeft: 18 },
  ganttWrap: { marginTop: 8, padding: 10, background: "#F5F2E9", border: "1px dashed #C9C2B2", borderRadius: 8 },
  ganttEmpty: { fontSize: 11.5, color: "#A39D8C", margin: 0, lineHeight: 1.5 },
  ganttToolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  granularityGroup: { display: "flex", gap: 3 },
  granularityBtn: { padding: "4px 8px", fontSize: 10.5, fontWeight: 700, border: "1.5px solid #2C3645", borderRadius: 5, cursor: "pointer", fontFamily: "inherit" },
  ganttLegend: { display: "flex", gap: 10, flexWrap: "wrap" },
  ganttLegendItem: { display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "#8B8578", fontWeight: 700 },
  ganttLegendDot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block" },
  ganttScroll: { overflowX: "auto", paddingBottom: 4, flex: 1, minWidth: 0 },
  ganttSplitWrap: { display: "flex", gap: 6 },
  ganttLabelCol: { flexShrink: 0, width: 112, display: "flex", flexDirection: "column", gap: 3 },
  ganttLabelHeaderCell: { height: 26 },
  ganttLabelCell: { height: 22, display: "flex", alignItems: "center", fontSize: 10.5, color: "#2C3645", paddingRight: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ganttGrid: { display: "grid", rowGap: 3, columnGap: 2, alignItems: "center" },
  ganttDateCell: { fontSize: 9.5, fontWeight: 700, color: "#8B8578", textAlign: "center", paddingBottom: 4, borderBottom: "1px solid #DAD4C4" },
  ganttBarTrack: { height: 14, background: "#E3DECF", borderRadius: 5, overflow: "hidden", display: "flex", alignItems: "stretch" },
  ganttBarFill: { height: "100%", borderRadius: 5, minWidth: 4 },
  ganttPjRow: { display: "flex", alignItems: "center", gap: 6, background: "#E3DECF", border: "none", borderRadius: 5, padding: "0 6px", height: 22, boxSizing: "border-box", cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, color: "#2C3645", textAlign: "left", width: "100%" },
  ganttPjName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ganttPjCount: { fontSize: 9.5, color: "#8B8578", fontWeight: 700, marginLeft: "auto", flexShrink: 0 },
  taskCard: { background: "#F5F2E9", border: "1px solid #E3DECF", borderRadius: 6, padding: 8 },
  taskHeader: { display: "flex", alignItems: "center", gap: 6 },
  subList: { listStyle: "none", margin: "6px 0 0", padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 2 },
  subRowWrap: { borderBottom: "1px dashed #E3DECF" },
  subRow: { display: "flex", alignItems: "flex-start", gap: 7, padding: "6px 0" },
  subBody: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, paddingTop: 2 },
  scheduleEditRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  scheduleEditField: { display: "flex", flexDirection: "column", gap: 1 },
  scheduleEditLabel: { fontSize: 9, color: "#A39D8C", fontWeight: 700 },
  scheduleEditInput: { fontSize: 11, padding: "3px 5px", borderRadius: 5, border: "1.5px solid #E3DECF", background: "#FDFCF8", color: "#2C3645", fontFamily: "inherit" },
  moveSelect: { fontSize: 10, padding: "2px 4px", borderRadius: 5, border: "1.5px solid #C9C2B2", background: "#FDFCF8", color: "#2C3645", fontFamily: "inherit", maxWidth: 92 },
  timeDropdownList: { position: "absolute", top: "100%", left: 0, zIndex: 10, marginTop: 2, width: 90, maxHeight: 180, overflowY: "auto", background: "#FDFCF8", border: "1.5px solid #C9C2B2", borderRadius: 6, boxShadow: "0 4px 12px rgba(44,54,69,0.18)" },
  timeDropdownItem: { padding: "5px 8px", fontSize: 11.5, cursor: "pointer", borderBottom: "1px solid #EAE6DB" },
  actualRow: { display: "flex", gap: 3, alignItems: "center" },
  stopwatchBtn: { fontSize: 10.5, fontWeight: 700, padding: "3px 6px", borderRadius: 5, border: "1.5px solid", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  stampWrap: { background: "none", border: "none", padding: 0, cursor: "pointer", width: 26, height: 26, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" },
  hankoEmpty: { width: 20, height: 20, borderRadius: "50%", border: "2px solid #C9C2B2", display: "block" },
  hankoStamp: { width: 22, height: 22, borderRadius: "50%", border: "2px solid #A63D34", color: "#A63D34", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Shippori Mincho', serif", fontWeight: 700, fontSize: 9.5, transform: "rotate(-10deg)" },
  subText: { flex: 1, fontSize: 13, lineHeight: 1.4, wordBreak: "break-word", minWidth: 0 },
  metaTag: { fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 10, border: "1px solid", flexShrink: 0 },
  deleteBtn: { background: "none", border: "none", color: "#C9C2B2", fontSize: 16, cursor: "pointer", padding: "0 2px", flexShrink: 0, lineHeight: 1 },
};
