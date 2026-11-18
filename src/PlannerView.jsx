import { useState, useMemo, useRef, useEffect } from "react";
import "./PlannerView.css";
// 今日タブ: カレンダー(1日/平日/7日) + 今日・日付なし・期限切れのサブタスク一覧。
// 一覧や「時刻なし」のチップをカレンダーへドラッグで置くと、予定日・開始時刻・想定時間が入る。
// カレンダー上の予定は Outlook と同じく、つかんで移動、上端・下端で開始/終了時刻を変えられる(30分単位)。
const H0 = 7;
const H1 = 20;
const HH = 56; // 1時間の高さ(px)
const SNAP = 30;
const DEF_DUR = 30;
const CHIP_MAX = 3; // 時刻なしチップは日ごとにこの件数まで(残りは「他N件」で開く)
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const pad = (n) => String(n).padStart(2, "0");
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return toStr(d); };
const mondayOf = (s) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toStr(d); };
const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
const toTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const snap = (m) => Math.round(m / SNAP) * SNAP;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const durOf = (s) => Math.max(SNAP, Number(s.estimatedMinutes) || DEF_DUR);

// 重なる予定を横に並べる(列数と自分の列)
function layout(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const ends = [];
    cluster.forEach((it) => {
      let c = ends.findIndex((e) => e <= it.start);
      if (c === -1) { c = ends.length; ends.push(it.end); } else ends[c] = it.end;
      it.col = c;
    });
    cluster.forEach((it) => { it.cols = ends.length; out.push(it); });
    cluster = [];
  };
  sorted.forEach((it) => {
    if (cluster.length && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  });
  if (cluster.length) flush();
  return out;
}

const NO_ASSIGNEE = "__none__";
function loadAssigneeFilter() {
  try { return localStorage.getItem("tm_planner_assignee") || ""; } catch { return ""; }
}
// 担当はサブタスク→タスク→PJの順で、最初に付いているものを使う(新規作成時に親の担当を引き継ぐのと同じ考え方)
const effAssignees = (p, t, s) => (s.assignees?.length ? s.assignees : t.assignees?.length ? t.assignees : p.assignees || []);
// 担当者ごとの色(kkr>work のカレンダーだけ)。Outlookの予定はこの色で塗り、サブタスクは少し薄く塗る。
// 担当が複数なら、先に並んでいる色ありの人の色。色が無い人・担当なしは従来どおり(所有者の色)
const PERSON_COLORS = { "永井": "#EE8A12", "田之上": "#2F9E5E" };
const personColor = (names) => { for (const n of names || []) if (PERSON_COLORS[n]) return PERSON_COLORS[n]; return ""; };

function loadShowOutlook() {
  try { return localStorage.getItem("tm_planner_outlook") !== "0"; } catch { return true; }
}
const OUTLOOK_STATUS = { unset: "Outlookのリンクが未設定です", fetch_failed: "Outlookの予定を読み込めませんでした", bad_range: "Outlookの予定を読み込めませんでした" };

function loadMode() {
  try { const m = localStorage.getItem("tm_planner_mode"); return m === "week" || m === "day" ? m : "weekday"; } catch { return "weekday"; }
}

export default function PlannerView({ projects, todayStr, ownerColorOf, onUpdateFields, onOpenSub, onToggleDone, extra, assignees, outlook }) {
  const [mode, setMode] = useState(loadMode);
  // 担当で絞り込み("" = 全員、NO_ASSIGNEE = 担当なし)。assigneesを渡されたタブ(kkr>work)だけで使う
  const [who, setWho] = useState(loadAssigneeFilter);
  useEffect(() => { try { localStorage.setItem("tm_planner_assignee", who); } catch { /* ignore */ } }, [who]);
  const whoActive = assignees ? who : "";
  // Outlook の予定(読み取り専用)。outlook を渡されたタブ(kkr>work)だけ。表示/非表示は端末ごとに覚える
  const [showOl, setShowOl] = useState(loadShowOutlook);
  useEffect(() => { try { localStorage.setItem("tm_planner_outlook", showOl ? "1" : "0"); } catch { /* ignore */ } }, [showOl]);
  const olByDate = useMemo(() => {
    const m = {};
    // 担当ボタンと連動: 全員なら全部、担当者を選んでいたらその人の予定表だけ(担当なしでは出さない)
    if (outlook && showOl) outlook.events.forEach((ev) => {
      if (whoActive && whoActive !== (ev.who || "")) return;
      (m[ev.date] ||= []).push(ev);
    });
    return m;
  }, [outlook, showOl, whoActive]);
  const [anchor, setAnchor] = useState(todayStr); // 表示の基準日(1日表示ではその日、週表示ではその日を含む週)
  const [open, setOpen] = useState({ today: true, none: true, overdue: false });
  const [drag, setDrag] = useState(null); // 表示用: {id, date, start, dur}
  const [chipOpen, setChipOpen] = useState(() => new Set());
  const dragRef = useRef(null); // 進行中のドラッグ(ポインタ座標など)
  const bodyRef = useRef(null);
  useEffect(() => { try { localStorage.setItem("tm_planner_mode", mode); } catch { /* ignore */ } }, [mode]);

  const dates = useMemo(() => {
    if (mode === "day") return [anchor];
    const weekStart = mondayOf(anchor);
    return Array.from({ length: mode === "week" ? 7 : 5 }, (_, i) => addDays(weekStart, i));
  }, [anchor, mode]);
  const step = mode === "day" ? 1 : 7;

  const items = useMemo(() => {
    const out = [];
    for (const p of projects) {
      if (p.status) continue; // 保留・完了PJは出さない
      for (const t of p.tasks) {
        for (const s of t.subtasks) {
          const a = effAssignees(p, t, s);
          if (whoActive && (whoActive === NO_ASSIGNEE ? a.length > 0 : !a.includes(whoActive))) continue;
          out.push({ pjId: p.id, pjName: (p.goalTarget ? "☆" : "") + p.name, taskId: t.id, taskName: t.name, owner: p.owner, sub: s, pc: assignees ? personColor(a) : "" });
        }
      }
    }
    return out;
  }, [projects, whoActive, assignees]);
  const byDate = useMemo(() => {
    const m = {};
    items.forEach((it) => { if (it.sub.scheduledDate) (m[it.sub.scheduledDate] ||= []).push(it); });
    return m;
  }, [items]);
  const todayList = items.filter((it) => it.sub.scheduledDate === todayStr && !it.sub.done);
  const noneList = items.filter((it) => !it.sub.scheduledDate && !it.sub.done);
  const overdueList = items.filter((it) => it.sub.scheduledDate && it.sub.scheduledDate < todayStr && !it.sub.done)
    .sort((a, b) => a.sub.scheduledDate.localeCompare(b.sub.scheduledDate));

  // ---- ドラッグ ----
  function colAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest("[data-pl-date]") : null;
  }
  function minuteAt(y, col) {
    return H0 * 60 + ((y - col.getBoundingClientRect().top) / HH) * 60;
  }
  function show(next) {
    if (dragRef.current) dragRef.current.preview = next;
    setDrag(next);
  }
  function compute() {
    const d = dragRef.current;
    if (!d || !d.active) return;
    const { x, y } = d;
    if (d.kind === "move" || d.kind === "new") {
      const col = colAt(x, y);
      if (!col) { show({ id: d.item.sub.id, date: null }); return; }
      const start = clamp(snap(minuteAt(y, col) - d.offset), H0 * 60, H1 * 60 - d.dur);
      show({ id: d.item.sub.id, date: col.dataset.plDate, start, dur: d.dur });
    } else {
      const col = bodyRef.current?.querySelector(`[data-pl-date="${d.date}"]`);
      if (!col) return;
      const m = snap(minuteAt(y, col));
      if (d.kind === "end") {
        const dur = clamp(m - d.start, SNAP, H1 * 60 - d.start);
        show({ id: d.item.sub.id, date: d.date, start: d.start, dur });
      } else {
        const end = d.start + d.dur;
        const start = clamp(m, H0 * 60, end - SNAP);
        show({ id: d.item.sub.id, date: d.date, start, dur: end - start });
      }
    }
  }
  function onMove(e) {
    const d = dragRef.current;
    if (!d) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
      d.active = true;
      document.body.classList.add("pl-dragging");
      d.timer = requestAnimationFrame(tick);
    }
    e.preventDefault();
    compute();
  }
  // 画面の端に近づいたらスクロールし続ける(一覧からカレンダーまで持っていけるように)
  function tick() {
    const d = dragRef.current;
    if (!d || !d.active) return;
    const edge = 70;
    if (d.y < edge) window.scrollBy(0, -14);
    else if (d.y > window.innerHeight - edge) window.scrollBy(0, 14);
    compute();
    d.timer = requestAnimationFrame(tick);
  }
  function onUp() {
    const d = dragRef.current;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    dragRef.current = null;
    if (!d) return;
    cancelAnimationFrame(d.timer);
    document.body.classList.remove("pl-dragging");
    const it = d.item;
    if (!d.active) {
      onOpenSub(it.pjId, it.taskId, it.sub.id); // 動かさずに離した = クリック
      setDrag(null);
      return;
    }
    const p = d.preview;
    if (p && p.date) onUpdateFields(it.pjId, it.taskId, it.sub.id, { scheduledDate: p.date, startTime: toTime(p.start), estimatedMinutes: p.dur });
    setDrag(null);
  }
  function startDrag(e, item, kind) {
    if (e.button !== undefined && e.button !== 0) return;
    // タッチでは一覧の行は「⠿」をつかんだときだけドラッグ(それ以外は普通にスクロール)
    if (kind === "new" && e.pointerType !== "mouse" && !e.target.closest(".pl-handle")) return;
    e.stopPropagation();
    const s = item.sub;
    const start = s.startTime ? toMin(s.startTime) : null;
    const dur = durOf(s);
    let offset = 0;
    if (kind === "move") {
      const col = colAt(e.clientX, e.clientY);
      offset = col ? minuteAt(e.clientY, col) - start : 0;
    }
    dragRef.current = { item, kind, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, active: false, start, dur, offset, date: s.scheduledDate };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  // ---- 表示 ----
  const hours = Array.from({ length: H1 - H0 }, (_, i) => H0 + i);
  const gridH = (H1 - H0) * HH;
  const nowMin = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  const label = mode === "day"
    ? `${md(anchor)}(${WD[new Date(anchor + "T00:00:00").getDay()]})`
    : `${md(dates[0])}〜${md(dates[dates.length - 1])}`;

  const block = (it, start, dur, extraCls, style) => {
    const s = it.sub;
    return (
      <div key={s.id + (extraCls || "")} className={`pl-block${s.done ? " done" : ""}${it.pc ? " person" : ""}${extraCls ? " " + extraCls : ""}`}
        style={{ top: ((start - H0 * 60) / 60) * HH, height: Math.max(14, (dur / 60) * HH), "--oc": ownerColorOf(it.owner), "--pc": it.pc || undefined, ...style }}
        onPointerDown={(e) => startDrag(e, it, e.target.closest(".pl-rz-top") ? "start" : e.target.closest(".pl-rz-bot") ? "end" : "move")}
        title={`${toTime(start)}〜${toTime(start + dur)} ${s.text}（${it.pjName} ／ ${it.taskName}）`}>
        <div className="pl-rz-top" />
        {dur <= 30 ? (
          // 短い予定は1行に「時刻 名前」
          <div className="pl-block-n"><span className="pl-block-t">{toTime(start)} </span>{s.text}</div>
        ) : (
          <>
            <div className="pl-block-t">{toTime(start)}〜{toTime(start + dur)}</div>
            <div className="pl-block-n">{s.text}</div>
          </>
        )}
        {dur >= 45 && <div className="pl-block-p">{it.pjName}</div>}
        <div className="pl-rz-bot" />
      </div>
    );
  };

  // Outlook の予定(動かせない・押しても何もしない)。表示範囲(7:00〜20:00)の外にかかる分は端に寄せて切る
  const olBlock = (ev, start, end, style) => {
    const s0 = clamp(start, H0 * 60, H1 * 60 - 15);
    const e0 = clamp(end, s0 + 15, H1 * 60);
    const dur = e0 - s0;
    const time = `${ev.start}〜${ev.end}`;
    return (
      <div key={ev.id} className={`pl-block ol${PERSON_COLORS[ev.who] ? " person" : ""}`} style={{ top: ((s0 - H0 * 60) / 60) * HH, height: Math.max(14, (dur / 60) * HH), "--pc": PERSON_COLORS[ev.who] || undefined, ...style }}
        title={`Outlook ${time} ${ev.title}${ev.location ? `（${ev.location}）` : ""}`}>
        {dur <= 30 ? (
          <div className="pl-block-n"><span className="pl-block-t">{ev.start} </span>{ev.title}</div>
        ) : (
          <>
            <div className="pl-block-t">{time}</div>
            <div className="pl-block-n">{ev.title}</div>
          </>
        )}
        {dur >= 45 && ev.location && <div className="pl-block-p">{ev.location}</div>}
      </div>
    );
  };

  const section = (key, title, list, opts = {}) => {
    const groups = [];
    const idx = {};
    list.forEach((it) => {
      const k = it.pjId + "/" + it.taskId;
      if (!(k in idx)) { idx[k] = groups.length; groups.push({ k, pjName: it.pjName, taskName: it.taskName, items: [] }); }
      groups[idx[k]].items.push(it);
    });
    return (
      <section className="pl-sec" key={key}>
        <button type="button" className="pl-sec-h" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} aria-expanded={!!open[key]}>
          <span>{open[key] ? "▾" : "▸"}</span>
          <span className={`pl-sec-t${opts.warn ? " warn" : ""}`}>{title}</span>
          <span className="pl-count">{list.length}</span>
          <span className="pl-sec-hint">カレンダーへドラッグで時間を決める</span>
        </button>
        {open[key] && (
          list.length === 0 ? <p className="pl-empty">ありません</p> : (
            <div className="pl-groups">
              {groups.map((g) => (
                <div key={g.k} className="pl-group">
                  <div className="pl-group-h">{g.pjName} <span>／ {g.taskName}</span></div>
                  <ul>
                    {g.items.map((it) => (
                      <li key={it.sub.id} className={`pl-row${drag?.id === it.sub.id ? " dragging" : ""}`} style={{ "--oc": ownerColorOf(it.owner) }}
                        onPointerDown={(e) => { if (e.target.closest(".pl-check")) return; startDrag(e, it, "new"); }}>
                        <button type="button" className="pl-check" onClick={() => onToggleDone(it.pjId, it.taskId, it.sub.id)} aria-label="完了にする" />
                        <span className="pl-handle" aria-hidden="true">⠿</span>
                        <span className="pl-row-t">{it.sub.text}</span>
                        {opts.showDate && it.sub.scheduledDate && <span className="pl-tag warn">{md(it.sub.scheduledDate)}</span>}
                        {it.sub.startTime && <span className="pl-tag">{it.sub.startTime}</span>}
                        <span className="pl-tag">{it.sub.estimatedMinutes ? `${it.sub.estimatedMinutes}分` : "想定なし"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )
        )}
      </section>
    );
  };

  return (
    <div className="pl">
      <div className="pl-tools">
        <button type="button" onClick={() => setAnchor((a) => addDays(a, -step))} aria-label={mode === "day" ? "前の日" : "前の週"}>◀</button>
        <button type="button" onClick={() => setAnchor(todayStr)}>{mode === "day" ? "今日" : "今週"}</button>
        <button type="button" onClick={() => setAnchor((a) => addDays(a, step))} aria-label={mode === "day" ? "次の日" : "次の週"}>▶</button>
        <span className="pl-label">{label}</span>
        <span className="pl-sp" />
        {outlook && (
          <button type="button" className={`pl-ol-toggle${showOl ? " on" : ""}${outlook.status !== "ok" ? " warn" : ""}`} onClick={() => setShowOl((v) => !v)}
            aria-pressed={showOl} title={OUTLOOK_STATUS[outlook.status] || (showOl ? "Outlookの予定を隠す" : "Outlookの予定を表示")}>
            Outlook{outlook.status !== "ok" ? " ⚠" : ""}
          </button>
        )}
        {assignees && (
          <div className="pl-seg pl-who" role="group" aria-label="担当で絞り込み">
            <button type="button" className={!whoActive ? "on" : ""} onClick={() => setWho("")}>全員</button>
            {[...assignees, ...(whoActive && whoActive !== NO_ASSIGNEE && !assignees.includes(whoActive) ? [whoActive] : [])].map((n) => (
              <button type="button" key={n} className={whoActive === n ? "on" : ""} onClick={() => setWho(n)}>{n}</button>
            ))}
            <button type="button" className={whoActive === NO_ASSIGNEE ? "on" : ""} onClick={() => setWho(NO_ASSIGNEE)}>担当なし</button>
          </div>
        )}
        <div className="pl-seg" role="group" aria-label="表示する日">
          <button type="button" className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>1日</button>
          <button type="button" className={mode === "weekday" ? "on" : ""} onClick={() => setMode("weekday")}>平日</button>
          <button type="button" className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>7日</button>
        </div>
      </div>

      <div className="pl-grid" style={{ "--n": dates.length }}>
        <div className="pl-head">
          <div className="pl-corner" />
          {dates.map((d) => {
            const dt = new Date(d + "T00:00:00");
            const untimed = (byDate[d] || []).filter((it) => !it.sub.startTime);
            const chipsOpen = chipOpen.has(d);
            const shown = chipsOpen ? untimed : untimed.slice(0, CHIP_MAX);
            return (
              <div key={d} className={`pl-dayh${d === todayStr ? " today" : ""}${dt.getDay() === 0 ? " sun" : dt.getDay() === 6 ? " sat" : ""}`}>
                <div className="pl-dayh-d">{md(d)}<small>({WD[dt.getDay()]})</small></div>
                {(olByDate[d] || []).filter((ev) => !ev.start).map((ev) => (
                  <div key={ev.id} className={`pl-chip ol${PERSON_COLORS[ev.who] ? " person" : ""}`} style={{ "--pc": PERSON_COLORS[ev.who] || undefined }} title={`Outlook（終日） ${ev.title}${ev.location ? `（${ev.location}）` : ""}`}>{ev.title}</div>
                ))}
                {shown.map((it) => (
                  <div key={it.sub.id} className={`pl-chip${it.sub.done ? " done" : ""}${it.pc ? " person" : ""}${drag?.id === it.sub.id ? " dragging" : ""}`} style={{ "--oc": ownerColorOf(it.owner), "--pc": it.pc || undefined }}
                    onPointerDown={(e) => startDrag(e, it, "move")} title={`${it.sub.text}（時刻なし。下へドラッグで時間を決める）`}>
                    {it.sub.text}
                  </div>
                ))}
                {untimed.length > CHIP_MAX && (
                  <button type="button" className="pl-more" onClick={() => setChipOpen((prev) => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; })}>
                    {chipsOpen ? "▲閉じる" : `▼他${untimed.length - CHIP_MAX}件`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="pl-body" ref={bodyRef} style={{ height: gridH }}>
          <div className="pl-times">
            {hours.map((h) => <div key={h} style={{ height: HH }}>{h}:00</div>)}
          </div>
          {dates.map((d) => {
            const timed = layout([
              ...(byDate[d] || []).filter((it) => it.sub.startTime).map((it) => {
                const start = toMin(it.sub.startTime);
                return { it, start, end: start + durOf(it.sub) };
              }),
              ...(olByDate[d] || []).filter((ev) => ev.start).map((ev) => {
                const start = toMin(ev.start);
                return { ev, start, end: Math.max(start + 15, toMin(ev.end)) };
              }),
            ]);
            return (
              <div key={d} className={`pl-col${d === todayStr ? " today" : ""}`} data-pl-date={d}>
                {hours.map((h) => <div key={h} className="pl-hline" style={{ top: (h - H0) * HH }} />)}
                {hours.map((h) => <div key={`${h}h`} className="pl-hline half" style={{ top: (h - H0 + 0.5) * HH }} />)}
                {d === todayStr && nowMin >= H0 * 60 && nowMin <= H1 * 60 && <div className="pl-now" style={{ top: ((nowMin - H0 * 60) / 60) * HH }} />}
                {timed.map(({ it, ev, start, end, col, cols }) => {
                  const pos = { left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` };
                  if (ev) return olBlock(ev, start, end, pos);
                  const s0 = clamp(start, H0 * 60, H1 * 60 - SNAP); const e0 = clamp(end, s0 + SNAP, H1 * 60);
                  return block(it, s0, e0 - s0, drag?.id === it.sub.id ? "ghost" : "", pos);
                })}
                {drag && drag.date === d && (() => {
                  const it = items.find((x) => x.sub.id === drag.id);
                  return it ? block(it, drag.start, drag.dur, "preview", { left: 2, right: 2 }) : null;
                })()}
              </div>
            );
          })}
        </div>
      </div>

      {section("today", "今日", todayList)}
      {section("none", "日付なし", noneList)}
      {section("overdue", "期限切れ", overdueList, { warn: true, showDate: true })}
      {extra}
    </div>
  );
}
