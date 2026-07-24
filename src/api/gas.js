const GAS_URL = import.meta.env.VITE_GAS_URL;

export async function loadProjects() {
  const res = await fetch(GAS_URL);
  if (!res.ok) throw new Error(`GAS load failed: ${res.status}`);
  const data = await res.json();
  return data.projects || [];
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

export async function loadProjectNotes(pjId) {
  const res = await fetch(`${GAS_URL}?action=notes&pjId=${encodeURIComponent(pjId)}`);
  if (!res.ok) throw new Error(`GAS load notes failed: ${res.status}`);
  const data = await res.json();
  return data.notes || [];
}

export async function addProjectNote(pjId, type, content) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'addNote', pjId, type, content }),
  });
  if (!res.ok) throw new Error(`GAS add note failed: ${res.status}`);
  return res.json();
}
