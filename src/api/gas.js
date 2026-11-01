import { peekIdToken, withIdToken } from '../auth/googleAuth';

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

function throwIfError(data) {
  if (data && data.ok === false) throw new Error(data.error || 'API error');
  return data;
}

// GET: GoogleログインのIDトークンをクエリに付ける
async function getJson(baseUrl, retries) {
  return throwIfError(await withIdToken((idToken) => {
    const url = new URL(baseUrl);
    url.searchParams.set('id_token', idToken);
    return fetchGasJson(url.toString(), undefined, retries);
  }));
}

// POST: GoogleログインのIDトークンを本文に付ける
async function postJson(body) {
  return throwIfError(await withIdToken((idToken) => fetchGasJson(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, id_token: idToken }),
  })));
}

// カモの小屋のTodoを「ついでに」読む。カモの小屋に登録されていない人（仕事用メンバーなど）は
// 読めなくて当然なので、失敗してもログイン画面は出さずに空で返す。
export async function loadKamoTodos() {
  const idToken = peekIdToken();
  if (!KAMO_GAS_URL || !idToken) return { todos: [], subtasks: [] };
  try {
    const url = new URL(KAMO_GAS_URL);
    url.searchParams.set('id_token', idToken);
    const data = await fetchGasJson(url.toString(), undefined, 0);
    if (!data || data.ok === false) return { todos: [], subtasks: [] };
    return { todos: data.todos || [], subtasks: data.subtasks || [] };
  } catch {
    return { todos: [], subtasks: [] };
  }
}

export async function loadAppData() {
  const data = await getJson(GAS_URL);
  return { projects: data.projects || [], moyamoyaNotes: data.moyamoyaNotes || [], workAdj: data.workAdj || [], themes: data.themes || [], assignees: data.assignees || [] };
}

export async function saveProjects(projects) {
  return postJson({ projects });
}

export async function saveMoyamoyaNotes(moyamoyaNotes) {
  return postJson({ moyamoyaNotes });
}

export async function sendToCalendar({ title, date, startTime, estimatedMinutes }) {
  return postJson({ calendarEvent: { title, date, startTime, estimatedMinutes } });
}

export async function saveWorkAdj(workAdj) {
  return postJson({ workAdj });
}

export async function saveThemes(themes) {
  return postJson({ themes });
}

export async function saveAssignees(assignees) {
  return postJson({ assignees });
}
