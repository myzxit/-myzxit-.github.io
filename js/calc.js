// 계산 검증 엔진
//
// AI 가 "계산했다"고 말한 것을 그대로 믿지 않고, 여기서 독립적으로 다시 계산합니다.
// 수식을 직접 파싱해 평가하므로 eval 을 쓰지 않습니다(임의 코드 실행 위험 없음).
//
// 특히 다음을 정확히 구분합니다.
//   (-3)^2 =  9
//   -3^2   = -9      (거듭제곱이 단항 마이너스보다 먼저 묶입니다)

const EPSILON = 1e-9;

/* ── 토크나이저 ─────────────────────────────────── */

const OPERATORS = {
  '×': '*', '·': '*', '∙': '*', '⋅': '*',
  '÷': '/', '−': '-', '–': '-', '—': '-',
};

function tokenize(src) {
  const text = String(src)
    .replace(/[×·∙⋅÷−–—]/g, (c) => OPERATORS[c])
    .replace(/(\d),(?=\d{3}\b)/g, '$1');   // 천 단위 구분 쉼표: 1,000 → 1000
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      const raw = text.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) return null;   // 1.2.3 같은 잘못된 수
      tokens.push({ type: 'num', value: parseFloat(raw) });
      i = j;
      continue;
    }
    if (/[a-zA-Zα-ωΑ-Ω]/.test(c)) {
      tokens.push({ type: 'ident', value: c });
      i++;
      continue;
    }
    if ('+-*/^()'.includes(c)) { tokens.push({ type: c }); i++; continue; }
    if (c === '√') { tokens.push({ type: 'sqrt' }); i++; continue; }
    if (c === '%') { tokens.push({ type: 'percent' }); i++; continue; }
    return null;   // 다룰 수 없는 문자가 있으면 검증을 포기합니다(틀렸다고 하지 않습니다)
  }
  return tokens;
}

/* ── 파서 (재귀 하강) ───────────────────────────── */
//   expr  := term (('+'|'-') term)*
//   term  := unary (('*'|'/'|암시적 곱) unary)*
//   unary := ('-'|'+')* power
//   power := atom ('^' unary)?        ← 오른쪽 결합, 단항 마이너스보다 강하게 묶임
//   atom  := number | ident | '(' expr ')' | '√' atom

class Parser {
  constructor(tokens, vars) {
    this.tokens = tokens;
    this.pos = 0;
    this.vars = vars || {};
    this.failed = false;
  }

  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }
  fail() { this.failed = true; return 0; }

  parse() {
    const value = this.expr();
    if (this.failed || this.pos !== this.tokens.length) return null;
    return Number.isFinite(value) ? value : null;
  }

  expr() {
    let left = this.term();
    for (;;) {
      const t = this.peek();
      if (t?.type === '+') { this.next(); left += this.term(); }
      else if (t?.type === '-') { this.next(); left -= this.term(); }
      else return left;
      if (this.failed) return 0;
    }
  }

  term() {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.type === '*') { this.next(); left *= this.unary(); }
      else if (t?.type === '/') {
        this.next();
        const d = this.unary();
        if (d === 0) return this.fail();
        left /= d;
      } else if (this.startsAtom(t)) {
        left *= this.unary();      // 3x, 2(x+1) 같은 암시적 곱
      } else return left;
      if (this.failed) return 0;
    }
  }

  /** 곱셈 기호 없이 이어 붙을 수 있는 토큰인지 */
  startsAtom(t) {
    return t && (t.type === 'num' || t.type === 'ident' || t.type === '(' || t.type === 'sqrt');
  }

  unary() {
    const t = this.peek();
    if (t?.type === '-') { this.next(); return -this.unary(); }
    if (t?.type === '+') { this.next(); return this.unary(); }
    return this.power();
  }

  power() {
    const base = this.atom();
    if (this.peek()?.type === '^') {
      this.next();
      const exp = this.unary();          // 오른쪽 결합: 2^3^2 = 2^(3^2)
      if (this.failed) return 0;
      const result = Math.pow(base, exp);
      return Number.isFinite(result) ? result : this.fail();
    }
    return base;
  }

  atom() {
    const t = this.next();
    if (!t) return this.fail();
    if (t.type === 'num') {
      if (this.peek()?.type === 'percent') { this.next(); return t.value / 100; }
      return t.value;
    }
    if (t.type === 'ident') {
      if (!(t.value in this.vars)) return this.fail();   // 모르는 변수 → 검증 포기
      return this.vars[t.value];
    }
    if (t.type === '(') {
      const value = this.expr();
      if (this.next()?.type !== ')') return this.fail();
      return value;
    }
    if (t.type === 'sqrt') {
      const value = this.atom();
      if (value < 0) return this.fail();
      return Math.sqrt(value);
    }
    return this.fail();
  }
}

/**
 * 수식을 계산합니다. 계산할 수 없으면 null (틀렸다는 뜻이 아닙니다).
 * @param {string} expression
 * @param {Record<string, number>} [vars] 변수 값 (예: { x: 3 })
 */
export function evaluate(expression, vars) {
  if (!expression || expression.length > 200) return null;
  const tokens = tokenize(expression);
  if (!tokens || !tokens.length) return null;
  return new Parser(tokens, vars).parse();
}

/** 부동소수 오차를 감안한 같음 판정 */
export function nearlyEqual(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= EPSILON * scale;
}

/* ── 검증 ───────────────────────────────────────── */

/** 한 줄에서 `A = B = C` 형태를 뽑아냅니다. */
function equalityParts(line) {
  // 부등호나 화살표가 섞인 줄은 다루지 않습니다.
  if (/[<>≤≥≠]/.test(line)) return null;
  const cleaned = line
    // 목록 기호만 제거합니다. 숫자를 통째로 지우면 `3x + 6 = 15` 의 3이 사라지므로
    // 반드시 "숫자 + 점/괄호 + 공백" 형태일 때만 번호로 봅니다.
    .replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, '')
    // `1단계`, `Step 2`, `(2)` 같은 단계 표시를 떼어 냅니다.
    // 이걸 떼지 않으면 풀이 본문의 모든 줄이 "계산 불가"로 건너뛰어져
    // 단계별 계산이 사실상 검증되지 않습니다.
    .replace(/^\s*(?:\(?\d+\)?\s*단계|단계\s*\d+|Step\s*\d+)\s*[.):]?\s*/i, '')
    // `확인:`, `검산:` 처럼 앞에 붙은 라벨을 떼어 냅니다.
    .replace(/^\s*[^:=]{1,20}:\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/[,，]/g, '')                 // 천 단위 구분
    .trim();
  const parts = cleaned.split(/=/).map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

/**
 * 풀이 본문에서 순수 숫자 등식만 골라 다시 계산합니다.
 * 변수가 섞인 식은 값을 알 수 없으므로 건너뜁니다(틀렸다고 하지 않습니다).
 * @returns {{line: string, left: number, right: number, ok: boolean}[]}
 */
export function checkArithmetic(text, vars) {
  const results = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.length > 200) continue;
    const parts = equalityParts(line);
    if (!parts) continue;

    const values = parts.map((p) => evaluate(p, vars));
    if (values.some((v) => v === null)) continue;   // 하나라도 계산 못 하면 건너뜀

    for (let i = 1; i < values.length; i++) {
      results.push({
        line,
        left: values[i - 1],
        right: values[i],
        ok: nearlyEqual(values[i - 1], values[i]),
      });
    }
  }
  return results;
}

/**
 * 방정식에 답을 대입해 검산합니다.
 *   verifyEquation('3x + 6 = 15', 'x', 3) → { ok: true, left: 15, right: 15 }
 * @returns {{ok: boolean, left: number, right: number}|null} 검산 불가면 null
 */
export function verifyEquation(equation, variable, value) {
  const parts = equalityParts(String(equation || ''));
  if (!parts || parts.length !== 2) return null;
  const v = typeof value === 'number' ? value : evaluate(String(value));
  if (v === null || !Number.isFinite(v)) return null;

  const vars = { [variable]: v };
  const left = evaluate(parts[0], vars);
  const right = evaluate(parts[1], vars);
  if (left === null || right === null) return null;
  return { ok: nearlyEqual(left, right), left, right };
}

/** 보기 좋게 반올림 (1/3 → 0.333333) */
export function pretty(n) {
  if (!Number.isFinite(n)) return String(n);
  const rounded = Math.round(n * 1e6) / 1e6;
  return String(rounded);
}
