/**
 * AI 요청 서버 프록시 (§2B)
 *
 * API 키를 브라우저에 두지 않는 방법입니다. 키는 Netlify 환경변수에만 있고,
 * 클라이언트 번들에는 절대 포함되지 않습니다.
 *
 *   브라우저 → /api/ai → (환경변수의 키) → Claude/OpenAI/Gemini
 *
 * 환경변수 (Netlify 사이트 설정에서 지정, provider 별로 분리)
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
 *
 * 지키는 것
 * - 키를 응답·로그·오류 메시지에 절대 싣지 않습니다.
 * - 업스트림 오류 원문을 그대로 돌려주지 않고, 상태코드와 짧은 요약만 보냅니다.
 * - 클라이언트가 보낸 엔드포인트를 그대로 쓰지 않습니다(SSRF 방지). 허용된
 *   호스트만 씁니다.
 * - 요청 본문 크기를 제한합니다.
 */

/** 프로바이더별 고정 엔드포인트. 클라이언트가 바꿀 수 없습니다. */
const PROVIDERS = {
  claude: {
    env: 'ANTHROPIC_API_KEY',
    url: () => 'https://api.anthropic.com/v1/messages',
    headers: (key) => ({
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    body: ({ model, system, turns }) => ({
      model,
      max_tokens: 4096,
      system,
      stream: true,
      messages: turns.map((t) => ({
        role: t.role,
        content: [
          ...(t.image
            ? [{ type: 'image', source: { type: 'base64', media_type: t.image.mime, data: t.image.base64 } }]
            : []),
          { type: 'text', text: t.text },
        ],
      })),
    }),
  },
  openai: {
    env: 'OPENAI_API_KEY',
    url: () => 'https://api.openai.com/v1/chat/completions',
    headers: (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    body: ({ model, system, turns }) => ({
      model,
      stream: true,
      max_completion_tokens: 4096,
      messages: [
        { role: 'system', content: system },
        ...turns.map((t) => (t.role === 'assistant'
          ? { role: 'assistant', content: t.text }
          : {
            role: 'user',
            content: [
              ...(t.image
                ? [{ type: 'image_url', image_url: { url: `data:${t.image.mime};base64,${t.image.base64}` } }]
                : []),
              { type: 'text', text: t.text },
            ],
          })),
      ],
    }),
  },
  gemini: {
    env: 'GEMINI_API_KEY',
    url: (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    headers: (key) => ({ 'content-type': 'application/json', 'x-goog-api-key': key }),
    body: ({ system, turns }) => ({
      contents: turns.map((t) => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [
          ...(t.image ? [{ inline_data: { mime_type: t.image.mime, data: t.image.base64 } }] : []),
          { text: t.text },
        ],
      })),
      system_instruction: { parts: [{ text: system }] },
      generationConfig: { maxOutputTokens: 4096 },
    }),
  },
};

/** 이미지까지 담기므로 넉넉히, 그러나 무제한은 아닙니다. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

/*
 * 남용 방지 (§68).
 *
 * 서버에 키가 설정되어 있으면 이 주소를 아는 사람은 누구나 사이트 주인의
 * API 크레딧을 쓸 수 있습니다. 최소한의 제동을 겁니다.
 *
 * 한계를 분명히 해 둡니다: 함수 인스턴스의 메모리에만 기록하므로, 인스턴스가
 * 여러 개로 늘어나거나 콜드 스타트가 나면 카운터가 초기화됩니다. 실수로 인한
 * 폭주와 가벼운 남용은 막지만, 작정한 공격을 막는 수단은 아닙니다.
 * 정말로 막아야 한다면 환경변수를 지워 프록시를 끄거나(사용자가 자기 키를
 * 입력하는 방식으로 동작합니다) PROXY_ACCESS_CODE 를 설정하세요.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.PROXY_RATE_LIMIT || 20);
const hits = new Map();   // ip → number[] (요청 시각)

/**
 * 서버 키를 실제로 내어 줄지 (§68).
 *
 * 키가 환경변수에 "있다"는 것과 "아무나 써도 된다"는 것은 다릅니다. 사이트가
 * 공개되어 있으면 주소를 아는 누구나 사이트 주인의 크레딧을 쓰게 되므로,
 * 기본값은 꺼짐입니다. 주인이 다음 중 하나를 명시적으로 설정해야 켜집니다.
 *
 *   PROXY_ENABLED=true       — 누구나 서버 키로 사용 (비용은 사이트 주인 부담)
 *   PROXY_ACCESS_CODE=<코드>  — 코드를 아는 사람만 사용
 *
 * 꺼져 있으면 사이트는 그대로 동작하고, 각 사용자가 자기 키를 입력합니다.
 */
export function proxyEnabled() {
  return process.env.PROXY_ENABLED === 'true' || Boolean(process.env.PROXY_ACCESS_CODE);
}

function rateLimited(ip) {
  if (MAX_PER_WINDOW <= 0) return false;      // 0 이면 제한 없음
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  // 메모리가 무한히 늘지 않도록 오래된 항목을 정리합니다.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(key);
    }
  }
  return recent.length > MAX_PER_WINDOW;
}

const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: '허용되지 않은 요청 방식입니다.' });

  const length = Number(req.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) {
    return json(413, { error: '이미지가 너무 큽니다. 설정에서 전송 이미지 최대 가로를 줄여 주세요.' });
  }

  // 주인이 명시적으로 켜지 않았으면 서버 키를 쓰지 않습니다 (§68).
  if (!proxyEnabled()) {
    return json(501, {
      error: '이 서버는 공용 AI 사용이 꺼져 있습니다. 설정에서 직접 API 키를 입력해 주세요.',
      configured: false,
    });
  }

  // 접근 코드가 설정돼 있으면 아는 사람만 서버 키를 쓸 수 있습니다.
  const code = process.env.PROXY_ACCESS_CODE;
  if (code && req.headers.get('x-screensolver-code') !== code) {
    return json(403, { error: '서버 접근 코드가 올바르지 않습니다. 설정에서 코드를 확인하거나 직접 API 키를 입력해 주세요.' });
  }

  const ip = req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || 'unknown';
  if (rateLimited(ip)) {
    return json(429, { error: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: '요청 형식이 올바르지 않습니다.' });
  }

  const spec = PROVIDERS[payload?.provider];
  if (!spec) return json(400, { error: '알 수 없는 AI 프로바이더입니다.' });

  const key = process.env[spec.env];
  if (!key) {
    return json(501, {
      error: '이 서버에는 해당 AI 프로바이더의 키가 설정되어 있지 않습니다. 설정에서 직접 API 키를 입력해 주세요.',
      configured: false,
    });
  }

  const model = String(payload.model || '').slice(0, 120);
  const system = String(payload.system || '').slice(0, 20000);
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  if (!model || !turns.length) return json(400, { error: '요청 내용이 비어 있습니다.' });

  let upstream;
  try {
    upstream = await fetch(spec.url(model), {
      method: 'POST',
      headers: spec.headers(key),
      body: JSON.stringify(spec.body({ model, system, turns })),
      signal: req.signal,          // 브라우저가 중단하면 업스트림도 함께 끊습니다
    });
  } catch (err) {
    if (err?.name === 'AbortError') return json(499, { error: '요청이 취소되었습니다.' });
    return json(502, { error: 'AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }

  if (!upstream.ok) {
    // 업스트림 원문에는 키가 들어 있을 수 있으므로 그대로 전달하지 않습니다.
    // 상태코드만 넘기고, 사용자용 문구는 클라이언트가 만듭니다.
    return json(upstream.status, { error: 'upstream', status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  });
};

export const config = { path: '/api/ai' };
