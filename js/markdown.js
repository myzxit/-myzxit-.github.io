// 답변 표시용 최소 마크다운 렌더러.
// 입력은 항상 먼저 이스케이프하므로 모델 출력이 HTML로 실행되지 않습니다.

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function inline(s) {
  return s
    // 인라인 코드 (내부 마크업 무시)
    .replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`)
    // $...$ 수식은 강조만 해서 그대로 보여줍니다
    .replace(/\$([^$\n]+)\$/g, (_, c) => `<span class="math">${c}</span>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
}

/** 마크다운 문자열을 안전한 HTML로 변환합니다. */
export function renderMarkdown(src) {
  const text = escapeHtml(src || '');
  const lines = text.split('\n');
  const out = [];
  let list = null;      // 'ul' | 'ol' | null
  let inCode = false;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (/^\s*```/.test(line)) {
      flushPara(); closeList();
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(raw); continue; }

    if (!line.trim()) { flushPara(); closeList(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara(); closeList();
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushPara(); closeList();
      out.push('<hr />');
      continue;
    }

    const quote = line.match(/^&gt;\s?(.*)$/);
    if (quote) {
      flushPara(); closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ol || ul) {
      flushPara();
      const want = ol ? 'ol' : 'ul';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((ol || ul)[1])}</li>`);
      continue;
    }

    closeList();
    para.push(line.trim());
  }

  if (inCode) out.push('</code></pre>');
  flushPara();
  closeList();
  return out.join('\n');
}

/**
 * `라벨:` 블록으로 나뉜 풀이 응답을 구조화합니다. (js/prompt.js 의 출력 형식)
 *
 * 스트리밍 중에도 계속 호출되므로, 아직 도착하지 않은 블록은 그냥 비어 있습니다.
 * 알려진 라벨이 하나도 없으면 전체를 body 로 돌려주어 예전 형식·자유 형식도 그대로 보입니다.
 */
// 한 줄짜리 블록. 다음 줄부터는 이 블록에 이어 붙이지 않습니다.
// (형식을 따르지 않는 응답에서 `정답:` 이 본문 전체를 삼키는 것을 막습니다)
const SINGLE_LINE = new Set(['question', 'answer', 'filled', 'verify', 'confidence', 'oneline']);

const SECTION_LABELS = [
  ['question', ['문제', 'Question']],
  ['answer', ['정답', '답', 'Answer']],
  ['filled', ['완성', 'Completed']],
  ['verify', ['검증']],
  ['conditions', ['조건', '주어진 조건']],
  ['target', ['구할것', '구할 것', '구해야 하는 것']],
  ['concept', ['개념', '핵심 개념']],
  ['formula', ['공식']],
  ['steps', ['풀이', '단계별 풀이']],
  ['check', ['검산']],
  ['summary', ['요약', '풀이 요약', '풀이과정 요약']],
  ['oneline', ['한줄', '한 줄 정리', '핵심 한 줄']],
  ['easy', ['쉽게', '쉽게 설명하면']],
  ['caution', ['주의', '실수하기 쉬운 부분']],
  ['choices', ['선택지', '선택지 분석']],
  ['confidence', ['확신도']],
];

const LABEL_PATTERN = new RegExp(
  `^\\s*(?:\\*\\*)?(${SECTION_LABELS.flatMap(([, names]) => names).join('|')})(?:\\*\\*)?\\s*[:：]\\s*(.*)$`,
);

function keyForLabel(label) {
  for (const [key, names] of SECTION_LABELS) if (names.includes(label)) return key;
  return null;
}

/**
 * @returns {{sections: Record<string,string>, body: string}}
 *   sections: 찾은 블록들, body: 라벨이 없는 나머지 본문
 */
export function parseSolution(src) {
  const lines = String(src || '').split('\n');
  const sections = {};
  const body = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(LABEL_PATTERN);
    const key = m ? keyForLabel(m[1]) : null;
    if (key) {
      sections[key] = m[2].trim();
      current = SINGLE_LINE.has(key) ? null : key;
      continue;
    }
    if (current) sections[current] += (sections[current] ? '\n' : '') + line;
    else body.push(line);
  }

  for (const key of Object.keys(sections)) sections[key] = sections[key].trim();
  return { sections, body: body.join('\n').trim() };
}

/**
 * 예전(자유) 형식과의 호환용. `문제:` / `정답:` / `완성:` 만 뽑아냅니다.
 * @returns {{question, answer, filled, body}}
 */
export function splitFinalAnswer(src) {
  const { sections, body } = parseSolution(src);
  return {
    question: sections.question || null,
    answer: sections.answer || null,
    filled: sections.filled || null,
    body,
  };
}
