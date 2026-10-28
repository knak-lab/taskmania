import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import "./RoadmapView.css";

// 俯瞰画面: マップと同じ全量(テーマ → PJ)を行に、月を列にしたマトリクス。
// タスク(開始日〜終了日)を矢羽根として並べて全体像を見る。矢羽根を押すとタスク編集。

const BRANCH = ["#1D7179", "#3A62A8", "#84569A", "#66772A", "#A4513A", "#4D6273"]; // マップの枝色と揃える
const STATUS = {
  upcoming: { label: "予定", color: "#8E99A4" },
  active: { label: "進行中", color: "#12314F" },
  overdue: { label: "遅延", color: "#D64550" },
  done: { label: "完了", color: "#7E9C83" },
};
const SPANS = [3, 6, 12];
const LANE_H = 30; // 1レーンの最低高さ。行がPJ名の折り返しで高くなったら矢羽根も行いっぱいに伸ばす

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}
function addMonths(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function daysInMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function taskStatus(t, todayStr) {
  const subs = t.subtasks || [];
  const done = subs.filter((s) => s.done).length;
  const total = subs.length;
  const pct = total ? Math.round((done / total) * 100) : t.done ? 100 : 0;
  if (t.done || (total > 0 && done === total)) return { st: STATUS.done, pct: 100 };
  if (t.endDate < todayStr) return { st: STATUS.overdue, pct };
  if (t.startDate <= todayStr) return { st: STATUS.active, pct };
  return { st: STATUS.upcoming, pct };
}
function loadSpan() {
  try { const v = Number(localStorage.getItem("tm_roadmap_span")); return SPANS.includes(v) ? v : 6; } catch { return 6; }
}

export default function RoadmapView({ projects, themes, onOpenPJ, onOpenTask, onMovePJ, onMoveTheme }) {
  const todayStr = toDateStr(new Date());
  const todayMonth = monthKey(todayStr);
  const [span, setSpan] = useState(loadSpan);
  const [wrapW, setWrapW] = useState(0);
  const [isFull, setIsFull] = useState(false);
  const [hover, setHover] = useState(null); // PJ名にマウスを乗せたときのネクストアクション表示 { p, x, y }
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  // PJ(同じテーマ内だけ)・テーマのドラッグ並び替え。⋮⋮をつまんで動かす。マウス・タッチ共通でpointerイベントを使う。
  // 並びはマップと共通(themes/projects配列の順)
  const [drag, setDrag] = useState(null); // { kind: "pj"|"theme", id, groupId, overId, after }
  const dragRef = useRef(null);

  function onGripDown(e, id, groupId, kind = "pj") {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind, id, groupId, overId: null, after: false };
    setDrag(dragRef.current);
    setHover(null);
  }
  function onGripMove(e) {
    const d = dragRef.current;
    if (!d) return;
    // 一覧の上下端に近づいたら自動スクロール
    const sc = scrollRef.current;
    if (sc) {
      const r = sc.getBoundingClientRect();
      if (e.clientY < r.top + 40) sc.scrollTop -= 12;
      else if (e.clientY > r.bottom - 30) sc.scrollTop += 12;
    }
    const rows = d.kind === "theme"
      ? [...rootRef.current.querySelectorAll(".rm-group[data-theme]")]
      : [...rootRef.current.querySelectorAll(".rm-row")].filter((el) => el.dataset.group === d.groupId);
    let overId = null;
    let after = false;
    for (const el of rows) {
      const rc = el.getBoundingClientRect();
      overId = d.kind === "theme" ? el.dataset.theme : el.dataset.pj;
      if (e.clientY < rc.top + rc.height / 2) { after = false; break; }
      after = true;
    }
    if (overId === d.overId && after === d.after) return;
    dragRef.current = { ...d, overId, after };
    setDrag(dragRef.current);
  }
  function onGripUp() {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d?.overId || d.overId === d.id) return;
    if (d.kind === "theme") onMoveTheme(d.id, d.overId, d.after);
    else onMovePJ(d.id, d.overId, d.after);
  }

  useEffect(() => { try { localStorage.setItem("tm_roadmap_span", String(span)); } catch { /* ignore */ } }, [span]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setIsFull(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // テーマ順 → テーマなし の順にPJを並べ、各PJの矢羽根を重ならないレーンに振り分ける
  const { groups, months } = useMemo(() => {
    const themeIds = new Set(themes.map((t) => t.id));
    const rawGroups = [
      ...themes.map((t, i) => ({ id: t.id, name: t.name, color: BRANCH[i % BRANCH.length], pjs: projects.filter((p) => p.themeId === t.id) })),
      { id: "__none", name: themes.length ? "テーマなし" : null, color: "#66727F", pjs: projects.filter((p) => !themeIds.has(p.themeId)) },
    ].filter((g) => g.pjs.length > 0);

    let minM = addMonths(todayMonth, -1);
    let maxM = addMonths(todayMonth, 11);
    const groups = rawGroups.map((g) => ({
      ...g,
      rows: g.pjs.map((p) => {
        const dated = [];
        let undated = 0;
        for (const t of p.tasks || []) {
          if (t.startDate && t.endDate) dated.push(t);
          else undated++;
        }
        dated.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
        const laneEnds = [];
        const bars = dated.map((t) => {
          let lane = laneEnds.findIndex((end) => end < t.startDate);
          if (lane === -1) { lane = laneEnds.length; laneEnds.push(t.endDate); } else laneEnds[lane] = t.endDate;
          if (monthKey(t.startDate) < minM) minM = monthKey(t.startDate);
          if (monthKey(t.endDate) > maxM) maxM = monthKey(t.endDate);
          return { t, lane, ...taskStatus(t, todayStr) };
        });
        const subs = (p.tasks || []).flatMap((t) => t.subtasks || []);
        const pct = subs.length ? Math.round((subs.filter((s) => s.done).length / subs.length) * 100) : null;
        return { p, bars, lanes: Math.max(1, laneEnds.length), undated, pct };
      }),
    }));
    const months = [];
    for (let m = minM; m <= maxM; m = addMonths(m, 1)) months.push(m);
    return { groups, months };
  }, [projects, themes, todayStr, todayMonth]);

  const labelW = wrapW && wrapW < 560 ? 120 : 200;
  const colW = Math.max(36, Math.floor((wrapW - labelW) / span) || 80);
  const trackW = months.length * colW;
  const xOf = (dateStr, endOfDay) => {
    const i = months.indexOf(monthKey(dateStr));
    const day = Number(dateStr.slice(8, 10)) - (endOfDay ? 0 : 1);
    return i * colW + (day / daysInMonth(monthKey(dateStr))) * colW;
  };
  const todayX = xOf(todayStr, false) + colW / daysInMonth(todayMonth) / 2;
  // 週の区切り(月曜)。月初と重なる週は月の線があるので省く。12ヶ月表示は詰まりすぎるので出さない
  const weekXs = [];
  if (span < 12) months.forEach((m, i) => {
    const [y, mm] = m.split("-").map(Number);
    for (let d = 2; d <= daysInMonth(m); d++) {
      if (new Date(y, mm - 1, d).getDay() === 1) weekXs.push(i * colW + ((d - 1) / daysInMonth(m)) * colW);
    }
  });

  function scrollToToday(smooth) {
    const el = scrollRef.current;
    if (!el) return;
    const left = Math.max(0, (months.indexOf(todayMonth) - 1) * colW);
    el.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  }
  // 表示幅が変わったら今月(の1つ前)が左端に来るよう合わせ直す
  useEffect(() => { scrollToToday(false); }, [colW]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleFull() {
    const el = rootRef.current;
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return; }
    if (!el.requestFullscreen) return;
    await el.requestFullscreen().catch(() => {});
    // Androidなどは全画面中だけ横向きに固定できる(iPhoneは非対応なので端末を横にしてもらう)
    await screen.orientation?.lock?.("landscape").catch(() => {});
  }

  const canFull = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
  const totalPJ = groups.reduce((a, g) => a + g.rows.length, 0);

  return (
    <div className={`rm${isFull ? " rm-full" : ""}`} ref={rootRef}>
      <div className="rm-tools">
        <div className="rm-seg" role="group" aria-label="表示する月数">
          {SPANS.map((n) => (
            <button key={n} type="button" className={span === n ? "on" : ""} onClick={() => setSpan(n)}>{n}ヶ月</button>
          ))}
        </div>
        <button type="button" onClick={() => scrollToToday(true)}>今月へ</button>
        {canFull && <button type="button" onClick={toggleFull}>{isFull ? "全画面を閉じる" : "⤢ 全画面"}</button>}
        <span className="rm-sp" />
        <span className="rm-legend">
          {Object.values(STATUS).map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}
        </span>
      </div>
      <p className="rm-rotate">スマホは横向きにすると見やすい</p>

      {totalPJ === 0 ? (
        <p className="rm-empty">表示するPJがない。マップでテーマ・PJ・タスクを作ると、ここに並ぶ。</p>
      ) : (
        <div className="rm-scroll" ref={scrollRef}>
          <div className="rm-inner" style={{ width: labelW + trackW, "--lw": `${labelW}px`, "--cw": `${colW}px` }}>
            <div className="rm-weeks" style={{ left: labelW, width: trackW }}>
              {weekXs.map((x) => <i key={x} style={{ left: x }} />)}
            </div>
            <div className="rm-head">
              <div className="rm-corner">PJ</div>
              {months.map((m, i) => {
                const [y, mm] = m.split("-");
                const showYear = i === 0 || mm === "01";
                return (
                  <div key={m} className={`rm-month${m === todayMonth ? " now" : ""}`} style={{ width: colW }}>
                    {showYear && <small>{y}</small>}{Number(mm)}月
                  </div>
                );
              })}
            </div>

            {groups.map((g) => (
              <div key={g.id} style={{ "--bc": g.color }} data-theme={g.id === "__none" ? undefined : g.id}
                className={`rm-group${drag?.kind === "theme" && drag.id === g.id ? " dragging" : ""}${drag?.kind === "theme" && drag.overId === g.id && drag.overId !== drag.id ? (drag.after ? " drop-after" : " drop-before") : ""}`}>
                {g.name && (
                  <div className="rm-theme">
                    <div className="rm-theme-label">
                      {g.id !== "__none" && groups.filter((x) => x.id !== "__none").length > 1 && (
                        <span className="rm-grip" title="ドラッグでテーマを並び替え" aria-label="ドラッグでテーマを並び替え"
                          onPointerDown={(e) => onGripDown(e, g.id, null, "theme")} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}>⋮⋮</span>
                      )}
                      {g.name}
                    </div>
                    <div className="rm-theme-track" style={{ width: trackW }} />
                  </div>
                )}
                {g.rows.map(({ p, bars, lanes, undated, pct }) => (
                  <div key={p.id} data-pj={p.id} data-group={g.id}
                    className={`rm-row${drag?.kind === "pj" && drag.id === p.id ? " dragging" : ""}${drag?.kind === "pj" && drag.overId === p.id && drag.overId !== drag.id ? (drag.after ? " drop-after" : " drop-before") : ""}`}>
                    <button type="button" className="rm-pj" onClick={(e) => { if (e.target.closest(".rm-grip")) return; setHover(null); onOpenPJ(p.id); }}
                      onMouseEnter={(e) => { if (dragRef.current) return; const r = e.currentTarget.getBoundingClientRect(); setHover({ p, x: r.right + 6, y: r.top }); }}
                      onMouseLeave={() => setHover(null)}>
                      {g.rows.length > 1 && (
                        <span className="rm-grip" title="ドラッグで並び替え" aria-label="ドラッグで並び替え"
                          onPointerDown={(e) => onGripDown(e, p.id, g.id)} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}>⋮⋮</span>
                      )}
                      <span className="rm-pj-name">{p.goalTarget && "☆"}{p.name}</span>
                      <span className="rm-pj-meta">
                        {pct !== null && <span>{pct}%</span>}
                        {undated > 0 && <span className="rm-undated">期間未設定{undated}</span>}
                        {bars.length === 0 && undated === 0 && <span>タスクなし</span>}
                      </span>
                    </button>
                    <div className="rm-track" style={{ width: trackW, minHeight: lanes * LANE_H + 8 }}>
                      <div className="rm-today" style={{ left: todayX }} />
                      {bars.map(({ t, lane, st, pct: tp }) => {
                        const left = xOf(t.startDate, false);
                        const w = Math.max(22, xOf(t.endDate, true) - left);
                        return (
                          <button key={t.id} type="button" className="rm-arrow"
                            style={{ left, width: w, top: `calc(4px + (100% - 8px) * ${lane / lanes})`, height: `calc((100% - 8px) / ${lanes} - ${lanes > 1 ? 3 : 0}px)`, "--sc": st.color, "--pct": `${tp}%` }}
                            onClick={() => onOpenTask(p.id, t.id)}
                            title={`${t.name}　${t.startDate.slice(5).replace("-", "/")}〜${t.endDate.slice(5).replace("-", "/")}　${st.label} ${tp}%`}>
                            <span>{t.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {hover && (
        <div className="rm-pop" style={{ left: Math.min(hover.x, window.innerWidth - 300), top: Math.min(hover.y, window.innerHeight - 160) }}>
          <div className="rm-pop-title">ネクストアクション</div>
          {hover.p.nextAction?.trim()
            ? <div className="rm-pop-body">{hover.p.nextAction}</div>
            : <div className="rm-pop-empty">未入力(PJ名を押すと入力できる)</div>}
        </div>
      )}
    </div>
  );
}
