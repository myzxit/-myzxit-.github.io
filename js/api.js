// Claude / ChatGPT / Gemini 어댑터 (§3 공통 인터페이스)
//
// 공통 입력 형식:
//   turns: [{ role: 'user'|'assistant', text: string, image?: { mime, base64 } }]
// 공통 출력: onDelta(textChunk) 를 반복 호출하고, 전체 텍스트를 resolve.
//
// 호출 경로는 두 가지이고, 응답을 읽는 방법(SSE 파서)은 같습니다.
//   직접 호출  — 브라우저가 사용자의 키로 프로바이더를 부릅니다.
//   서버 프록시 — /api/ai 가 서버 환경변수의 키로 대신 부릅니다. (§2B)

/**
 * fetch 를 감싸 네트워크 실패를 구분 가능한 오류로 바꿉니다.
 * 연결이 없을 때 브라우저는 "Failed to fetch" 같은 문구만 던지는데,
 * 그대로 보여 주면 원인을 알 수 없고 재시도할 방법도 없습니다.
 */
async function requestOrThrow(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    const offline = new Error('네트워크에 연결하지 못했습니다.');
    offline.name = 'NetworkError';
    offline.offline = true;
    offline.cause = err;
    throw offline;
  }
}

/** SSE(text/event-stream) 응답을 줄 단위 data 페이로드로 흘려보냅니다. */
async function* sseLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** 사람이 읽을 수 있는 실패 문구 (§32). 원본 JSON 은 화면에 내보내지 않습니다. */
const STATUS_HINT = {
  400: '요청이 거부되었습니다. 모델 이름과 이미지 크기를 확인하세요.',
  401: 'API 키가 올바르지 않습니다. 앞뒤 공백 없이 다시 붙여넣어 보세요.',
  403: '이 API 키로는 해당 모델을 쓸 수 없습니다. 다른 모델을 선택해 보세요.',
  404: '선택한 모델을 사용할 수 없습니다. 설정에서 모델을 확인해 주세요.',
  413: '이미지가 너무 큽니다. 설정에서 전송 이미지 최대 가로를 줄이세요.',
  429: '현재 API 사용량 제한에 도달했습니다. 잠시 후 다시 시도하세요.',
  500: '서비스 쪽 일시적인 오류입니다. 잠시 후 다시 시도하세요.',
  501: '서버에 이 프로바이더의 키가 설정되어 있지 않습니다. 설정에서 직접 키를 입력해 주세요.',
  502: 'AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도하세요.',
  503: '서비스가 혼잡합니다. 잠시 후 다시 시도하세요.',
};

async function failFrom(response, provider) {
  let detail = '';
  try {
    const body = await response.text();
    try {
      const j = JSON.parse(body);
      detail = j.error?.message || j.message || j.error || body;
    } catch {
      detail = body;
    }
  } catch { /* 본문을 읽지 못한 경우 상태코드만 사용 */ }
  detail = String(detail || '');

  let hint = STATUS_HINT[response.status] || '알 수 없는 오류가 발생했습니다.';

  // 잔액/무료 등급 문제는 원인이 전혀 다르므로 따로 안내합니다.
  if (/credit balance|billing|insufficient_quota|quota|exceeded your current quota|free tier/i.test(detail)) {
    hint = provider === 'Gemini'
      ? '무료 등급 사용량을 초과했거나 이 모델이 무료 등급에서 지원되지 않습니다. 설정에서 모델을 Gemini 2.5 Flash 로 바꾸거나 잠시 후 다시 시도하세요.'
      : `${provider} 는 무료 등급이 없어 결제 크레딧이 있어야 API 가 동작합니다. 무료로 쓰려면 설정에서 Gemini 를 선택하세요.`;
  }

  // 사용자에게는 정리된 문구만 보여 줍니다. 원문은 디버그 모드에서만 씁니다.
  const err = new Error(hint);
  err.status = response.status;
  err.provider = provider;
  err.detail = detail.slice(0, 500);
  throw err;
}

/* ── 프로바이더별 요청/응답 규격 (§3, §4) ───────────── */

const SPECS = {
  claude: {
    label: 'Claude',
    directUrl: ({ endpoint }) => endpoint,
    directHeaders: (apiKey) => ({
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
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
    delta: (evt) => (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta'
      ? evt.delta.text : ''),
    errorOf: (evt) => (evt.type === 'error' ? evt.error?.message : null),
    // 연결 테스트·모델 목록 (§4, §38)
    modelsUrl: () => 'https://api.anthropic.com/v1/models',
    modelsHeaders: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }),
    modelsOf: (j) => (j.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id })),
  },

  openai: {
    label: 'ChatGPT',
    directUrl: ({ endpoint }) => endpoint,
    directHeaders: (apiKey) => ({ 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }),
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
    delta: (evt) => evt.choices?.[0]?.delta?.content || '',
    errorOf: (evt) => evt.error?.message || null,
    modelsUrl: () => 'https://api.openai.com/v1/models',
    modelsHeaders: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
    modelsOf: (j) => (j.data || [])
      .filter((m) => /^(gpt|o\d)/.test(m.id))
      .map((m) => ({ id: m.id, label: m.id })),
  },

  gemini: {
    label: 'Gemini',
    directUrl: ({ endpoint, model }) =>
      `${endpoint.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    directHeaders: (apiKey) => ({ 'content-type': 'application/json', 'x-goog-api-key': apiKey }),
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
    delta: (evt) => (evt.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '').join(''),
    errorOf: (evt) => evt.error?.message || null,
    modelsUrl: ({ endpoint }) => `${(endpoint || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')}/models`,
    modelsHeaders: (apiKey) => ({ 'x-goog-api-key': apiKey }),
    modelsOf: (j) => (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || m.name })),
  },
};

/** 프로바이더 응답(SSE)을 읽어 전체 텍스트를 만듭니다. */
async function readStream(res, spec, onDelta) {
  let full = '';
  for await (const data of sseLines(res)) {
    if (data === '[DONE]') break;
    let evt;
    try { evt = JSON.parse(data); } catch { continue; }
    const message = spec.errorOf(evt);
    if (message) throw new Error(`${spec.label} 오류: ${message}`);
    const piece = spec.delta(evt);
    if (piece) { full += piece; onDelta(piece); }
  }
  return full;
}

/**
 * 선택한 프로바이더로 스트리밍 요청을 보냅니다.
 * @param {object} o
 * @param {boolean} [o.useProxy] 서버 프록시로 보낼지 (키를 브라우저가 몰라도 됩니다)
 * @returns {Promise<string>} 전체 응답 텍스트
 */
export async function streamCompletion({
  provider, useProxy = false, endpoint, apiKey, model, system, turns, signal, onDelta,
}) {
  const spec = SPECS[provider];
  if (!spec) throw new Error('알 수 없는 AI 프로바이더입니다.');

  const res = useProxy
    ? await requestOrThrow('/api/ai', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model, system, turns }),
    })
    : await requestOrThrow(spec.directUrl({ endpoint, model }), {
      method: 'POST',
      signal,
      headers: spec.directHeaders(apiKey),
      body: JSON.stringify(spec.body({ model, system, turns })),
    });

  if (!res.ok) await failFrom(res, spec.label);
  return readStream(res, spec, onDelta);
}

/**
 * API 키가 실제로 동작하는지 확인하고, 쓸 수 있는 모델 목록을 가져옵니다. (§4, §38)
 * 모델 목록 조회는 생성 요청이 아니라서 토큰 비용이 들지 않습니다.
 * @returns {Promise<{ok: true, models: {id,label}[]} | never>}
 */
export async function testConnection({ provider, apiKey, endpoint, signal }) {
  const spec = SPECS[provider];
  if (!spec) throw new Error('알 수 없는 AI 프로바이더입니다.');
  if (!apiKey) {
    const err = new Error('API 키를 먼저 입력해 주세요.');
    err.status = 0;
    throw err;
  }

  const res = await requestOrThrow(spec.modelsUrl({ endpoint }), {
    method: 'GET',
    signal,
    headers: spec.modelsHeaders(apiKey),
  });
  if (!res.ok) await failFrom(res, spec.label);

  let models = [];
  try {
    models = spec.modelsOf(await res.json());
  } catch {
    models = [];   // 목록을 못 읽어도 연결 자체는 성공입니다
  }
  return { ok: true, models };
}

/** 프로바이더 표시 이름 */
export function providerLabel(provider) {
  return SPECS[provider]?.label || provider;
}
