import { PROVIDERS, loadSettings, saveSettings, activeConfig } from './store.js';
import { streamCompletion } from './api.js';
import { ScreenCapture, diffPercent, splitDataUrl } from './capture.js';
import { renderMarkdown, splitFinalAnswer } from './markdown.js';
import { buildSystemPrompt, SOLVE_INSTRUCTION } from './prompt.js';

const $ = (id) => document.getElementById(id);

const el = {
  status: $('status'),
  providerBadge: $('provider-badge'),
  providerName: $('provider-name'),
  providerModel: $('provider-model'),
  stage: $('stage'),
  preview: $('preview'),
  work: $('work'),
  thumb: $('thumb'),
  autoMode: $('auto-mode'),
  btnShare: $('btn-share'),
  btnStop: $('btn-stop'),
  btnSolve: $('btn-solve'),
  btnCrop: $('btn-crop'),
  btnCropClear: $('btn-crop-clear'),
  cropLayer: $('crop-layer'),
  cropBox: $('crop-box'),
  meter: $('meter'),
  meterFill: $('meter-fill'),
  meterText: $('meter-text'),
  autoNote: $('auto-note'),
  answer: $('answer'),
  answerScroll: $('answer-scroll'),
  detail: $('detail'),
  btnCopy: $('btn-copy'),
  btnAbort: $('btn-abort'),
  followupForm: $('followup-form'),
  followup: $('followup'),
  btnFollowup: $('btn-followup'),
  history: $('history'),
  btnClearHistory: $('btn-clear-history'),
  settings: $('settings'),
  settingsForm: $('settings-form'),
  btnSettings: $('btn-settings'),
  providerPicker: $('provider-picker'),
  apiKey: $('api-key'),
  keyLabel: $('key-label'),
  keyLink: $('key-link'),
  btnReveal: $('btn-reveal'),
  btnForget: $('btn-forget'),
  model: $('model'),
  endpoint: $('endpoint'),
  interval: $('interval'),
  intervalLabel: $('interval-label'),
  sensitivity: $('sensitivity'),
  sensLabel: $('sens-label'),
  lang: $('lang'),
  extra: $('extra'),
  maxWidth: $('max-width'),
  widthLabel: $('width-label'),
};

let settings = loadSettings();
const capture = new ScreenCapture(el.preview, el.work, el.thumb);

const state = {
  timer: null,
  lastSig: null,        // 직전 확인 프레임
  analyzedSig: null,    // 마지막으로 분석에 사용한 프레임
  stableCount: 0,       // 변화 후 화면이 멈춘 횟수
  pendingChange: false,
  busy: false,
  controller: null,
  turns: [],            // 현재 대화 (이미지 + 후속 질문)
  lastImage: null,
  history: [],
  activeHistory: null,
};

/* ── 상태 표시 ─────────────────────────────────── */
function setStatus(text, kind = 'idle') {
  el.status.textContent = text;
  el.status.className = `status status-${kind}`;
}

function syncProviderBadge() {
  const cfg = activeConfig(settings);
  el.providerName.textContent = cfg.meta.label.split(' ')[0];
  el.providerModel.textContent = cfg.model;
  el.providerBadge.classList.toggle('badge-warn', !cfg.apiKey);
  el.providerBadge.title = cfg.apiKey
    ? `${cfg.meta.label} · ${cfg.model}`
    : `${cfg.meta.label} · API 키가 없습니다. 클릭해서 설정하세요.`;
}

/* ── 설정 UI ───────────────────────────────────── */
function fillModelOptions(provider, selected) {
  el.model.innerHTML = '';
  for (const m of PROVIDERS[provider].models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    el.model.append(opt);
  }
  // 저장된 모델이 목록에 없으면(직접 입력했던 값 등) 항목을 추가해 유지합니다.
  if (selected && ![...el.model.options].some((o) => o.value === selected)) {
    const opt = document.createElement('option');
    opt.value = selected;
    opt.textContent = `${selected} (사용자 지정)`;
    el.model.append(opt);
  }
  el.model.value = selected || PROVIDERS[provider].models[0].id;
}

function syncProviderFields() {
  const provider = el.providerPicker.querySelector('input:checked').value;
  const meta = PROVIDERS[provider];
  el.apiKey.value = settings.keys[provider] || '';
  el.apiKey.placeholder = meta.keyPlaceholder;
  el.keyLabel.textContent = `${meta.label} API 키`;
  el.keyLink.href = meta.keyUrl;
  el.endpoint.placeholder = meta.defaultEndpoint;
  el.endpoint.value = settings.endpoints[provider] || '';
  fillModelOptions(provider, settings.models[provider]);
  syncKeyFlags();
}

function syncKeyFlags() {
  for (const flag of el.settingsForm.querySelectorAll('.key-flag')) {
    const p = flag.dataset.flag;
    const saved = p === currentPickedProvider() ? el.apiKey.value.trim() : (settings.keys[p] || '').trim();
    flag.textContent = saved ? '키 저장됨' : '키 없음';
    flag.classList.toggle('ok', !!saved);
  }
}

function currentPickedProvider() {
  return el.providerPicker.querySelector('input:checked').value;
}

function openSettings() {
  if (el.settings.open) return;
  el.providerPicker.querySelector(`input[value="${settings.provider}"]`).checked = true;
  syncProviderFields();
  el.interval.value = settings.interval;
  el.sensitivity.value = settings.sensitivity;
  el.lang.value = settings.lang;
  el.extra.value = settings.extra;
  el.maxWidth.value = settings.maxWidth;
  syncRangeLabels();
  el.settings.showModal();
}

function syncRangeLabels() {
  el.intervalLabel.textContent = `${(el.interval.value / 1000).toFixed(2).replace(/0$/, '')}초`;
  const s = Number(el.sensitivity.value);
  el.sensLabel.textContent = s <= 3 ? '매우 예민' : s <= 8 ? '보통' : s <= 14 ? '둔감' : '매우 둔감';
  el.widthLabel.textContent = `${el.maxWidth.value}px`;
}

function persistSettingsFromForm() {
  const provider = currentPickedProvider();
  settings.provider = provider;
  settings.keys[provider] = el.apiKey.value.trim();
  settings.models[provider] = el.model.value;
  settings.endpoints[provider] = el.endpoint.value.trim();
  settings.interval = Number(el.interval.value);
  settings.sensitivity = Number(el.sensitivity.value);
  settings.lang = el.lang.value;
  settings.extra = el.extra.value;
  settings.maxWidth = Number(el.maxWidth.value);
  if (!saveSettings(settings)) {
    showError('설정을 브라우저에 저장하지 못했습니다. (시크릿 모드이거나 저장 공간이 가득 찼을 수 있습니다.) 이번 세션에서는 그대로 사용됩니다.');
  }
  syncProviderBadge();
  restartLoop();
  setStatus(
    !activeConfig(settings).apiKey ? 'API 키 필요' : capture.active ? '공유 중' : '대기 중',
    !activeConfig(settings).apiKey ? 'error' : capture.active ? 'live' : 'idle',
  );
}

/* ── 답변 렌더링 ───────────────────────────────── */
function renderAnswer(text, streaming) {
  const { answer, body } = splitFinalAnswer(text);
  const head = answer
    ? `<div class="final-answer"><span class="label">정답</span>${escapeText(answer)}</div>`
    : '';
  el.answer.innerHTML = head + renderMarkdown(body) + (streaming ? '<span class="caret"></span>' : '');
  el.answerScroll.scrollTop = el.answerScroll.scrollHeight;
}

function escapeText(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function showError(message) {
  const box = document.createElement('div');
  box.className = 'error-box';
  box.textContent = message;
  el.answer.prepend(box);
  el.answerScroll.scrollTop = 0;
}

/* ── 분석 실행 ─────────────────────────────────── */
async function solve({ followup = null } = {}) {
  if (state.busy) return;

  const cfg = activeConfig(settings);
  if (!cfg.apiKey) {
    setStatus('API 키 필요', 'error');
    el.autoMode.checked = false; // 키가 생길 때까지 자동 감지가 반복 호출되지 않도록
    el.answer.innerHTML = '';
    showError(`${cfg.meta.label} API 키가 없습니다. ⚙️ 설정에서 키를 입력하고 저장한 뒤 자동 감지를 다시 켜세요.`);
    openSettings();
    return;
  }

  let image = null;
  if (followup) {
    if (!state.turns.length) return;
    state.turns.push({ role: 'user', text: followup });
  } else {
    const dataUrl = capture.grab(settings.maxWidth);
    image = splitDataUrl(dataUrl);
    if (!image) {
      showError('화면 프레임을 캡처하지 못했습니다. 공유를 다시 시작해 보세요.');
      return;
    }
    state.lastImage = dataUrl;
    state.turns = [{ role: 'user', text: SOLVE_INSTRUCTION, image }];
    state.analyzedSig = capture.signature();
  }

  state.busy = true;
  state.controller = new AbortController();
  setStatus('분석 중…', 'busy');
  el.btnAbort.hidden = false;
  el.btnSolve.disabled = true;
  el.btnFollowup.disabled = true;

  let acc = '';
  renderAnswer('', true);

  try {
    const full = await streamCompletion({
      provider: cfg.provider,
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      system: buildSystemPrompt({ lang: settings.lang, detail: el.detail.value, extra: settings.extra }),
      turns: state.turns,
      signal: state.controller.signal,
      onDelta: (chunk) => {
        acc += chunk;
        renderAnswer(acc, true);
      },
    });

    state.turns.push({ role: 'assistant', text: full });
    renderAnswer(full, false);
    setStatus(capture.active ? '공유 중' : '대기 중', capture.active ? 'live' : 'idle');
    if (!followup) addHistory(state.lastImage, full);
    else updateActiveHistory(full);
    el.btnCopy.disabled = false;
    el.followup.disabled = false;
  } catch (err) {
    if (err.name === 'AbortError') {
      renderAnswer(acc + '\n\n_(중단됨)_', false);
      setStatus(capture.active ? '공유 중' : '대기 중', capture.active ? 'live' : 'idle');
    } else {
      renderAnswer(acc, false);
      showError(err.message || String(err));
      setStatus('오류', 'error');
    }
  } finally {
    state.busy = false;
    state.controller = null;
    el.btnAbort.hidden = true;
    el.btnSolve.disabled = !capture.active;
    el.btnFollowup.disabled = !state.turns.length;
  }
}

/* ── 자동 감지 루프 ─────────────────────────────── */
function restartLoop() {
  clearInterval(state.timer);
  if (!capture.active) return;
  state.timer = setInterval(tick, settings.interval);
}

function tick() {
  const sig = capture.signature();
  if (!sig) return;

  const changed = diffPercent(sig, state.lastSig);
  const sinceAnalyzed = diffPercent(sig, state.analyzedSig);
  state.lastSig = sig;

  const pct = Math.min(100, sinceAnalyzed * 4);
  el.meterFill.style.width = `${pct}%`;
  el.meterFill.classList.toggle('over', sinceAnalyzed >= settings.sensitivity);
  el.meterText.textContent = `${sinceAnalyzed.toFixed(1)}%`;

  if (!el.autoMode.checked || state.busy) return;

  // 이전 분석 대비 충분히 달라졌으면 "새 문제 후보"로 표시
  if (sinceAnalyzed >= settings.sensitivity) state.pendingChange = true;

  // 후보 상태에서 화면이 두 주기 연속 멈추면(스크롤/타이핑 종료) 분석
  if (state.pendingChange) {
    if (changed < 0.8) state.stableCount += 1;
    else state.stableCount = 0;

    if (state.stableCount >= 2) {
      state.pendingChange = false;
      state.stableCount = 0;
      el.autoNote.textContent = '새 화면을 감지해 분석했습니다.';
      solve();
    } else {
      el.autoNote.textContent = '변화 감지됨 — 화면이 멈추면 분석합니다…';
    }
  } else {
    el.autoNote.textContent = '변화가 감지되고 화면이 멈추면 자동으로 분석합니다.';
  }
}

/* ── 기록 ──────────────────────────────────────── */
function addHistory(dataUrl, text) {
  const item = { id: Date.now(), image: dataUrl, text, at: new Date() };
  state.history.unshift(item);
  state.history = state.history.slice(0, 24);
  state.activeHistory = item.id;
  drawHistory();
}

function updateActiveHistory(text) {
  const item = state.history.find((h) => h.id === state.activeHistory);
  if (item) item.text = text;
}

function drawHistory() {
  el.history.innerHTML = '';
  if (!state.history.length) {
    el.history.innerHTML = '<li class="history-empty muted">분석한 화면이 여기에 쌓입니다.</li>';
    return;
  }
  for (const h of state.history) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'history-item' + (h.id === state.activeHistory ? ' active' : '');
    const { answer } = splitFinalAnswer(h.text);
    btn.innerHTML =
      `<img alt="캡처 미리보기" src="${h.image}" />` +
      `<span class="history-meta"><strong>${escapeText(answer || '풀이')}</strong>` +
      `${h.at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>`;
    btn.addEventListener('click', () => {
      state.activeHistory = h.id;
      state.turns = [
        { role: 'user', text: SOLVE_INSTRUCTION, image: splitDataUrl(h.image) },
        { role: 'assistant', text: h.text },
      ];
      state.lastImage = h.image;
      renderAnswer(h.text, false);
      el.btnCopy.disabled = false;
      el.followup.disabled = false;
      el.btnFollowup.disabled = false;
      drawHistory();
    });
    li.append(btn);
    el.history.append(li);
  }
}

/* ── 영역 지정 ─────────────────────────────────── */
let cropDrag = null;

function videoRectInStage() {
  // object-fit: contain 이므로 실제 영상이 그려지는 영역을 계산합니다.
  const box = el.preview.getBoundingClientRect();
  const vw = el.preview.videoWidth || 16;
  const vh = el.preview.videoHeight || 9;
  const scale = Math.min(box.width / vw, box.height / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, w, h, scale };
}

el.cropLayer.addEventListener('pointerdown', (e) => {
  const r = videoRectInStage();
  cropDrag = { x: e.clientX, y: e.clientY, r };
  el.cropBox.hidden = false;
  el.cropLayer.setPointerCapture(e.pointerId);
});

el.cropLayer.addEventListener('pointermove', (e) => {
  if (!cropDrag) return;
  const stage = el.stage.getBoundingClientRect();
  const x1 = Math.min(cropDrag.x, e.clientX);
  const y1 = Math.min(cropDrag.y, e.clientY);
  const x2 = Math.max(cropDrag.x, e.clientX);
  const y2 = Math.max(cropDrag.y, e.clientY);
  Object.assign(el.cropBox.style, {
    left: `${x1 - stage.left}px`,
    top: `${y1 - stage.top}px`,
    width: `${x2 - x1}px`,
    height: `${y2 - y1}px`,
  });
});

el.cropLayer.addEventListener('pointerup', (e) => {
  if (!cropDrag) return;
  const { r } = cropDrag;
  const x1 = Math.min(cropDrag.x, e.clientX);
  const y1 = Math.min(cropDrag.y, e.clientY);
  const x2 = Math.max(cropDrag.x, e.clientX);
  const y2 = Math.max(cropDrag.y, e.clientY);
  cropDrag = null;
  endCropMode();

  if (x2 - x1 < 12 || y2 - y1 < 12) return; // 실수로 클릭한 경우
  capture.crop = {
    x: Math.round((x1 - r.left) / r.scale),
    y: Math.round((y1 - r.top) / r.scale),
    w: Math.round((x2 - x1) / r.scale),
    h: Math.round((y2 - y1) / r.scale),
  };
  el.btnCropClear.hidden = false;
  state.analyzedSig = null;
  state.lastSig = null;
  markCropBadge(true);
});

function startCropMode() {
  if (!capture.active) return;
  el.cropLayer.hidden = false;
  el.cropBox.hidden = true;
  el.cropBox.removeAttribute('style');
}

function endCropMode() {
  el.cropLayer.hidden = true;
  el.cropBox.hidden = true;
  el.cropBox.removeAttribute('style');
}

function markCropBadge(on) {
  let badge = el.stage.querySelector('.crop-active-badge');
  if (on && !badge) {
    badge = document.createElement('span');
    badge.className = 'crop-active-badge';
    badge.textContent = '영역 지정됨';
    el.stage.append(badge);
  } else if (!on && badge) {
    badge.remove();
  }
}

/* ── 이벤트 배선 ───────────────────────────────── */
el.btnShare.addEventListener('click', async () => {
  try {
    await capture.start();
    document.body.classList.add('sharing');
    el.btnStop.disabled = false;
    el.btnSolve.disabled = false;
    el.btnCrop.disabled = false;
    el.btnShare.disabled = true;
    el.meter.hidden = false;
    setStatus('공유 중', 'live');
    state.lastSig = capture.signature();
    state.analyzedSig = null;
    restartLoop();
  } catch (err) {
    if (err.name !== 'NotAllowedError') {
      showError(`화면 공유를 시작하지 못했습니다: ${err.message}`);
    }
    setStatus('대기 중', 'idle');
  }
});

function stopSharing() {
  capture.stop();
  clearInterval(state.timer);
  document.body.classList.remove('sharing');
  el.btnStop.disabled = true;
  el.btnSolve.disabled = true;
  el.btnCrop.disabled = true;
  el.btnShare.disabled = false;
  el.btnCropClear.hidden = true;
  el.meter.hidden = true;
  markCropBadge(false);
  endCropMode();
  setStatus('대기 중', 'idle');
}

el.btnStop.addEventListener('click', stopSharing);
capture.onEnded = stopSharing;

el.btnSolve.addEventListener('click', () => solve());
el.btnCrop.addEventListener('click', startCropMode);
el.btnCropClear.addEventListener('click', () => {
  capture.crop = null;
  el.btnCropClear.hidden = true;
  markCropBadge(false);
  state.analyzedSig = null;
});

el.btnAbort.addEventListener('click', () => state.controller?.abort());

el.btnCopy.addEventListener('click', async () => {
  const last = state.turns.filter((t) => t.role === 'assistant').pop();
  if (!last) return;
  try {
    await navigator.clipboard.writeText(last.text);
    el.btnCopy.textContent = '복사됨';
    setTimeout(() => { el.btnCopy.textContent = '복사'; }, 1200);
  } catch {
    showError('클립보드에 접근하지 못했습니다. 텍스트를 직접 선택해 복사하세요.');
  }
});

el.followupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = el.followup.value.trim();
  if (!q) return;
  el.followup.value = '';
  solve({ followup: q });
});

el.detail.addEventListener('change', () => {
  settings.detail = el.detail.value;
  saveSettings(settings);
});

el.autoMode.addEventListener('change', () => {
  settings.autoMode = el.autoMode.checked;
  saveSettings(settings);
  state.pendingChange = false;
  state.stableCount = 0;
});

el.btnClearHistory.addEventListener('click', () => {
  state.history = [];
  state.activeHistory = null;
  drawHistory();
});

el.btnSettings.addEventListener('click', openSettings);
el.providerBadge.addEventListener('click', openSettings);

el.providerPicker.addEventListener('change', () => {
  // 프로바이더를 바꿔도, 방금 입력 중이던 키는 잃지 않도록 먼저 담아 둡니다.
  const prev = el.apiKey.dataset.provider;
  if (prev && PROVIDERS[prev]) {
    settings.keys[prev] = el.apiKey.value.trim();
    settings.endpoints[prev] = el.endpoint.value.trim();
    if (el.model.value) settings.models[prev] = el.model.value;
  }
  syncProviderFields();
  el.apiKey.dataset.provider = currentPickedProvider();
});

el.apiKey.addEventListener('input', syncKeyFlags);

el.btnReveal.addEventListener('click', () => {
  el.apiKey.type = el.apiKey.type === 'password' ? 'text' : 'password';
});

el.btnForget.addEventListener('click', () => {
  const p = currentPickedProvider();
  el.apiKey.value = '';
  settings.keys[p] = '';
  saveSettings(settings);
  syncKeyFlags();
  syncProviderBadge();
});

el.settingsForm.addEventListener('submit', (e) => {
  if (e.submitter?.value === 'save') persistSettingsFromForm();
});

for (const r of [el.interval, el.sensitivity, el.maxWidth]) {
  r.addEventListener('input', syncRangeLabels);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.cropLayer.hidden) { endCropMode(); return; }
  if (el.settings.open) return;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (e.key === 'Enter' && !typing && capture.active && !state.busy) {
    e.preventDefault();
    solve();
  }
});

/* ── 초기화 ────────────────────────────────────── */
function init() {
  el.detail.value = settings.detail;
  el.autoMode.checked = settings.autoMode;
  el.apiKey.dataset.provider = settings.provider;
  syncProviderBadge();
  drawHistory();

  if (!navigator.mediaDevices?.getDisplayMedia) {
    el.btnShare.disabled = true;
    showError('이 브라우저는 화면 공유(getDisplayMedia)를 지원하지 않습니다. 데스크톱 Chrome, Edge, Firefox, Safari를 사용하세요.');
  }
  if (!activeConfig(settings).apiKey) {
    setStatus('API 키 필요', 'error');
  }
}

init();
