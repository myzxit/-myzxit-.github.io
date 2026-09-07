// Claude / ChatGPT / Gemini 스트리밍 어댑터
//
// 공통 입력 형식:
//   turns: [{ role: 'user'|'assistant', text: string, image?: { mime, base64 } }]
// 공통 출력: onDelta(textChunk) 를 반복 호출하고, 전체 텍스트를 resolve.

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

  const hints = {
    401: 'API 키가 올바른지 확인하세요.',
    403: 'API 키에 이 모델 사용 권한이 있는지 확인하세요.',
    404: '모델 이름 또는 엔드포인트가 올바른지 확인하세요.',
    429: '요청 한도(rate limit)에 걸렸습니다. 잠시 후 다시 시도하세요.',
  };
  const hint = hints[response.status] ? ` ${hints[response.status]}` : '';
  const err = new Error(`${provider} 오류 ${response.status}: ${detail.slice(0, 400) || response.statusText}${hint}`);
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

  const res = await fetch(endpoint, {
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

  const res = await fetch(endpoint, {
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

  const res = await fetch(url, {
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
