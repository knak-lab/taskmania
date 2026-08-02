const GAS_URL = import.meta.env.VITE_GAS_URL;
const KAMO_GAS_URL = import.meta.env.VITE_KAMO_GAS_URL;

// GAS Web Appはスプレッドシートのロック待ちなどで数秒〜十数秒かかることがあり、
// 一時的な遅延・失敗がそのまま保存エラー表示になっていたため、軽いリトライを入れる。
async function fetchGasJson(url, options, retries = 2, delayMs = 1000) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`GAS request failed: ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
}

export async function loadKamoTodos() {
  if (!KAMO_GAS_URL) return { todos: [], subtasks: [] };
  const data = await fetchGasJson(KAMO_GAS_URL, undefined, 0);
  return { todos: data.todos || [], subtasks: data.subtasks || [] };
}

export async function loadAppData() {
  const data = await fetchGasJson(GAS_URL, undefined);
  return { projects: data.projects || [], moyamoyaNotes: data.moyamoyaNotes || [], workAdj: data.workAdj || [] };
}

export async function saveProjects(projects) {
  return fetchGasJson(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ projects }),
  });
}

export async function saveMoyamoyaNotes(moyamoyaNotes) {
  return fetchGasJson(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ moyamoyaNotes }),
  });
}

export async function saveWorkAdj(workAdj) {
  return fetchGasJson(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ workAdj }),
  });
}
