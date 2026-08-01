const GAS_URL = import.meta.env.VITE_GAS_URL;
const KAMO_GAS_URL = import.meta.env.VITE_KAMO_GAS_URL;

export async function loadKamoTodos() {
  if (!KAMO_GAS_URL) return { todos: [], subtasks: [] };
  const res = await fetch(KAMO_GAS_URL);
  if (!res.ok) throw new Error(`Kamo GAS load failed: ${res.status}`);
  const data = await res.json();
  return { todos: data.todos || [], subtasks: data.subtasks || [] };
}

export async function loadAppData() {
  const res = await fetch(GAS_URL);
  if (!res.ok) throw new Error(`GAS load failed: ${res.status}`);
  const data = await res.json();
  return { projects: data.projects || [], moyamoyaNotes: data.moyamoyaNotes || [], workAdj: data.workAdj || [] };
}

export async function saveProjects(projects) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ projects }),
  });
  if (!res.ok) throw new Error(`GAS save failed: ${res.status}`);
  return res.json();
}

export async function saveMoyamoyaNotes(moyamoyaNotes) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ moyamoyaNotes }),
  });
  if (!res.ok) throw new Error(`GAS save failed: ${res.status}`);
  return res.json();
}

export async function saveWorkAdj(workAdj) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ workAdj }),
  });
  if (!res.ok) throw new Error(`GAS save failed: ${res.status}`);
  return res.json();
}
