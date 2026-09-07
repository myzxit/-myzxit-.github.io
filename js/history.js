// 푼 문제 기록의 영구 저장
//
// 지금까지 기록은 메모리에만 있어서 앱을 끄면 사라졌습니다. 여기서 기록과
// 세션 기억(AI 문맥)을 localStorage 에 담아 다음 실행에서도 이어지게 합니다.
//
// 저장하지 않는 것 — 의도적으로 뺍니다.
//   · API 키 (§95) — 기록에는 애초에 들어오지 않지만, 저장 전에 한 번 더 걸러냅니다.
//   · 원본 캡처 이미지 — 한 장이 수백 KB 라 몇 장만 쌓여도 저장 한도를 넘깁니다.
//     (§118 "무한 base64 저장" 금지) 목록용 축소본만 남기고, 원본은 메모리에만 둡니다.
//
// 저장은 언제든 실패할 수 있습니다(시크릿 모드, 저장 한도 초과). 실패해도 앱은
// 그대로 동작해야 하므로, 여기서 조용히 삼키고 오래된 항목부터 버려 다시 시도합니다.

const KEY = 'screensolver.history.v1';

/** 저장할 최대 항목 수. 화면에 보이는 12개보다 넉넉히 둡니다. */
const MAX_ITEMS = 12;

/** 목록 축소본이 이보다 크면 저장하지 않습니다 (약 60KB) */
const MAX_THUMB_CHARS = 60_000;

/** 혹시라도 키 형태의 문자열이 섞여 들어오면 저장하지 않습니다. */
const KEY_SHAPED = /\b(?:sk-ant-[\w-]{16,}|sk-[A-Za-z0-9]{24,}|AIza[\w-]{20,})/;

function scrub(text) {
  return KEY_SHAPED.test(String(text || '')) ? '' : text;
}

/** 저장 가능한 형태로 줄입니다. 원본 이미지는 뺍니다. */
function toStored(item) {
  const thumb = item.thumb && item.thumb.length <= MAX_THUMB_CHARS ? item.thumb : null;
  return {
    id: item.id,
    text: scrub(item.text),
    thumb,
    at: item.at instanceof Date ? item.at.getTime() : Number(item.at) || Date.now(),
  };
}

function fromStored(row) {
  return {
    id: row.id,
    text: row.text || '',
    thumb: row.thumb || null,
    image: null,          // 원본은 저장하지 않습니다 — 다시 켜면 없습니다
    restored: true,       // 이 항목으로는 이미지 기반 재질문을 할 수 없습니다
    at: new Date(row.at || Date.now()),
  };
}

/**
 * 기록과 세션 기억을 저장합니다.
 * 저장 한도를 넘으면 오래된 기록부터 버리고 다시 시도합니다.
 * @returns {boolean} 저장에 성공했는지
 */
export function saveHistory(history, session) {
  let rows = (history || []).slice(0, MAX_ITEMS).map(toStored);
  const memory = (session || []).map((s) => ({ summary: scrub(s.summary) }));

  for (;;) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, rows, session: memory }));
      return true;
    } catch {
      if (!rows.length) {
        // 축소본을 다 버려도 안 되면 기록 저장을 포기합니다.
        try {
          localStorage.setItem(KEY, JSON.stringify({ v: 1, rows: [], session: memory }));
          return true;
        } catch {
          return false;
        }
      }
      // 가장 오래된 것부터 버리고 다시 시도합니다.
      rows = rows.slice(0, -1);
    }
  }
}

/** @returns {{history: Array, session: Array}} */
export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { history: [], session: [] };
    const saved = JSON.parse(raw);
    if (!saved || saved.v !== 1) return { history: [], session: [] };
    return {
      history: Array.isArray(saved.rows) ? saved.rows.map(fromStored) : [],
      session: Array.isArray(saved.session)
        ? saved.session.filter((s) => s && s.summary).map((s) => ({ summary: s.summary }))
        : [],
    };
  } catch {
    return { history: [], session: [] };
  }
}

/** 새 세션을 시작할 때 저장된 것도 함께 지웁니다. */
export function clearHistory() {
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
}
