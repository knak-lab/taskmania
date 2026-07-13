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
