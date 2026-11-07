const KEY = 'moxi.v1';

export function emptyStore() {
  return {
    version: 1,
    profile: { name: '', goal: 10 },
    imports: [],
    answers: {},
    submissions: {},
    marks: {},
    wrongs: [],
    chats: {},
    tags: {},
    api: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: '' },
    gradedLog: [],
  };
}

export function loadStore() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    return {
      ...emptyStore(),
      ...parsed,
      profile: { ...emptyStore().profile, ...(parsed.profile || {}) },
      api: { ...emptyStore().api, ...(parsed.api || {}) },
    };
  } catch {
    return emptyStore();
  }
}

export function saveStore(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function localDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayCount(log, date = localDate()) {
  return (log || []).filter((item) => item.date === date).reduce((sum, item) => sum + item.n, 0);
}

export function streak(log, date = localDate()) {
  const days = new Set((log || []).map((item) => item.date));
  let count = 0;
  const cursor = new Date(`${date}T12:00:00`);
  while (days.has(localDate(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}
