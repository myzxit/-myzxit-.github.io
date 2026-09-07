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

/** 라벨이 붙은 첫 줄(`정답: …`)을 본문에서 떼어냅니다. */
function takeLabelled(src, pattern) {
  const m = (src || '').match(pattern);
  if (!m) return { value: null, rest: src };
  return {
    value: m[1].replace(/\*\*/g, '').trim(),
    rest: (src.slice(0, m.index) + src.slice(m.index + m[0].length)).replace(/^\s*\n/, ''),
  };
}

/**
 * 답변 머리의 `문제: …` / `정답: …` / `완성: …` 줄을 찾아 강조 영역으로 분리합니다.
 * 어떤 문제를 읽었는지, 빈칸을 채운 결과가 무엇인지 한눈에 확인하기 위한 것입니다.
 * @returns {{question: string|null, answer: string|null, filled: string|null, body: string}}
 */
export function splitFinalAnswer(src) {
  const q = takeLabelled(src, /^\s*(?:\*\*)?(?:문제|Question|QUESTION)(?:\*\*)?\s*[:：]\s*(.+)$/m);
  const a = takeLabelled(q.rest, /^\s*(?:\*\*)?(?:정답|답|Answer|ANSWER)(?:\*\*)?\s*[:：]\s*(.+)$/m);
  const f = takeLabelled(a.rest, /^\s*(?:\*\*)?(?:완성|완성된 문장|Completed)(?:\*\*)?\s*[:：]\s*(.+)$/m);
  return { question: q.value, answer: a.value, filled: f.value, body: f.rest };
}
