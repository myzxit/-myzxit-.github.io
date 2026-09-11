// 오답노트 (§25)
//
// 틀렸거나 다시 보고 싶은 문제를 따로 모아 둡니다. 기록(history)과 달리
// "새로 시작"을 눌러도 지워지지 않습니다 — 복습이 목적이기 때문입니다.
//
// 저장하지 않는 것
//   · API 키 (§95) — 저장 전에 한 번 더 걸러냅니다.
//   · 원본 캡처 이미지 — 목록용 축소본만 둡니다. (§118 무한 base64 저장 금지)

const KEY = 'screensolver.wrongnotes.v1';

/** 저장 개수 상한. 넘으면 오래된 것부터 버립니다. */
const MAX_ITEMS = 60;

/** 축소본 크기 상한(약 60KB). 넘으면 이미지 없이 저장합니다. */
const MAX_THUMB_CHARS = 60_000;

const KEY_SHAPED = /\b(?:sk-ant-[\w-]{16,}|sk-[A-Za-z0-9]{24,}|AIza[\w-]{20,})/;
const scrub = (t) => (KEY_SHAPED.test(String(t || '')) ? '' : String(t || ''));

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw);
    return Array.isArray(saved?.rows) ? saved.rows : [];
  } catch {
    return [];
  }
}

/** 저장 한도를 넘으면 오래된 것부터 버리고 다시 시도합니다. */
function writeAll(rows) {
  let list = rows.slice(0, MAX_ITEMS);
  for (;;) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, rows: list }));
      return true;
    } catch {
      if (!list.length) return false;
      list = list.slice(0, -1);
    }
  }
}

/** @returns {Array} 최신순 목록 */
export function loadNotes() {
  return readAll().map((r) => ({ ...r, at: new Date(r.at || Date.now()) }));
}

/**
 * 오답노트에 추가합니다. 같은 문제를 두 번 담지 않도록 id 로 덮어씁니다.
 * @param {{id, question, answer, myAnswer, solution, reason, subject, level, thumb}} note
 */
export function addNote(note) {
  const rows = readAll();
  const row = {
    id: note.id || Date.now(),
    question: scrub(note.question).slice(0, 500),
    answer: scrub(note.answer).slice(0, 500),
    myAnswer: scrub(note.myAnswer).slice(0, 300),
    solution: scrub(note.solution).slice(0, 8000),
    reason: scrub(note.reason).slice(0, 500),
    subject: note.subject || '기타',
    level: note.level || '',
    thumb: note.thumb && note.thumb.length <= MAX_THUMB_CHARS ? note.thumb : null,
    at: Date.now(),
  };
  const next = [row, ...rows.filter((r) => r.id !== row.id)];
  return writeAll(next) ? row : null;
}

export function removeNote(id) {
  return writeAll(readAll().filter((r) => r.id !== id));
}

export function clearNotes() {
  try { localStorage.removeItem(KEY); return true; } catch { return false; }
}

export function hasNote(id) {
  return readAll().some((r) => r.id === id);
}

/** 저장에 쓰이는 대략적인 용량(KB) — 설정 화면 안내용 */
export function notesSizeKb() {
  try { return Math.round((localStorage.getItem(KEY) || '').length / 1024); } catch { return 0; }
}
