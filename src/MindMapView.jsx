import { useState, useEffect, useMemo, useRef } from "react";
import "./MindMapView.css";

// マップ画面: 根(表示中のタブ) → テーマ → PJ → タスク → サブタスク をマインドマップで表示・作成する。
// テーマはPJの上の見出しで、PJ側の themeId で所属を持つ。保留・完了PJは出さない(俯瞰と同じ)。

const W = { root: 180, theme: 170, pj: 250, task: 200, sub: 230 };
const H = { root: 44, theme: 36, pj: 60, task: 34, sub: 28 };
const HG = 44;
const VG = 8;
const BRANCH = ["#1D7179", "#3A62A8", "#84569A", "#66772A", "#A4513A", "#4D6273"];
const CHILD_TYPE = { root: "theme", theme: "pj", pj: "task", task: "sub" };
const ACCEPTS = { root: ["pj"], theme: ["pj"], pj: ["task"], task: ["sub"] };

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function subsOf(n) {
  return n.type === "sub" ? [n] : n.children.flatMap(subsOf);
}
function progressOf(n, todayStr) {
  const s = subsOf(n);
  return { done: s.filter((x) => x.done).length, total: s.length, late: s.some((x) => !x.done && x.date && x.date < todayStr) };
}
function stateOf(p) {
  if (!p.total) return { k: "idle", t: "中身なし" };
  if (p.done === p.total) return { k: "ok", t: "完了" };
  if (p.late) return { k: "warn", t: "持ち越し" };
  if (p.done) return { k: "run", t: "進行中" };
  return { k: "idle", t: "未着手" };
}

// ---- 点検(求められていること/足しすぎ/リソース/できた・できていない) ----
const DAY = 864e5;
const CAP_DAYS = 20; // 今後4週間の平日
const CAP_MIN_PER_DAY = 8 * 60;
function isRepeat(r) {
  return r !== null && r !== undefined && r !== "";
}
function timesPerWeek(r) {
  if (!isRepeat(r)) return 0;
  if (r === "weekday" || r === "daily") return 5;
  if (r === "satsun") return 0;
  return 1;
}
function checkup(pjs, todayStr) {
  const now = Date.now();
  const horizon = toDateStr(new Date(now + 28 * DAY));
  const rows = pjs.flatMap((p) => (p.tasks || []).flatMap((t) => (t.subtasks || []).map((s) => ({ p, t, s }))));
  const open = rows.filter((r) => !r.s.done);
  const oneOff = open.filter((r) => !isRepeat(r.s.repeatWeekday));
  const recurring = open.filter((r) => isRepeat(r.s.repeatWeekday));
  const inWindow = oneOff.filter((r) => !r.s.scheduledDate || r.s.scheduledDate <= horizon);
  const oneOffMin = inWindow.reduce((a, r) => a + (r.s.estimatedMinutes || 0), 0);
  const recurMin = recurring.reduce((a, r) => a + (r.s.estimatedMinutes || 0) * timesPerWeek(r.s.repeatWeekday) * 4, 0);
  const capacity = CAP_DAYS * CAP_MIN_PER_DAY;
  const load = oneOffMin + recurMin;
  const recent = (ts) => ts && ts > now - 14 * DAY;
  const hasPurpose = (p) => !!(p.purpose || "").trim();
  const stale = pjs.filter((p) => {
    const ss = (p.tasks || []).flatMap((t) => t.subtasks || []);
    return ss.some((x) => !x.done) && !ss.some((x) => recent(x.createdAt) || recent(x.doneUpdatedAt));
  });
  return {
    capacity, oneOffMin, recurMin, ratio: load / capacity, openCount: open.length,
    noEst: inWindow.filter((r) => !r.s.estimatedMinutes),
    added: rows.filter((r) => recent(r.s.createdAt)),
    done: rows.filter((r) => r.s.done && recent(r.s.doneUpdatedAt)).sort((a, b) => b.s.doneUpdatedAt - a.s.doneUpdatedAt),
    noPurpose: pjs.filter((p) => !hasPurpose(p)),
    holdCands: oneOff.filter((r) => recent(r.s.createdAt) && (!hasPurpose(r.p) || (!r.s.estimatedMinutes && !r.s.scheduledDate))),
    late: open.filter((r) => r.s.scheduledDate && r.s.scheduledDate < todayStr),
    stale,
    letGo: oneOff
      .filter((r) => (r.p.priority || 2) >= 3 || !hasPurpose(r.p))
      .sort((a, b) => (b.p.priority || 2) - (a.p.priority || 2) || (b.s.estimatedMinutes || 0) - (a.s.estimatedMinutes || 0)),
  };
}
const hours = (m) => `${Math.round((m / 60) * 10) / 10}h`;

function buildTree(rootLabel, themes, projects) {
  const pjNode = (p) => ({
    id: p.id, type: "pj", text: p.name, pj: p,
    children: (p.tasks || []).map((t) => ({
      id: t.id, type: "task", text: t.name, pjId: p.id, task: t,
      children: (t.subtasks || []).map((s) => ({ id: s.id, type: "sub", text: s.text, done: !!s.done, date: s.scheduledDate, pjId: p.id, taskId: t.id, children: [] })),
    })),
  });
  const themeIds = new Set(themes.map((t) => t.id));
  return {
    id: "__root", type: "root", text: rootLabel,
    children: [
      ...themes.map((t) => ({ id: t.id, type: "theme", text: t.name, theme: t, children: projects.filter((p) => p.themeId === t.id).map(pjNode) })),
      ...projects.filter((p) => !themeIds.has(p.themeId)).map(pjNode),
    ],
  };
}

function loadOpen() {
  try { return JSON.parse(localStorage.getItem("tm_map_open") || "{}"); } catch { return {}; }
}

export default function MindMapView({ rootLabel, projects, themes, allProjects, allThemes, scope, setProjects, setThemes, onOpenPJ, onToggleSub }) {
  const todayStr = toDateStr(new Date());
  const [open, setOpen] = useState(loadOpen);
  const [sel, setSel] = useState(null);
  const [editing, setEditing] = useState(null); // 既存ノードの名前変更中のid
  const [draft, setDraft] = useState(null); // 新規作成中 {parentId, type, afterId}
  const [zoom, setZoom] = useState(1);
  const [dropId, setDropId] = useState(null);
  const [toast, setToast] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const toastTimer = useRef(null);
  // Enter確定後の入力欄のblurで二重に確定しないよう、確定済みの下書きを覚えておく
  const draftRef = useRef(null);
  const editingRef = useRef(null);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { editingRef.current = editing; }, [editing]);

  useEffect(() => { try { localStorage.setItem("tm_map_open", JSON.stringify(open)); } catch { /* ignore */ } }, [open]);

  const tree = useMemo(() => buildTree(rootLabel, themes, projects), [rootLabel, themes, projects]);

  // id → {n, parent, branch}
  const index = useMemo(() => {
    const m = new Map();
    const walk = (n, parent, branch) => {
      m.set(n.id, { n, parent, branch });
      n.children.forEach((c, i) => walk(c, n, n.type === "root" ? i % BRANCH.length : branch));
    };
    walk(tree, null, 0);
    return m;
  }, [tree]);

  const isOpen = (n) => (n.id in open ? open[n.id] : n.type === "root" || n.type === "theme");

  // ---- レイアウト(左→右の木。葉を縦に積み、親は子の中央) ----
  const { boxes, links, width, height } = useMemo(() => {
    const out = [];
    const ls = [];
    let cy = 20;
    const place = (n, x, depth) => {
      const w = W[n.type];
      const h = H[n.type];
      const kids = isOpen(n) ? [...n.children] : [];
      const draftHere = draft && draft.parentId === n.id;
      let y;
      const childBoxes = [];
      if (kids.length || draftHere) {
        const items = kids.map((c) => ({ c }));
        if (draftHere) {
          const at = draft.afterId ? items.findIndex((it) => it.c.id === draft.afterId) + 1 : items.length;
          items.splice(at, 0, { draft: true });
        }
        items.forEach((it) => {
          if (it.draft) {
            const dw = W[draft.type], dh = H[draft.type];
            const b = { draft: true, type: draft.type, x: x + w + HG, y: cy, w: dw, h: dh, branch: n.type === "root" ? kids.length % BRANCH.length : index.get(n.id)?.branch ?? 0 };
            cy += dh + VG;
            out.push(b);
            childBoxes.push(b);
          } else {
            childBoxes.push(place(it.c, x + w + HG, depth + 1));
          }
        });
        y = (childBoxes[0].y + childBoxes[childBoxes.length - 1].y + childBoxes[childBoxes.length - 1].h) / 2 - h / 2;
        if (depth === 1) cy += 14;
      } else {
        y = cy;
        cy += h + VG;
      }
      const box = { n, x, y, w, h, branch: index.get(n.id)?.branch ?? 0 };
      childBoxes.forEach((k) => ls.push({ from: box, to: k }));
      out.push(box);
      return box;
    };
    place(tree, 20, 0);
    const minY = Math.min(...out.map((b) => b.y));
    if (minY < 20) out.forEach((b) => { b.y += 20 - minY; });
    return {
      boxes: out,
      links: ls,
      width: Math.max(...out.map((b) => b.x + b.w)) + 40,
      height: Math.max(...out.map((b) => b.y + b.h)) + 40,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, open, draft, index]);

  function flash(msg, canUndo) {
    setToast({ msg, canUndo });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }
  function snapshot() {
    setUndoStack((s) => [...s.slice(-19), { projects: allProjects, themes: allThemes }]);
  }
  function undo() {
    if (!undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    setProjects(last.projects);
    setThemes(last.themes);
    setUndoStack(undoStack.slice(0, -1));
    setToast(null);
  }
  function focusMap() {
    if (wrapRef.current && document.activeElement !== wrapRef.current) wrapRef.current.focus({ preventScroll: true });
  }

  // ---- 変更系 ----
  const mapPJ = (pjId, f) => setProjects((prev) => prev.map((p) => (p.id === pjId ? f(p) : p)));
  const mapTask = (pjId, taskId, f) => mapPJ(pjId, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === taskId ? f(t) : t)) }));

  function createNode(parent, type, text) {
    const id = uid();
    if (type === "theme") {
      setThemes((prev) => [...prev, { id, owner: scope.owner, subcategory: scope.subcategory, name: text }]);
    } else if (type === "pj") {
      const th = parent.type === "theme" ? parent.theme : null;
      setProjects((prev) => [...prev, {
        id, owner: th ? th.owner : scope.owner, name: text, tasks: [], subcategory: th ? th.subcategory : scope.subcategory,
        priority: 2, status: null, completedNote: "", nextAction: "", moyamoya: false, themeId: th ? th.id : null,
      }]);
    } else if (type === "task") {
      mapPJ(parent.id, (p) => ({ ...p, tasks: [...p.tasks, { id, name: text, subtasks: [], startDate: null, endDate: null, estimatedMinutes: null, done: false }] }));
    } else if (type === "sub") {
      mapTask(parent.pjId, parent.id, (t) => ({ ...t, subtasks: [...t.subtasks, {
        id, text, done: false, priority: 2, scheduledDate: null, startTime: null, estimatedMinutes: null, actualMinutes: null, createdAt: Date.now(), steps: [], skipCount: 0,
      }] }));
    }
    return id;
  }
  function renameNode(n, text) {
    if (n.type === "theme") setThemes((prev) => prev.map((t) => (t.id === n.id ? { ...t, name: text } : t)));
    else if (n.type === "pj") mapPJ(n.id, (p) => ({ ...p, name: text }));
    else if (n.type === "task") mapTask(n.pjId, n.id, (t) => ({ ...t, name: text }));
    else if (n.type === "sub") mapTask(n.pjId, n.taskId, (t) => ({ ...t, subtasks: t.subtasks.map((s) => (s.id === n.id ? { ...s, text } : s)) }));
  }

  function startAddChild() {
    const info = sel && index.get(sel);
    if (!info) return;
    const type = CHILD_TYPE[info.n.type];
    if (!type) { flash("サブタスクの下には足せません"); return; }
    setOpen((o) => ({ ...o, [info.n.id]: true }));
    setDraft({ parentId: info.n.id, type, afterId: null, token: uid() });
  }
  function startAddSibling() {
    const info = sel && index.get(sel);
    if (!info) return;
    if (!info.parent) { startAddChild(); return; }
    setDraft({ parentId: info.parent.id, type: info.n.type, afterId: info.n.id, token: uid() });
  }
  function commitDraft(token, text, thenAddChild) {
    const d = draftRef.current;
    if (!d || d.token !== token) return;
    draftRef.current = null;
    setDraft(null);
    const t = text.trim();
    if (!d || !t) { focusMap(); return; }
    const parent = index.get(d.parentId)?.n;
    if (!parent) return;
    const id = createNode(parent, d.type, t);
    setSel(id);
    if (thenAddChild && CHILD_TYPE[d.type]) {
      setOpen((o) => ({ ...o, [id]: true }));
      setDraft({ parentId: id, type: CHILD_TYPE[d.type], afterId: null, token: uid() });
    } else {
      focusMap();
    }
  }
  function commitRename(n, text) {
    if (editingRef.current !== n.id) return;
    editingRef.current = null;
    setEditing(null);
    const t = text.trim();
    if (t && t !== n.text) renameNode(n, t);
    focusMap();
  }
  function remove() {
    const info = sel && index.get(sel);
    if (!info || !info.parent) return;
    const n = info.n;
    if ((n.type === "pj" || n.type === "task") && n.children.length) {
      flash("中身があるので、PJ詳細から削除してください");
      return;
    }
    snapshot();
    if (n.type === "theme") {
      setThemes((prev) => prev.filter((t) => t.id !== n.id));
      setProjects((prev) => prev.map((p) => (p.themeId === n.id ? { ...p, themeId: null } : p)));
    } else if (n.type === "pj") {
      setProjects((prev) => prev.filter((p) => p.id !== n.id));
    } else if (n.type === "task") {
      mapPJ(n.pjId, (p) => ({ ...p, tasks: p.tasks.filter((t) => t.id !== n.id) }));
    } else if (n.type === "sub") {
      mapTask(n.pjId, n.taskId, (t) => ({ ...t, subtasks: t.subtasks.filter((s) => s.id !== n.id) }));
    }
    const sibs = info.parent.children;
    const i = sibs.indexOf(n);
    setSel((sibs[i + 1] || sibs[i - 1] || info.parent).id);
    flash(n.type === "theme" ? `テーマ「${n.text}」を削除しました（中のPJは残っています）` : `「${n.text}」を削除しました`, true);
  }
  function canDrop(drag, target) {
    return drag && target && drag.id !== target.id && (ACCEPTS[target.type] || []).includes(drag.type);
  }
  function drop(drag, target) {
    snapshot();
    if (drag.type === "pj") {
      setProjects((prev) => prev.map((p) => (p.id === drag.id ? { ...p, themeId: target.type === "theme" ? target.id : null } : p)));
    } else if (drag.type === "task") {
      if (drag.pjId === target.id) return;
      setProjects((prev) => {
        const t = prev.find((p) => p.id === drag.pjId)?.tasks.find((x) => x.id === drag.id);
        if (!t) return prev;
        return prev.map((p) => (p.id === drag.pjId ? { ...p, tasks: p.tasks.filter((x) => x.id !== drag.id) } : p.id === target.id ? { ...p, tasks: [...p.tasks, t] } : p));
      });
    } else if (drag.type === "sub") {
      if (drag.taskId === target.id) return;
      setProjects((prev) => {
        const s = prev.find((p) => p.id === drag.pjId)?.tasks.find((t) => t.id === drag.taskId)?.subtasks.find((x) => x.id === drag.id);
        if (!s) return prev;
        const removed = prev.map((p) => (p.id !== drag.pjId ? p : { ...p, tasks: p.tasks.map((t) => (t.id === drag.taskId ? { ...t, subtasks: t.subtasks.filter((x) => x.id !== drag.id) } : t)) }));
        return removed.map((p) => (p.id !== target.pjId ? p : { ...p, tasks: p.tasks.map((t) => (t.id === target.id ? { ...t, subtasks: [...t.subtasks, s] } : t)) }));
      });
    }
    setOpen((o) => ({ ...o, [target.id]: true }));
    flash(`「${drag.text}」を「${target.text}」の下へ移しました`, true);
  }
  function setAll(n, value) {
    const next = {};
    const walk = (x) => { if (x.children.length && x.type !== "task") next[x.id] = value; x.children.forEach((c) => c.type !== "sub" && walk(c)); };
    walk(n);
    setOpen((o) => ({ ...o, ...next }));
  }
  function selectAndReveal(id) {
    setSel(id);
    requestAnimationFrame(() => {
      const el = wrapRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  }

  // ---- 入力 ----
  function onNodeClick(e, n) {
    if (e.target.closest(".mm-tog") || e.target.tagName === "INPUT") return;
    focusMap();
    if (n.type === "sub" && sel === n.id) { onToggleSub(n.pjId, n.taskId, n.id); return; }
    setSel(n.id);
  }
  function onKeyDown(e) {
    if (editing || draft || e.target !== wrapRef.current) return;
    const info = sel && index.get(sel);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
    if (!info) return;
    const n = info.n;
    const k = e.key;
    if (k === "Tab") { e.preventDefault(); startAddChild(); }
    else if (k === "Enter") { e.preventDefault(); if (n.type === "pj" && e.shiftKey) onOpenPJ(n.id); else startAddSibling(); }
    else if (k === "F2") { e.preventDefault(); if (n.type !== "root") setEditing(n.id); }
    else if (k === "Delete" || k === "Backspace") { e.preventDefault(); remove(); }
    else if (k === " ") { e.preventDefault(); if (n.type === "sub") onToggleSub(n.pjId, n.taskId, n.id); else if (n.children.length) setOpen((o) => ({ ...o, [n.id]: !isOpen(n) })); }
    else if (k === "ArrowLeft" && info.parent) { e.preventDefault(); selectAndReveal(info.parent.id); }
    else if (k === "ArrowRight" && n.children.length) { e.preventDefault(); setOpen((o) => ({ ...o, [n.id]: true })); selectAndReveal(n.children[0].id); }
    else if ((k === "ArrowUp" || k === "ArrowDown") && info.parent) {
      e.preventDefault();
      const a = info.parent.children;
      const next = a[a.indexOf(n) + (k === "ArrowUp" ? -1 : 1)];
      if (next) selectAndReveal(next.id);
    } else if (k === "Escape") setSel(null);
  }
  function editKeys(e, onCommit, onCancel, allowTab) {
    e.stopPropagation();
    if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); onCommit(e.currentTarget.value, false); }
    else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    else if (e.key === "Tab" && allowTab) { e.preventDefault(); onCommit(e.currentTarget.value, true); }
  }

  // ---- 描画 ----
  const selInfo = sel && index.get(sel);
  const selNode = selInfo?.n;

  function renderBox(b) {
    const style = { left: b.x, top: b.y, width: b.w, height: b.h, "--bc": BRANCH[b.branch] };
    if (b.draft) {
      return (
        <div key="__draft" className={`mm-node mm-${b.type} mm-sel`} style={style}>
          <input key={draft.token} className="mm-edit" autoFocus placeholder={{ theme: "テーマ名", pj: "PJ名", task: "タスク名", sub: "サブタスク" }[b.type]}
            onKeyDown={(e) => editKeys(e, (v, tab) => commitDraft(draft.token, v, tab), () => { draftRef.current = null; setDraft(null); focusMap(); }, true)}
            onBlur={(e) => commitDraft(draft.token, e.currentTarget.value, false)} aria-label="新しい項目の名前" />
        </div>
      );
    }
    const n = b.n;
    const isSel = sel === n.id;
    const label = editing === n.id
      ? <input className="mm-edit" autoFocus defaultValue={n.text} onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => editKeys(e, (v) => commitRename(n, v), () => { editingRef.current = null; setEditing(null); focusMap(); }, false)}
          onBlur={(e) => commitRename(n, e.currentTarget.value)} aria-label="名前" />
      : <span className="mm-label">{n.text}</span>;
    const tog = n.children.length > 0 && (
      <button type="button" className="mm-tog" onClick={() => setOpen((o) => ({ ...o, [n.id]: !isOpen(n) }))} aria-label={isOpen(n) ? "たたむ" : "開く"}>
        {isOpen(n) ? "−" : `▸ ${n.children.length}`}
      </button>
    );
    const cls = `mm-node mm-${n.type}${isSel ? " mm-sel" : ""}${dropId === n.id ? " mm-drop" : ""}${n.type === "sub" && n.done ? " mm-done" : ""}`;
    const dragProps = n.type === "root" || n.type === "theme" || editing === n.id ? {} : {
      draggable: true,
      onDragStart: (e) => { dragRef.current = n; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", n.id); } catch { /* ignore */ } },
      onDragEnd: () => { dragRef.current = null; setDropId(null); },
    };
    const dropProps = ACCEPTS[n.type] ? {
      onDragOver: (e) => { if (canDrop(dragRef.current, n)) { e.preventDefault(); if (dropId !== n.id) setDropId(n.id); } },
      onDragLeave: () => { if (dropId === n.id) setDropId(null); },
      onDrop: (e) => { e.preventDefault(); const d = dragRef.current; setDropId(null); dragRef.current = null; if (canDrop(d, n)) drop(d, n); },
    } : {};
    let inner;
    if (n.type === "pj") {
      const p = progressOf(n, todayStr);
      const s = stateOf(p);
      inner = (
        <>
          <div className="mm-row"><span className="mm-dot" />{label}{tog}</div>
          <div className="mm-meta">
            <span className={`mm-pill mm-p-${s.k}`}>{s.t}</span>
            <span className="mm-bar"><i style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></span>
            <span className="mm-num">{p.done}/{p.total}</span>
          </div>
        </>
      );
    } else if (n.type === "task") {
      const p = progressOf(n, todayStr);
      inner = <>{label}<span className="mm-num mm-muted">{p.done}/{p.total}</span>{tog}</>;
    } else if (n.type === "sub") {
      inner = <><span className="mm-check">{n.done ? "✓" : ""}</span>{label}</>;
    } else {
      inner = <>{label}{tog}</>;
    }
    return (
      <div key={n.id} data-id={n.id} className={cls} style={style} title={n.text}
        onClick={(e) => onNodeClick(e, n)} onDoubleClick={() => { if (n.type === "pj") onOpenPJ(n.id); else if (n.type !== "root") setEditing(n.id); }}
        {...dragProps} {...dropProps}>
        {inner}
      </div>
    );
  }

  function revealSub(r) {
    const th = index.get(r.p.id)?.parent;
    setOpen((o) => ({ ...o, ...(th ? { [th.id]: true } : {}), [r.p.id]: true, [r.t.id]: true }));
    selectAndReveal(r.s.id);
  }
  function renderCheckup(pjNodes, withThemes) {
    const c = checkup(pjNodes.map((pn) => pn.pj), todayStr);
    const pct = Math.round(c.ratio * 100);
    const lv = c.ratio >= 0.8 ? { k: "warn", t: "余裕なし" } : c.ratio >= 0.6 ? { k: "run", t: "ほどよい" } : { k: "ok", t: "余裕あり" };
    const list = (rs, extra, max = 5) => (
      <ul className="mm-ck-list">
        {rs.slice(0, max).map((r) => (
          <li key={r.s.id}>
            <button type="button" className="mm-link" onClick={() => revealSub(r)}>{r.s.text}</button>
            <span className="mm-muted">{r.p.name}{extra ? `・${extra(r)}` : ""}</span>
          </li>
        ))}
        {rs.length > max && <li className="mm-muted">ほか {rs.length - max}件</li>}
      </ul>
    );
    const pjList = (ps, max = 6) => (
      <ul className="mm-ck-list">
        {ps.slice(0, max).map((p) => <li key={p.id}><button type="button" className="mm-link" onClick={() => onOpenPJ(p.id)}>{p.name}</button></li>)}
        {ps.length > max && <li className="mm-muted">ほか {ps.length - max}件</li>}
      </ul>
    );
    return (
      <div className="mm-ck">
        <section>
          <h5>リソース <span className="mm-muted">今後4週間・平日8時間</span></h5>
          <div className="mm-sum">
            <span className={`mm-pill mm-p-${lv.k}`}>{lv.t}</span>
            <span className="mm-bar mm-cap"><i style={{ width: `${Math.min(100, pct)}%` }} /></span>
            <span className="mm-num">{pct}%</span>
          </div>
          <p className="mm-ck-note">作業 {hours(c.oneOffMin)} ＋ 定例 {hours(c.recurMin)} ／ 労働時間 {hours(c.capacity)}。登録外の会議や突発に備え、8割を超えたら「余裕なし」。</p>
          {c.noEst.length > 0 && <p className="mm-ck-note">見積なし {c.noEst.length}件はこの数字に入っていません。見積を入れると正確になります。</p>}
          {c.ratio >= 0.8 && c.letGo.length > 0 && (
            <>
              <p className="mm-ck-sub">手放す・後ろに回す候補（優先度が低い／目的が空）</p>
              {list(c.letGo, (r) => (r.s.estimatedMinutes ? hours(r.s.estimatedMinutes) : "見積なし"))}
            </>
          )}
        </section>
        <section>
          <h5>求められていること</h5>
          {c.noPurpose.length ? (
            <>
              <p className="mm-ck-note">「依頼元・ねらい」が空のPJが {c.noPurpose.length}件。PJ詳細で書くと、本質かどうか判断できます。</p>
              {pjList(c.noPurpose)}
            </>
          ) : <p className="mm-ck-note">すべてのPJに依頼元・ねらいが入っています。</p>}
        </section>
        <section>
          <h5>足しすぎていないか <span className="mm-muted">直近2週間</span></h5>
          <p className="mm-ck-note">増えた <b className="mm-num">{c.added.length}</b> 件 ／ 終えた <b className="mm-num">{c.done.length}</b> 件</p>
          {c.holdCands.length > 0 && (
            <>
              <p className="mm-ck-sub">保留にしてよいかもしれないもの（目的が空、または見積も期限もない新規）</p>
              {list(c.holdCands)}
            </>
          )}
        </section>
        <section>
          <h5>できたこと・できていないこと</h5>
          {c.done.length ? (<><p className="mm-ck-sub">直近2週間に終えたもの</p>{list(c.done)}</>) : <p className="mm-ck-note">直近2週間に終えたものはまだありません。</p>}
          {c.late.length > 0 && (<><p className="mm-ck-sub">持ち越し（予定日を過ぎた未完了）</p>{list(c.late, (r) => r.s.scheduledDate.slice(5).replace("-", "/"))}</>)}
          {c.stale.length > 0 && (<><p className="mm-ck-sub">2週間動いていないPJ</p>{pjList(c.stale)}</>)}
        </section>
        {withThemes && (
          <section>
            <h5>テーマ別</h5>
            <table className="mm-ck-table"><tbody>
              {tree.children.filter((t) => t.type === "theme").map((t) => {
                const tc = checkup(t.children.map((pn) => pn.pj), todayStr);
                return (
                  <tr key={t.id} onClick={() => selectAndReveal(t.id)}>
                    <td><span className="mm-dot" style={{ "--bc": BRANCH[index.get(t.id)?.branch ?? 0] }} />{t.text}</td>
                    <td className="mm-num">{tc.openCount}件</td>
                    <td className="mm-num">{hours(tc.oneOffMin + tc.recurMin)}</td>
                  </tr>
                );
              })}
            </tbody></table>
          </section>
        )}
      </div>
    );
  }

  function renderPanel() {
    if (!selNode) {
      const all = tree.children.flatMap((c) => (c.type === "pj" ? [c] : c.children));
      return (
        <>
          <h4 className="mm-title">点検：{tree.text}</h4>
          {renderCheckup(all, true)}
          <p className="mm-empty">箱を選ぶとその中身が出ます。PJはダブルクリックで詳細を開きます。</p>
        </>
      );
    }
    const n = selNode;
    const pjRow = (pn) => {
      const p = progressOf(pn, todayStr);
      const s = stateOf(p);
      const bc = BRANCH[index.get(pn.id)?.branch ?? 0];
      return (
        <button type="button" key={pn.id} className="mm-pjrow" style={{ "--bc": bc }} onClick={() => { const par = index.get(pn.id)?.parent; if (par) setOpen((o) => ({ ...o, [par.id]: true })); selectAndReveal(pn.id); }}>
          <span className="mm-pjrow-t"><span className="mm-dot" />{pn.text}<span className={`mm-pill mm-p-${s.k}`}>{s.t}</span></span>
          <span className="mm-sum"><span className="mm-bar"><i style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></span><span className="mm-num">{p.done}/{p.total}</span></span>
          {pn.pj.nextAction && <span className="mm-pjrow-n">次の一歩：{pn.pj.nextAction}</span>}
        </button>
      );
    };
    const subList = (t) => {
      const openSubs = t.children.filter((s) => !s.done);
      const doneCount = t.children.length - openSubs.length;
      return (
        <ul className="mm-subs">
          {openSubs.map((s) => (
            <li key={s.id}>
              <input type="checkbox" checked={false} onChange={() => onToggleSub(s.pjId, s.taskId, s.id)} aria-label="完了にする" />
              <span>{s.text}</span>
              {s.date && <span className={`mm-d${s.date < todayStr ? " mm-late" : ""}`}>{s.date.slice(5).replace("-", "/")}</span>}
            </li>
          ))}
          {!openSubs.length && <li className="mm-empty">未完了なし</li>}
          {doneCount > 0 && <li className="mm-empty">完了 {doneCount}件</li>}
        </ul>
      );
    };
    if (n.type === "pj") {
      const p = progressOf(n, todayStr);
      const s = stateOf(p);
      return (
        <>
          <div className="mm-sum"><span className={`mm-pill mm-p-${s.k}`}>{s.t}</span><span className="mm-bar"><i style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></span><span className="mm-num">{p.done}/{p.total}</span></div>
          <button type="button" className="mm-primary" onClick={() => onOpenPJ(n.id)}>PJ詳細を開く</button>
          {n.pj.nextAction && <div className="mm-field"><b>次の一歩</b><p>{n.pj.nextAction}</p></div>}
          {n.pj.completedNote && <div className="mm-field"><b>現在地</b><p>{n.pj.completedNote}</p></div>}
          {n.children.map((t) => {
            const tp = progressOf(t, todayStr);
            return <div key={t.id} className="mm-tk"><div className="mm-tk-h">{t.text}<span className="mm-num mm-muted">{tp.done}/{tp.total}</span></div>{subList(t)}</div>;
          })}
        </>
      );
    }
    if (n.type === "task") return subList(n);
    if (n.type === "sub") {
      return <label className="mm-sum"><input type="checkbox" checked={n.done} onChange={() => onToggleSub(n.pjId, n.taskId, n.id)} />完了にする{n.date && <span className="mm-muted">（予定 {n.date}）</span>}</label>;
    }
    const pjs = n.type === "theme" ? n.children : n.children.flatMap((c) => (c.type === "pj" ? [c] : c.children));
    const late = pjs.filter((pn) => stateOf(progressOf(pn, todayStr)).k === "warn").length;
    return (
      <>
        {renderCheckup(pjs, n.type === "root")}
        <h5 className="mm-h5">PJ {pjs.length}件{late ? `・持ち越しあり ${late}件` : ""}</h5>
        <div className="mm-pjlist">{pjs.length ? pjs.map(pjRow) : <p className="mm-empty">まだPJがありません。選んでTabで足せます。</p>}</div>
      </>
    );
  }

  const crumb = (() => {
    if (!selInfo) return "";
    const a = [];
    let p = selInfo.parent;
    while (p) { a.unshift(p.text); p = index.get(p.id)?.parent; }
    return a.join(" › ");
  })();

  return (
    <div className="mm">
      <div className="mm-tools">
        <button type="button" onClick={startAddChild} disabled={!selNode || !CHILD_TYPE[selNode.type]}>＋子 <kbd>Tab</kbd></button>
        <button type="button" onClick={startAddSibling} disabled={!selNode}>＋兄弟 <kbd>Enter</kbd></button>
        <button type="button" onClick={() => selNode && selNode.type !== "root" && setEditing(selNode.id)} disabled={!selNode || selNode.type === "root"}>名前 <kbd>F2</kbd></button>
        <button type="button" onClick={remove} disabled={!selNode || selNode.type === "root"}>削除 <kbd>Del</kbd></button>
        <button type="button" onClick={undo} disabled={!undoStack.length}>戻す</button>
        <span className="mm-sp" />
        <button type="button" onClick={() => setAll(selNode || tree, true)}>全部開く</button>
        <button type="button" onClick={() => setOpen({})}>たたむ</button>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))} aria-label="縮小">−</button>
        <button type="button" onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(1)))} aria-label="拡大">＋</button>
      </div>
      <div className="mm-body">
        <div className="mm-canvas-wrap" ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown} aria-label="マップ。矢印で移動、Tabで子、Enterで兄弟を追加">
          <div className="mm-canvas" style={{ width, height, zoom }}>
            <svg className="mm-links" width={width} height={height}>
              {links.map((l, i) => {
                const x1 = l.from.x + l.from.w, y1 = l.from.y + l.from.h / 2, x2 = l.to.x, y2 = l.to.y + l.to.h / 2, mx = (x1 + x2) / 2;
                return <path key={i} d={`M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} stroke={BRANCH[l.to.branch]} opacity={l.to.n?.type === "sub" ? 0.45 : 0.8} />;
              })}
            </svg>
            {boxes.map(renderBox)}
          </div>
        </div>
        <aside className="mm-panel" aria-label="選択中の中身">
          {selNode && <div className="mm-crumb">{crumb || " "}</div>}
          {selNode && <h4 className="mm-title">{selNode.text}</h4>}
          {renderPanel()}
        </aside>
      </div>
      {toast && (
        <div className="mm-toast" role="status">
          {toast.msg}
          {toast.canUndo && <button type="button" onClick={undo}>元に戻す</button>}
        </div>
      )}
    </div>
  );
}
