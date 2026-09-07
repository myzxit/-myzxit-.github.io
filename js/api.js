// Claude / ChatGPT / Gemini 스트리밍 어댑터
//
// 공통 입력 형식:
//   turns: [{ role: 'user'|'assistant', text: string, image?: { mime, base64 } }]
// 공통 출력: onDelta(textChunk) 를 반복 호출하고, 전체 텍스트를 resolve.

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

async function failFrom(response, provider) {
  let detail = '';
  try {
    const body = await response.text();
    try {
      const j = JSON.parse(body);
      detail = j.error?.message || j.message || body;
    } catch {
      detail = body;
    }
  } catch { /* 본문을 읽지 못한 경우 상태코드만 사용 */ }

  // 실제로 자주 겪는 실패를 한국어로 풀어 줍니다. (키 값 자체는 절대 출력하지 않습니다)
  let hint = {
    400: '요청이 거부되었습니다. 모델 이름과 이미지 크기를 확인하세요.',
    401: 'API 키가 올바르지 않습니다. 앞뒤 공백 없이 다시 붙여넣어 보세요.',
    403: '이 API 키로는 해당 모델을 쓸 수 없습니다. 다른 모델을 선택해 보세요.',
    404: '모델 이름 또는 엔드포인트가 올바르지 않습니다. 설정에서 모델을 바꿔 보세요.',
    413: '이미지가 너무 큽니다. 설정에서 전송 이미지 최대 가로를 줄이세요.',
    429: '요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요.',
    500: '서비스 쪽 일시적인 오류입니다. 잠시 후 다시 시도하세요.',
    503: '서비스가 혼잡합니다. 잠시 후 다시 시도하세요.',
  }[response.status] || '';

  // 잔액/무료 등급 문제는 원인이 전혀 다르므로 따로 안내합니다.
  if (/credit balance|billing|insufficient_quota|quota|exceeded your current quota|free tier/i.test(detail)) {
    hint = provider === 'Gemini'
      ? '무료 등급 사용량을 초과했거나 이 모델이 무료 등급에서 지원되지 않습니다. 설정에서 모델을 Gemini 2.5 Flash 로 바꾸거나 잠시 후 다시 시도하세요.'
      : `${provider} 는 무료 등급이 없어 결제 크레딧이 있어야 API 가 동작합니다. 무료로 쓰려면 설정에서 Gemini 를 선택하세요.`;
  }

  const err = new Error(
    `${provider} 오류 ${response.status}: ${detail.slice(0, 300) || response.statusText}` +
    (hint ? `\n\n→ ${hint}` : ''),
  );
  err.status = response.status;
  throw err;
}

/* ── Claude ──────────────────────────────────────── */
async function streamClaude({ endpoint, apiKey, model, system, turns, signal, onDelta }) {
  const messages = turns.map((t) => {
    const content = [];
    if (t.image) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: t.image.mime, data: t.image.base64 },
      });
    }
    content.push({ type: 'text', text: t.text });
    return { role: t.role, content };
  });

  const res = await requestOrThrow(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 4096, system, messages, stream: true }),
  });
  if (!res.ok) await failFrom(res, 'Claude');

  let full = '';
  for await (const data of sseLines(res)) {
    if (data === '[DONE]') break;
    let evt;
    try { evt = JSON.parse(data); } catch { continue; }
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
      full += evt.delta.text;
      onDelta(evt.delta.text);
    } else if (evt.type === 'error') {
      throw new Error(`Claude 오류: ${evt.error?.message || '알 수 없는 오류'}`);
    }
  }
  return full;
}

/* ── OpenAI (ChatGPT) ────────────────────────────── */
async function streamOpenAI({ endpoint, apiKey, model, system, turns, signal, onDelta }) {
  const messages = [{ role: 'system', content: system }];
  for (const t of turns) {
    if (t.role === 'assistant') {
      messages.push({ role: 'assistant', content: t.text });
      continue;
    }
    const content = [];
    if (t.image) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${t.image.mime};base64,${t.image.base64}` },
      });
    }
    content.push({ type: 'text', text: t.text });
    messages.push({ role: 'user', content });
  }

  const res = await requestOrThrow(endpoint, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: true, max_completion_tokens: 4096 }),
  });
  if (!res.ok) await failFrom(res, 'ChatGPT');

  let full = '';
  for await (const data of sseLines(res)) {
    if (data === '[DONE]') break;
    let evt;
    try { evt = JSON.parse(data); } catch { continue; }
    if (evt.error) throw new Error(`ChatGPT 오류: ${evt.error.message || '알 수 없는 오류'}`);
    const piece = evt.choices?.[0]?.delta?.content;
    if (piece) { full += piece; onDelta(piece); }
  }
  return full;
}

/* ── Gemini ──────────────────────────────────────── */
async function streamGemini({ endpoint, apiKey, model, system, turns, signal, onDelta }) {
  const base = endpoint.replace(/\/+$/, '');
  const url = `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  const contents = turns.map((t) => {
    const parts = [];
    if (t.image) parts.push({ inline_data: { mime_type: t.image.mime, data: t.image.base64 } });
    parts.push({ text: t.text });
    return { role: t.role === 'assistant' ? 'model' : 'user', parts };
  });

  const res = await requestOrThrow(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents,
      system_instruction: { parts: [{ text: system }] },
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });
  if (!res.ok) await failFrom(res, 'Gemini');

  let full = '';
  for await (const data of sseLines(res)) {
    if (data === '[DONE]') break;
    let evt;
    try { evt = JSON.parse(data); } catch { continue; }
    if (evt.error) throw new Error(`Gemini 오류: ${evt.error.message || '알 수 없는 오류'}`);
    for (const part of evt.candidates?.[0]?.content?.parts || []) {
      if (part.text) { full += part.text; onDelta(part.text); }
    }
  }
  return full;
}

const ADAPTERS = { claude: streamClaude, openai: streamOpenAI, gemini: streamGemini };

/**
 * 선택한 프로바이더로 스트리밍 요청을 보냅니다.
 * @returns {Promise<string>} 전체 응답 텍스트
 */
export function streamCompletion({ provider, ...rest }) {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`알 수 없는 프로바이더: ${provider}`);
  return adapter(rest);
}
