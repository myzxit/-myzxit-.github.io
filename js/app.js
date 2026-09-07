import {
  PROVIDERS, loadSettings, saveSettings, activeConfig, secureKeysAvailable,
  forgetAllKeys, modelOptions,
} from './store.js';
import { streamCompletion, testConnection } from './api.js';
import { probeProxy, proxyStatus, proxyHasKey, proxyNeedsCode } from './proxy.js';
import { loadNotes, addNote, removeNote, clearNotes, hasNote, notesSizeKb } from './wrongnotes.js';
import { Capture, SCREEN_SUPPORTED, CAMERA_SUPPORTED, diffPercent, splitDataUrl } from './capture.js';
import { renderMarkdown, splitFinalAnswer, parseSolution } from './markdown.js';
import {
  buildSystemPrompt, SOLVE_INSTRUCTION, ACTIONS,
  buildTranslatePrompt, TRANSLATE_INSTRUCTION, TRANSLATE_ACTIONS, TRANSLATE_LANGS,
} from './prompt.js';
import { checkArithmetic, verifyEquation, evaluate, pretty } from './calc.js';
import { saveHistory, loadHistory, clearHistory } from './history.js';
import {
  registerServiceWorker, takeSharedImage, onPastedImage, wireInstallButton,
} from './share.js';
import {
  IS_ANDROID_APP, androidBridge, bridgeMismatch, exposePublicApi, STATE_LABEL,
} from './android.js';

const $ = (id) => document.getElementById(id);

const el = {
  status: $('status'),
  providerBadge: $('provider-badge'),
  providerName: $('provider-name'),
  providerModel: $('provider-model'),
  sourceTabs: $('source-tabs'),
  stage: $('stage'),
  preview: $('preview'),
  still: $('still'),
  stageIcon: $('stage-icon'),
  stageTitle: $('stage-title'),
  stageDesc: $('stage-desc'),
  work: $('work'),
  thumb: $('thumb'),
  autoMode: $('auto-mode'),
  btnStart: $('btn-start'),
  btnStop: $('btn-stop'),
  btnFlip: $('btn-flip'),
  btnSolve: $('btn-solve'),
  btnCrop: $('btn-crop'),
  btnCropClear: $('btn-crop-clear'),
  filePhoto: $('file-photo'),
  cropLayer: $('crop-layer'),
  cropBox: $('crop-box'),
  cropHint: $('crop-hint'),
  btnSolveAll: $('btn-solve-all'),
  selectFirst: $('select-first'),
  meter: $('meter'),
  meterLabel: $('meter-label'),
  meterFill: $('meter-fill'),
  meterText: $('meter-text'),
  autoNote: $('auto-note'),
  answer: $('answer'),
  answerScroll: $('answer-scroll'),
  actions: $('result-actions'),
  subject: $('subject'),
  grade: $('grade'),
  detail: $('detail'),
  modeTabs: $('mode-tabs'),
  translateTo: $('translate-to'),
  btnNewSession: $('btn-new-session'),
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
  btnInstall: $('btn-install'),
  providerPicker: $('provider-picker'),
  apiKey: $('api-key'),
  keyLabel: $('key-label'),
  keyLink: $('key-link'),
  keyStorage: $('key-storage'),
  btnTestKey: $('btn-test-key'),
  keyTestResult: $('key-test-result'),
  proxyNote: $('proxy-note'),
  proxyCodeField: $('proxy-code-field'),
  proxyCode: $('proxy-code'),
  rememberKeys: $('remember-keys'),
  keyExpiry: $('key-expiry'),
  btnRefreshModels: $('btn-refresh-models'),
  customModel: $('custom-model'),
  btnAddModel: $('btn-add-model'),
  preferProxy: $('prefer-proxy'),
  debugMode: $('debug-mode'),
  btnTheme: $('btn-theme'),
  progress: $('progress'),
  viewTabs: $('view-tabs'),
  bottomNav: $('bottom-nav'),
  panelHistory: $('panel-history'),
  panelNotes: $('panel-notes'),
  notes: $('notes'),
  notesSize: $('notes-size'),
  btnClearNotes: $('btn-clear-notes'),
  historySearch: $('history-search'),
  historySubject: $('history-subject'),
  historySort: $('history-sort'),
  btnReveal: $('btn-reveal'),
  btnForget: $('btn-forget'),
  model: $('model'),
  endpoint: $('endpoint'),
  interval: $('interval'),
  intervalLabel: $('interval-label'),
  sensitivity: $('sensitivity'),
  sensLabel: $('sens-label'),
  stableMs: $('stable-ms'),
  stableLabel: $('stable-label'),
  cooldown: $('cooldown'),
  cooldownLabel: $('cooldown-label'),
  lang: $('lang'),
  extra: $('extra'),
  maxWidth: $('max-width'),
  widthLabel: $('width-label'),
};

/* 입력 소스별 문구와 자동 감지 보정값 */
const SOURCES = {
  screen: {
    start: '화면 공유 시작',
    stop: '공유 중지',
    icon: '🖥️',
    title: '화면 공유가 시작되지 않았습니다',
    desc: '<em>화면 공유 시작</em>을 눌러 문제가 보이는 탭·창·화면을 선택하세요.',
    translateTitle: '화면 공유가 시작되지 않았습니다',
    translateDesc: '<em>화면 공유 시작</em>을 눌러 번역할 탭·창·화면을 선택하세요. 화면이 바뀌면 자동으로 번역합니다.',
    meter: '화면 변화',
    live: true,
    stable: 0.8,     // 이보다 작게 움직이면 "멈춤"으로 봅니다
    changeMult: 1,   // 새 문제로 볼 변화량 배수
  },
  camera: {
    start: '카메라 켜기',
    stop: '카메라 끄기',
    icon: '📷',
    title: '카메라가 꺼져 있습니다',
    desc: '문제를 카메라로 비추고 잠깐 멈추면 자동으로 읽어서 풀어드립니다.',
    translateTitle: '카메라가 꺼져 있습니다',
    translateDesc: '번역할 글자를 카메라로 비추고 잠깐 멈추면 자동으로 번역합니다.',
    meter: '카메라 움직임',
    live: true,
    stable: 2.5,     // 손떨림·노이즈가 있으므로 여유를 둡니다
    changeMult: 2.2,
  },
  photo: {
    start: '사진 선택 / 촬영',
    icon: '🖼️',
    title: '사진이 선택되지 않았습니다',
    desc: '문제를 촬영하거나 갤러리에서 고르면 바로 풀이를 시작합니다.',
    translateTitle: '사진이 선택되지 않았습니다',
    translateDesc: '번역할 글자를 촬영하거나 갤러리에서 고르면 바로 번역합니다.',
    live: false,
  },
};

/*
 * 폰에서의 "화면 공유".
 * 모바일 브라우저는 자기 화면을 캡처할 수 없습니다(getDisplayMedia 미지원 — 젬의
 * 화면 공유는 네이티브 앱 권한입니다). 대신 스크린샷을 앱으로 공유하면 바로
 * 풀이하도록 안내합니다. 홈 화면에 설치해 두면 공유 메뉴에 앱이 나타납니다.
 */
const SCREEN_ON_MOBILE = {
  start: '스크린샷 불러오기',
  icon: '📱',
  title: '스크린샷을 보내면 바로 풀어드립니다',
  desc: `이 브라우저는 폰 화면을 직접 캡처할 수 없습니다. 대신:
    <ol class="howto">
      <li><strong>앱 설치</strong> — 위 <em>📲 앱 설치</em> 또는 브라우저 메뉴 → 홈 화면에 추가</li>
      <li>문제 화면에서 <strong>스크린샷</strong>을 찍고</li>
      <li>공유 메뉴에서 <strong>ScreenSolver</strong>를 고르면 자동으로 풀이합니다</li>
    </ol>
    아래 버튼으로 스크린샷을 직접 불러올 수도 있습니다.
    <br /><span class="muted small">화면을 켜 둔 채 실시간으로 분석하려면 ScreenSolver
    Android 앱이 필요합니다 (웹 브라우저는 폰 화면 캡처를 지원하지 않습니다).</span>
    <br /><a class="apk-link" href="dist/screensolver-debug.apk" download>📱 Android 앱 (APK) 내려받기</a>`,
  live: false,
};

/*
 * Android 앱 안에서의 화면 공유 — MediaProjection 으로 폰 전체 화면을 캡처합니다.
 * 웹 브라우저에는 없는 경로이며, 변화 감지·안정화·중복 판정은 네이티브가 합니다.
 */
const SCREEN_ON_ANDROID_APP = {
  start: '📱 내 화면 공유',
  stop: '공유 중지',
  icon: '📱',
  title: '내 화면을 공유해 문제를 풀어드립니다',
  desc: `<em>내 화면 공유</em>를 누르고 Android 권한창에서 허용한 뒤,
    문제가 있는 앱으로 이동하세요. 화면이 바뀌고 멈추면 자동으로 읽어서 풀이합니다.
    <br /><span class="muted small">공유 중에는 화면 내용이 선택한 AI로 전송될 수 있습니다.</span>`,
  translateTitle: '내 화면을 실시간으로 번역합니다',
  translateDesc: `<em>내 화면 공유</em>를 누르고 Android 권한창에서 허용한 뒤,
    번역할 앱으로 이동하세요. 화면이 바뀌고 멈추면 자동으로 읽어서 번역합니다.
    <br /><span class="muted small">공유 중에는 화면 내용이 선택한 AI로 전송될 수 있습니다.</span>`,
  meter: '화면 변화',
  live: false,     // JS 폴링 없음 — 네이티브가 판정합니다
  native: true,
};

/** 현재 소스의 표시 정보 (환경에 따라 화면 공유 화면이 달라집니다) */
function sourceInfo(name = state.source) {
  if (name === 'screen') {
    if (IS_ANDROID_APP) return SCREEN_ON_ANDROID_APP;
    if (!SCREEN_SUPPORTED) return SCREEN_ON_MOBILE;
  }
  return SOURCES[name];
}

/** 지금 Android 네이티브 화면 공유를 쓰는 소스인지 */
function isNativeScreen() {
  return IS_ANDROID_APP && state.source === 'screen';
}

/** 네이티브 화면 공유가 실제로 돌고 있는지 (첫 프레임 전이어도 true) */
function nativeSharing() {
  if (!IS_ANDROID_APP) return false;
  if (capture.mode === 'native') return true;
  try { return !!androidBridge.status().running; } catch { return false; }
}

let settings = loadSettings();
const capture = new Capture(el.preview, el.still, el.work, el.thumb);

const state = {
  source: 'screen',
  timer: null,
  lastSig: null,        // 직전 확인 프레임
  analyzedSig: null,    // 마지막으로 분석에 사용한 프레임
  stableCount: 0,
  pendingChange: false,
  lastSolveAt: 0,
  selectThenSolve: false,
  nativeMeter: null,
  frameTimer: null,
  busy: false,
  controller: null,
  turns: [],
  session: [],          // 이번 세션에서 푼 문제들의 요약 (다음 질문의 문맥)
  pendingFollowup: null,
  awaitingNetwork: false,
  lastImage: null,
  lastDebug: null,
  history: [],
  activeHistory: null,
};

/* ── 화면 테마 (§36) ───────────────────────────── */
const THEME_ORDER = ['system', 'dark', 'light'];
const THEME_ICON = { system: '⚙️', dark: '🌙', light: '☀️' };
const THEME_NAME = { system: '시스템 설정', dark: '다크', light: '라이트' };

function applyTheme() {
  const t = THEME_ORDER.includes(settings.theme) ? settings.theme : 'system';
  // system 이면 속성을 지워 prefers-color-scheme 가 그대로 동작하게 둡니다.
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  if (el.btnTheme) {
    el.btnTheme.textContent = THEME_ICON[t];
    el.btnTheme.title = `화면 테마: ${THEME_NAME[t]} (눌러서 변경)`;
    el.btnTheme.setAttribute('aria-label', `화면 테마 ${THEME_NAME[t]}. 눌러서 변경`);
  }
}

/* ── 풀이 진행 단계 (§20) ──────────────────────── */
const PROGRESS_STEPS = ['image', 'read', 'solve', 'verify', 'done'];

function setProgress(step) {
  if (!el.progress) return;
  if (!step) { el.progress.hidden = true; return; }
  el.progress.hidden = false;
  const at = PROGRESS_STEPS.indexOf(step);
  for (const node of el.progress.querySelectorAll('.progress-step')) {
    const i = PROGRESS_STEPS.indexOf(node.dataset.step);
    node.classList.toggle('done', i < at);
    node.classList.toggle('now', i === at);
  }
}

/* ── 동작 모드 — 풀이 / 화면 번역 ───────────────
 *
 * 화면 공유를 켜 두면 화면이 바뀔 때마다 자동으로 처리하는데, 번역 모드에서는
 * 그 자동 처리가 "풀이" 대신 "번역" 이 됩니다. 캡처·변화 감지·안정화·쿨다운은
 * 그대로 쓰므로 실시간 번역이 됩니다.
 */

function isTranslateMode() {
  return settings.mode === 'translate';
}

/** 이번 요청에 쓸 시스템 프롬프트 */
function currentSystemPrompt() {
  if (isTranslateMode()) {
    return buildTranslatePrompt({ target: settings.translateTo, extra: settings.extra });
  }
  return buildSystemPrompt({
    lang: settings.lang,
    detail: el.detail.value,
    extra: settings.extra,
    subject: settings.subject,
    grade: settings.grade,
  });
}

/** 이번 요청에 쓸 사용자 지시문 */
function currentInstruction() {
  return isTranslateMode() ? TRANSLATE_INSTRUCTION : SOLVE_INSTRUCTION;
}

function applyMode() {
  const translate = isTranslateMode();
  document.body.dataset.task = settings.mode;

  for (const b of el.modeTabs.querySelectorAll('[data-mode]')) {
    b.setAttribute('aria-selected', String(b.dataset.mode === settings.mode));
  }
  // 풀이 수준은 번역에 의미가 없고, 번역 언어는 풀이에 의미가 없습니다.
  el.detail.hidden = translate;
  el.translateTo.hidden = !translate;
  el.translateTo.value = settings.translateTo || 'ko';

  el.followup.placeholder = translate
    ? '이어서 질문하기 (예: 두 번째 줄만 다시 번역해줘)'
    : '이어서 질문하기 (예: 3번만 다시 설명해줘)';

  buildResultActions();   // 모드에 맞는 버튼으로 다시 만듭니다
  syncSourceUI();         // "지금 풀기" → "지금 번역" 등
}

/* ── 보기 방식 탭 (§10) ────────────────────────── */
/** 'answer' | 'steps' | 'full' */
let viewMode = 'full';

function applyViewMode() {
  document.body.dataset.view = viewMode;
  if (!el.viewTabs) return;
  for (const b of el.viewTabs.querySelectorAll('[data-view]')) {
    b.setAttribute('aria-selected', String(b.dataset.view === viewMode));
  }
}

/* ── 상태 표시 ─────────────────────────────────── */
function setStatus(text, kind = 'idle') {
  el.status.textContent = text;
  el.status.className = `status status-${kind}`;
}

function idleStatus() {
  if (navigator.onLine === false) return setStatus('오프라인', 'error');
  if (!activeConfig(settings).ready) return setStatus('AI 설정 필요', 'error');
  if (capture.mode === 'screen') return setStatus('공유 중', 'live');
  if (capture.mode === 'camera') return setStatus('카메라 켜짐', 'live');
  if (capture.mode === 'photo') return setStatus('사진 준비됨', 'live');
  if (capture.mode === 'native') return setStatus('🔴 화면 공유 중', 'live');
  setStatus('대기 중', 'idle');
}

function syncProviderBadge() {
  const cfg = activeConfig(settings);
  el.providerName.textContent = cfg.meta.label.split(' ')[0];
  el.providerModel.textContent = cfg.model;
  el.providerBadge.classList.toggle('badge-warn', !cfg.ready);
  el.providerBadge.title = cfg.ready
    ? `${cfg.meta.label} · ${cfg.model}${cfg.useProxy ? ' · 서버 키 사용' : ''}`
    : `${cfg.meta.label} · API 키가 없습니다. 눌러서 설정하세요.`;
}

/* ── 입력 소스 ─────────────────────────────────── */
function setSource(name, { silent = false } = {}) {
  if (!SOURCES[name]) return;
  // 첫 프레임 전에는 capture.mode 가 'idle' 이지만 네이티브 캡처는 이미 돌고
  // 있을 수 있습니다. 탭을 바꾸면 반드시 함께 멈춰야 합니다.
  if (capture.active || nativeSharing()) stopCapture({ keepStatus: true });
  state.source = name;

  for (const tab of el.sourceTabs.children) {
    const on = tab.dataset.source === name;
    tab.setAttribute('aria-selected', String(on));
  }

  syncSourceUI();

  if (!silent) settings.source = name;
  saveSettings(settings);
  syncStageMode();
}

/**
 * 입력 소스 화면의 문구·버튼을 지금 상태에 맞춰 다시 씁니다.
 * 소스를 바꿀 때뿐 아니라 모드(풀이/번역)를 바꿀 때도 부릅니다.
 */
function syncSourceUI() {
  const s = sourceInfo(state.source);
  const translate = isTranslateMode();

  el.btnStart.textContent = s.start;
  el.btnStop.textContent = s.stop || '중지';
  el.btnStop.hidden = !(s.live || s.native);
  el.btnFlip.hidden = state.source !== 'camera';
  el.stageIcon.textContent = s.icon;

  // 번역 모드에서는 같은 화면이 "번역" 을 설명해야 합니다.
  el.stageTitle.textContent = translate && s.translateTitle ? s.translateTitle : s.title;
  el.stageDesc.innerHTML = translate && s.translateDesc ? s.translateDesc : s.desc;

  el.meterLabel.textContent = s.meter || '';
  el.autoNote.textContent = idleNote();
  el.autoMode.closest('.switch').hidden = !(s.live || s.native);

  // "지금 풀기" 는 번역 모드에서 "지금 번역" 이 됩니다. (Enter 힌트는 유지)
  const kbd = el.btnSolve.querySelector('kbd');
  el.btnSolve.textContent = translate ? '지금 번역 ' : '지금 풀기 ';
  if (kbd) el.btnSolve.append(kbd);
}

function syncStageMode() {
  document.body.dataset.mode = capture.mode;
}

/** 네이티브 화면 공유 중 안내 — 모드에 따라 달라집니다. */
function nativeIdleNote() {
  return isTranslateMode()
    ? '번역할 앱으로 이동하면 화면이 바뀔 때마다 자동으로 번역합니다.'
    : '문제 화면으로 이동하면 자동으로 읽어서 풀이합니다.';
}

function idleNote() {
  if (isTranslateMode()) {
    return state.source === 'camera'
      ? '글자를 비추고 잠깐 멈추면 자동으로 번역합니다.'
      : '화면이 바뀌고 멈추면 자동으로 번역합니다.';
  }
  return state.source === 'camera'
    ? '문제를 비추고 잠깐 멈추면 자동으로 분석합니다.'
    : '변화가 감지되고 화면이 멈추면 자동으로 분석합니다.';
}

/* ── 설정 UI ───────────────────────────────────── */
function fillModelOptions(provider, selected) {
  el.model.innerHTML = '';
  for (const m of modelOptions(settings, provider)) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    el.model.append(opt);
  }
  if (selected && ![...el.model.options].some((o) => o.value === selected)) {
    const opt = document.createElement('option');
    opt.value = selected;
    opt.textContent = `${selected} (사용자 지정)`;
    el.model.append(opt);
  }
  el.model.value = selected || PROVIDERS[provider].models[0].id;
}

/**
 * 설정 창에서 지금 고른 프로바이더.
 * 설정 창을 한 번도 열지 않았으면 체크된 라디오가 없으므로, 저장된 설정을 씁니다.
 */
function currentPickedProvider() {
  const picked = el.providerPicker.querySelector('input:checked');
  return picked ? picked.value : (PROVIDERS[settings.provider] ? settings.provider : 'claude');
}

function syncProviderFields() {
  const provider = currentPickedProvider();
  const meta = PROVIDERS[provider];
  el.apiKey.value = settings.keys[provider] || '';
  el.apiKey.placeholder = meta.keyPlaceholder;
  el.keyLabel.textContent = `${meta.label} API 키`;
  el.keyLink.href = meta.keyUrl;
  el.endpoint.placeholder = meta.defaultEndpoint;
  el.endpoint.value = settings.endpoints[provider] || '';
  fillModelOptions(provider, settings.models[provider]);
  syncKeyFlags();
  syncKeyStorageNote();
  syncProxyNote();
}

/** 서버 프록시를 쓸 수 있는지 설정 화면에 그대로 알려 줍니다 (§2B). */
function syncProxyNote() {
  if (!el.proxyNote) return;
  const provider = currentPickedProvider();
  const status = proxyStatus();
  if (!status.proxy) { el.proxyNote.hidden = true; return; }

  el.proxyNote.hidden = false;
  el.proxyCodeField.hidden = !proxyNeedsCode();
  if (proxyHasKey(provider)) {
    el.proxyNote.className = 'muted ok';
    el.proxyNote.textContent = settings.preferProxy !== false
      ? '🔒 이 서버에 키가 설정되어 있어, 키를 입력하지 않아도 사용할 수 있습니다. 키는 서버에만 있고 브라우저로 내려오지 않습니다.'
      : '🔒 이 서버에 키가 있지만 "서버로 요청"이 꺼져 있어 직접 입력한 키를 씁니다.';
  } else {
    el.proxyNote.className = 'muted';
    el.proxyNote.textContent = status.enabled
      ? '이 서버에는 이 프로바이더의 키가 없습니다. 직접 입력한 키로 동작합니다.'
      : '이 서버는 공용 AI 사용이 꺼져 있습니다. 직접 입력한 키로 동작합니다.';
  }
}

/** 키가 실제로 어디에 저장되는지 그대로 알려 줍니다. */
function syncKeyStorageNote() {
  if (!el.keyStorage) return;
  el.keyStorage.textContent = secureKeysAvailable()
    ? '키는 Android Keystore 로 암호화해 이 기기에만 저장됩니다. 프로바이더별로 각각 보관됩니다.'
    : '키는 이 브라우저(localStorage)에만 저장되고 프로바이더별로 각각 보관됩니다.';
  el.keyStorage.classList.toggle('ok', secureKeysAvailable());
}

function syncKeyFlags() {
  for (const flag of el.settingsForm.querySelectorAll('.key-flag')) {
    const p = flag.dataset.flag;
    const saved = p === currentPickedProvider()
      ? el.apiKey.value.trim()
      : (settings.keys[p] || '').trim();
    flag.textContent = saved ? '키 저장됨' : '키 없음';
    flag.classList.toggle('ok', !!saved);
  }
}

function openSettings() {
  if (el.settings.open) return;
  // 저장값이 손상돼도 설정 창은 반드시 열려야 합니다(여기서 고칠 수 있으므로).
  const picked = el.providerPicker.querySelector(`input[value="${settings.provider}"]`)
    || el.providerPicker.querySelector('input[name="provider"]');
  picked.checked = true;
  settings.provider = picked.value;
  el.apiKey.dataset.provider = settings.provider;
  syncProviderFields();
  el.interval.value = settings.interval;
  el.sensitivity.value = settings.sensitivity;
  el.stableMs.value = settings.stableMs;
  el.cooldown.value = settings.cooldown;
  el.lang.value = settings.lang;
  el.subject.value = settings.subject;
  el.grade.value = settings.grade;
  el.extra.value = settings.extra;
  el.maxWidth.value = settings.maxWidth;
  el.rememberKeys.checked = settings.rememberKeys !== false;
  el.keyExpiry.value = String(settings.keyExpiryHours || 0);
  el.preferProxy.checked = settings.preferProxy !== false;
  el.debugMode.checked = Boolean(settings.debug);
  el.proxyCode.value = settings.proxyCode || '';
  el.keyTestResult.textContent = '';
  el.keyTestResult.className = 'test-result';
  syncProxyNote();
  syncRangeLabels();
  el.settings.showModal();
}

function syncRangeLabels() {
  const sec = (ms) => `${(ms / 1000).toFixed(2).replace(/0$/, '').replace(/\.$/, '')}초`;
  el.intervalLabel.textContent = sec(el.interval.value);
  el.stableLabel.textContent = sec(el.stableMs.value);
  el.cooldownLabel.textContent = sec(el.cooldown.value);
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
  settings.stableMs = Number(el.stableMs.value);
  settings.cooldown = Number(el.cooldown.value);
  settings.lang = el.lang.value;
  settings.subject = el.subject.value;
  settings.grade = el.grade.value;
  settings.extra = el.extra.value;
  settings.maxWidth = Number(el.maxWidth.value);
  settings.rememberKeys = el.rememberKeys.checked;
  settings.keyExpiryHours = Number(el.keyExpiry.value) || 0;
  settings.preferProxy = el.preferProxy.checked;
  settings.debug = el.debugMode.checked;
  settings.proxyCode = el.proxyCode.value.trim();
  // 저장을 끄면 이미 저장돼 있던 키도 기기에서 지웁니다 (§39).
  if (!settings.rememberKeys) delete settings.keysSavedAt;
  if (!saveSettings(settings)) {
    showError('설정을 브라우저에 저장하지 못했습니다. (시크릿 모드이거나 저장 공간이 가득 찼을 수 있습니다.) 이번 세션에서는 그대로 사용됩니다.');
  }
  syncProviderBadge();
  restartLoop();
  if (IS_ANDROID_APP) androidBridge.setConfig(nativeConfig());
  idleStatus();
}

/* ── 답변 렌더링 ───────────────────────────────── */

/** 결과 복사 버튼. 필요한 부분만 골라 복사할 수 있게 나눠 둡니다. */
const COPY_BUTTONS = [
  {
    key: 'answer',
    label: '📋 정답만',
    translateLabel: '📋 번역만',
    what: '정답',
    pick: (s) => s.translation || answerText(s),
  },
  {
    key: 'steps',
    label: '📋 풀이과정만',
    translateLabel: '📋 원문만',
    what: '풀이과정',
    pick: (s) => s.original || solutionSteps(s),
  },
  {
    key: 'all',
    label: '📋 전체',
    what: '답변',
    // 형식을 따르지 않은 응답도 있으므로, 정리할 게 없으면 원문을 그대로 씁니다.
    pick: (s, raw) => {
      const parts = [
        s.translation && `[번역]\n${s.translation}`,
        s.original && `\n[원문]\n${s.original}`,
        s.vocab && `\n[단어]\n${s.vocab}`,
        s.question && `문제: ${s.question}`,
        s.answer && `정답: ${s.answer}`,
        s.filled && `완성: ${s.filled}`,
        solutionSteps(s) && `\n[풀이과정]\n${solutionSteps(s)}`,
        s.check && `\n[검산]\n${s.check}`,
        s.oneline && `\n한 줄 정리: ${s.oneline}`,
      ].filter(Boolean);
      return parts.length ? parts.join('\n') : raw;
    },
  },
];
/**
 * 결과 아래 액션 버튼을 만듭니다 (§25, §27, §59, §61, §62).
 * 모두 실제 후속 요청을 보내며, 현재 문제와 풀이 문맥을 그대로 유지합니다.
 */
function buildResultActions() {
  el.actions.innerHTML = '';
  const actions = isTranslateMode() ? TRANSLATE_ACTIONS : ACTIONS;
  for (const [key, action] of Object.entries(actions)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn action-btn';
    btn.textContent = action.label;
    btn.dataset.action = key;
    btn.addEventListener('click', () => {
      if (state.busy) return;
      solve({ followup: action.prompt });
    });
    el.actions.append(btn);
  }
  // 복사는 필요한 만큼만 — 정답만 / 풀이과정만 / 전체
  for (const copy of COPY_BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn action-btn copy-btn';
    const label = (isTranslateMode() && copy.translateLabel) || copy.label;
    btn.textContent = label;
    btn.dataset.copy = copy.key;
    btn.addEventListener('click', async () => {
      const last = state.turns.filter((t) => t.role === 'assistant').pop();
      if (!last) return;
      const text = copy.pick(parseSolution(last.text).sections, last.text).trim();
      if (!text) {
        showError(`${label.replace(/^📋\s*/, '')} 내용이 이번 답변에는 없습니다.`);
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '복사됨';
        setTimeout(() => { btn.textContent = label; }, 1200);
      } catch {
        showError('클립보드에 접근하지 못했습니다.');
      }
    });
    el.actions.append(btn);
  }

  // 오답노트에 담기 (§25) — 지금 보고 있는 풀이를 그대로 저장합니다.
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn action-btn';
  save.textContent = '📕 오답노트';
  save.addEventListener('click', () => {
    const last = state.turns.filter((t) => t.role === 'assistant').pop();
    if (!last) return;
    const { sections } = parseSolution(last.text);
    const item = state.history.find((h) => h.id === state.activeHistory);
    const id = state.activeHistory || Date.now();

    if (hasNote(id)) {
      removeNote(id);
      save.textContent = '📕 오답노트';
      drawNotes();
      return;
    }
    const ok = addNote({
      id,
      question: sections.question || sections.original || '',
      answer: sections.answer || sections.translation || '',
      solution: last.text,
      subject: guessSubject(last.text),
      thumb: item?.thumb || null,
    });
    save.textContent = ok ? '📕 담김 ✓' : '📕 저장 실패';
    if (ok) { showNotesPanel(true); }
    setTimeout(() => { save.textContent = hasNote(id) ? '📕 담김 ✓' : '📕 오답노트'; }, 1500);
  });
  el.actions.append(save);
}

/* 결과 화면 구성 (§57, §58) — 접을 수 있는 섹션들 */
const RESULT_SECTIONS = [
  // 화면 번역 모드
  { key: 'original', icon: '📄', title: '원문', open: true },
  { key: 'vocab', icon: '🔤', title: '단어·표현', open: true },
  { key: 'conditions', icon: '🧩', title: '주어진 조건', open: true },
  { key: 'target', icon: '❓', title: '구해야 하는 것', open: true },
  { key: 'concept', icon: '💡', title: '핵심 개념', open: true },
  { key: 'formula', icon: '📐', title: '공식', open: true },
  { key: 'steps', icon: '📝', title: '단계별 풀이', open: true },
  { key: 'summary', icon: '📄', title: '풀이과정 요약', open: true },
  { key: 'check', icon: '🔎', title: '검산', open: true },
  { key: 'easy', icon: '💬', title: '쉽게 설명하면', open: true },
  { key: 'caution', icon: '⚠️', title: '실수하기 쉬운 부분', open: false },
  { key: 'choices', icon: '🔢', title: '선택지 분석', open: false },
];

const CONFIDENCE_CLASS = { '높음': 'high', '보통': 'mid', '확인필요': 'low' };

/**
 * AI 가 말한 계산을 앱이 직접 다시 계산합니다 (§30~§32).
 * AI 의 주장과 무관하게 독립적으로 확인하는 것이 요점입니다.
 */
function runCalculationCheck(sections) {
  const notes = [];
  // 검증 줄에서 알아낸 변수 값. 풀이 본문의 `3x = 9` 같은 줄도 이 값으로 확인합니다.
  const vars = {};

  // 1) 방정식이면 답을 원래 식에 대입해 검산합니다.
  const verify = sections.verify;
  if (verify) {
    const [equation, assignment] = verify.split('|').map((p) => p.trim());
    const m = (assignment || '').match(/^([a-zA-Zα-ω])\s*=\s*(.+)$/);
    if (equation && m) {
      const value = evaluate(m[2]);
      if (value !== null) vars[m[1]] = value;
      const result = verifyEquation(equation, m[1], m[2]);
      if (result) {
        notes.push({
          ok: result.ok,
          text: result.ok
            ? `${m[1]} = ${m[2]} 을 ${equation} 에 대입 → 양변 모두 ${pretty(result.left)} · 검산 통과`
            : `${m[1]} = ${m[2]} 을 대입하면 ${pretty(result.left)} ≠ ${pretty(result.right)} · 답이 맞지 않습니다`,
        });
      }
    }
  }

  // 2) 풀이·검산 본문의 숫자 등식을 한 줄씩 다시 계산합니다.
  const body = [sections.steps, sections.check].filter(Boolean).join('\n');
  const wrong = checkArithmetic(body, vars).filter((c) => !c.ok);
  for (const c of wrong.slice(0, 3)) {
    notes.push({ ok: false, text: `계산이 맞지 않습니다 — ${c.line} (${pretty(c.left)} ≠ ${pretty(c.right)})` });
  }
  return notes;
}

function sectionHtml({ key, icon, title, open }, content) {
  return `<details class="sol-section" data-key="${key}"${open ? ' open' : ''}>`
    + `<summary><span class="sol-icon">${icon}</span>${title}</summary>`
    + `<div class="sol-body">${renderMarkdown(content)}</div></details>`;
}

/**
 * 풀이과정만 뽑아냅니다.
 * `요약:` 이 있으면 그것을, 없으면 단계별 풀이를 씁니다.
 */
function solutionSteps(sections) {
  return sections.summary || sections.steps || '';
}

/** 정답 줄 (빈칸 문제면 채운 문장도 함께) */
function answerText(sections) {
  return [sections.answer, sections.filled && `완성: ${sections.filled}`]
    .filter(Boolean).join('\n');
}

/**
 * 맨 아래 최종 정리 카드 — 정답 → 풀이과정 → 정답(재확인).
 * 답이 없으면 만들지 않습니다.
 */
function finalCardHtml(sections) {
  const answer = sections.answer;
  if (!answer) return '';

  const steps = solutionSteps(sections);
  const oneline = sections.oneline;

  // 앱이 직접 검산한 결과가 있으면 재확인 줄에 함께 보여 줍니다.
  const notes = runCalculationCheck(sections);
  const verdict = notes.length
    ? (notes.every((n) => n.ok)
      ? '<span class="recheck ok">✓ 앱 검산 통과</span>'
      : '<span class="recheck bad">⚠ 앱 검산에서 어긋남</span>')
    : '';

  return '<section class="final-card">'
    + '<h3 class="final-card-title">📌 최종 정리</h3>'
    + '<dl>'
    + `<dt>정답</dt><dd class="fc-answer">${escapeText(answer)}</dd>`
    + (sections.filled ? `<dt>빈칸 완성</dt><dd>${escapeText(sections.filled)}</dd>` : '')
    + (steps ? `<dt>풀이과정</dt><dd class="fc-steps">${renderMarkdown(steps)}</dd>` : '')
    + (oneline ? `<dt>한 줄 정리</dt><dd>${escapeText(oneline)}</dd>` : '')
    + `<dt>정답</dt><dd class="fc-answer">${escapeText(answer)}${verdict}</dd>`
    + '</dl></section>';
}

function renderAnswer(text, streaming) {
  const { sections, body } = parseSolution(text);
  const has = (k) => sections[k] && sections[k].length;

  let html = '';

  if (has('question')) {
    html += `<div class="read-question"><span class="label">읽은 문제</span>${escapeText(sections.question)}</div>`;
  }
  // 번역 모드의 결과는 정답과 같은 자리에 크게 보여 줍니다.
  if (has('translation')) {
    const conf = sections.confidence;
    const badge = conf
      ? `<span class="confidence ${CONFIDENCE_CLASS[conf] || 'mid'}">확신도 ${escapeText(conf)}</span>`
      : '';
    const to = TRANSLATE_LANGS[settings.translateTo] || '한국어';
    html += `<div class="final-answer translated"><span class="label">🌐 ${escapeText(to)}${badge}</span>`
      + `${renderMarkdown(sections.translation)}</div>`;
  }
  if (has('answer')) {
    const conf = sections.confidence;
    const badge = conf
      ? `<span class="confidence ${CONFIDENCE_CLASS[conf] || 'mid'}">확신도 ${escapeText(conf)}</span>`
      : '';
    html += `<div class="final-answer"><span class="label">🎯 정답${badge}</span>${escapeText(sections.answer)}</div>`;
  }
  if (has('filled')) {
    html += `<div class="filled-in"><span class="label">빈칸을 채우면</span>${escapeText(sections.filled)}</div>`;
  }

  // 앱이 직접 계산한 검증 결과. 스트리밍이 끝난 뒤에만 판정합니다.
  if (!streaming) {
    for (const note of runCalculationCheck(sections)) {
      html += `<div class="calc-note ${note.ok ? 'ok' : 'bad'}">`
        + `<span class="label">${note.ok ? '✓ 앱이 직접 검산했습니다' : '⚠ 앱이 계산을 다시 해보니 어긋납니다'}</span>`
        + `${escapeText(note.text)}</div>`;
    }
  }

  for (const spec of RESULT_SECTIONS) {
    if (has(spec.key)) html += sectionHtml(spec, sections[spec.key]);
  }

  if (body) html += renderMarkdown(body);

  // 맨 아래 최종 정리 — 길게 스크롤한 뒤에도 답을 다시 볼 수 있게 합니다.
  if (!streaming) html += finalCardHtml(sections);

  if (streaming) html += '<span class="caret"></span>';

  el.answer.innerHTML = html;
  // 형식을 따르지 않은 자유 형식 답변에도 "왜?"·"전체 복사"는 그대로 쓸 수 있어야
  // 하므로, 내용이 있으면 버튼을 보여 줍니다.
  el.actions.hidden = streaming || !String(text || '').trim();
  // 보기 방식 탭은 구조화된 풀이가 있을 때만 의미가 있습니다 (§10).
  el.viewTabs.hidden = streaming || !(has('answer') && (has('steps') || has('summary')));
  el.answerScroll.scrollTop = streaming ? el.answerScroll.scrollHeight : 0;
}

function escapeText(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/**
 * 오류를 보여 줍니다. 원본 API 오류 JSON 은 그대로 노출하지 않고 (§32),
 * 디버그 모드일 때만 접어서 덧붙입니다 (§60).
 */
function showError(message, err) {
  const box = document.createElement('div');
  box.className = 'error-box';
  box.textContent = message;

  if (settings.debug && err?.detail) {
    const more = document.createElement('details');
    more.className = 'error-detail';
    const sum = document.createElement('summary');
    sum.textContent = `디버그 정보 (상태 ${err.status ?? '-'})`;
    const pre = document.createElement('pre');
    pre.textContent = err.detail;      // 키는 api.js 에서 이미 제외됩니다
    more.append(sum, pre);
    box.append(more);
  }

  // 다시 시도 버튼 (§33) — 마지막 요청을 그대로 한 번 더 보냅니다.
  if (state.turns.length && !state.busy) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn retry-btn';
    retry.textContent = '다시 시도';
    retry.addEventListener('click', () => {
      box.remove();
      runAnalysis();
    });
    box.append(retry);
  }

  el.answer.prepend(box);
  el.answerScroll.scrollTop = 0;
}

/** 디버그 한 줄 (§60) — 키·개인정보·이미지는 절대 넣지 않습니다. */
function showDebugLine() {
  const d = state.lastDebug;
  if (!d) return;
  const line = document.createElement('div');
  line.className = 'debug-line';
  line.textContent = `🐞 ${d.provider} · ${d.model}`
    + `${d.viaProxy ? ' · 서버 프록시' : ' · 직접 호출'}`
    + ` · ${d.ms}ms · ${d.chars}자`;
  el.answer.append(line);
}

/* 모바일에서는 풀이 패널이 화면 아래에 있으므로 결과로 스크롤해 줍니다. */
function revealAnswer() {
  if (window.matchMedia('(max-width: 940px)').matches) {
    document.querySelector('.panel-answer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* ── 네트워크 ──────────────────────────────────── */
//
// AI 풀이는 인터넷이 반드시 필요합니다(완전 오프라인 풀이는 불가능).
// 와이파이가 없어도 모바일 데이터로 동작해야 하고, 신호가 끊겼다 돌아오면
// 사용자가 다시 캡처하지 않고 이어서 풀 수 있어야 합니다.

function isNetworkError(err) {
  return err?.offline === true
    || err?.name === 'NetworkError'
    || /failed to fetch|load failed|networkerror|network request failed/i.test(err?.message || '');
}

/** 왜 연결이 안 되는지 가능한 만큼 구체적으로 알려 줍니다. */
async function networkHint() {
  if (navigator.onLine === false) {
    return '인터넷에 연결되어 있지 않습니다. 와이파이 또는 모바일 데이터를 켜 주세요.';
  }
  const net = IS_ANDROID_APP ? androidBridge.network() : null;
  if (net?.dataSaver && net?.metered) {
    return '모바일 데이터에서 이 앱의 백그라운드 데이터가 제한되어 있습니다.\n'
      + '설정 → 네트워크 → 데이터 절약에서 ScreenSolver 의 데이터 사용을 허용해 주세요.';
  }
  if (net && !net.online) {
    return '네트워크에 연결되어 있지 않습니다. 와이파이나 모바일 데이터를 확인해 주세요.';
  }
  return '서버에 연결하지 못했습니다. 신호가 약하거나 잠시 끊긴 것 같습니다.';
}

/** 연결 문제를 알리고 [다시 시도] 를 제공합니다. 화면 공유는 그대로 둡니다. */
function showNetworkError(message) {
  setStatus('오프라인', 'error');
  const box = document.createElement('div');
  box.className = 'error-box';
  box.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn-primary retry-btn';
  retry.textContent = '다시 시도';
  retry.addEventListener('click', () => { box.remove(); runAnalysis(); });
  box.append(retry);
  el.answer.prepend(box);
  el.answerScroll.scrollTop = 0;
  state.awaitingNetwork = true;   // 연결이 돌아오면 자동으로 이어서 시도
}

/* ── 세션 기억 ─────────────────────────────────── */
//
// 화면 공유를 새로 시작하기 전까지는 이번 세션에서 푼 문제를 모두 기억해서,
// "지금까지 정답 알려줘" 같은 질문에 답하고 앞 문제를 참고할 수 있게 합니다.
// 다만 지난 문제의 이미지까지 매번 다시 보내면 비용과 지연이 급격히 늘어나므로,
// 이미지는 현재 문제만 보내고 앞 문제들은 `문제/정답` 요약 텍스트로만 넣습니다.

const SESSION_LIMIT = 30;

/** 답변에서 다음 문맥으로 남길 부분만 뽑아냅니다. */
function summarizeSolved(text) {
  const { question, answer, filled } = splitFinalAnswer(text);
  const head = [
    question ? `문제: ${question}` : null,
    answer ? `정답: ${answer}` : null,
    filled ? `완성: ${filled}` : null,
  ].filter(Boolean).join('\n');
  return head || (text || '').slice(0, 400);
}

/** 앞서 푼 문제들을 대화 형식(user/assistant 교대)으로 만듭니다. */
function sessionTurns() {
  const turns = [];
  state.session.forEach((item, i) => {
    turns.push({ role: 'user', text: `(이번 세션에서 ${i + 1}번째로 푼 문제)` });
    turns.push({ role: 'assistant', text: item.summary });
  });
  return turns;
}

function rememberSolved(text) {
  state.session.push({ summary: summarizeSolved(text) });
  if (state.session.length > SESSION_LIMIT) state.session.shift();
  syncSessionBadge();
  persist();
}

/** 기록과 세션 기억을 저장합니다. 실패해도 앱 동작에는 영향을 주지 않습니다. */
function persist() {
  saveHistory(state.history, state.session);
}

function syncSessionBadge() {
  const n = state.session.length;
  el.btnNewSession.textContent = n ? `🆕 새로 시작 (${n})` : '🆕 새로 시작';
  el.btnNewSession.title = n
    ? `이번 세션에서 ${n}문제를 기억하고 있습니다. 누르면 모두 지우고 새로 시작합니다.`
    : '기억한 문제가 없습니다.';
}

/**
 * 새 세션 시작 — 이전 대화·기록을 모두 지웁니다.
 * 화면 공유/카메라를 새로 켤 때, 그리고 '새로 시작'을 누를 때 호출합니다.
 */
function beginSession() {
  state.session = [];
  state.turns = [];
  state.lastImage = null;
  state.history = [];
  state.activeHistory = null;
  clearHistory();   // 저장된 것도 함께 지웁니다 — "새로 시작"은 완전히 새로 시작입니다
  el.answer.innerHTML = '<div class="placeholder"><p>새 세션을 시작했습니다. 이전 대화는 기억하지 않습니다.</p></div>';
  el.btnCopy.disabled = true;
  el.actions.hidden = true;
  el.followup.disabled = true;
  el.btnFollowup.disabled = true;
  drawHistory();
  syncSessionBadge();
}

/* ── 분석 실행 ─────────────────────────────────── */
async function solve({ followup = null } = {}) {
  if (state.busy) return;

  const cfg = activeConfig(settings);
  if (!cfg.ready) {
    setStatus('AI 설정 필요', 'error');
    el.autoMode.checked = false; // 키가 생길 때까지 자동 감지가 반복 호출되지 않도록
    el.answer.innerHTML = '';
    showError(`${cfg.meta.label} API 키가 없습니다. ⚙️ 설정에서 키를 입력하고 저장한 뒤 자동 감지를 다시 켜세요.`);
    openSettings();
    return;
  }

  if (followup) {
    if (!state.turns.length) return;
    state.turns.push({ role: 'user', text: followup });
  } else {
    const dataUrl = capture.grab(settings.maxWidth);
    const image = splitDataUrl(dataUrl);
    if (!image) {
      showError('프레임을 캡처하지 못했습니다. 입력을 다시 시작해 보세요.');
      return;
    }
    state.lastImage = dataUrl;
    // 앞서 푼 문제들(요약) + 지금 문제(이미지)
    state.turns = [...sessionTurns(), { role: 'user', text: currentInstruction(), image }];
    state.analyzedSig = capture.signature();
    state.lastSolveAt = Date.now();
  }

  state.pendingFollowup = followup;
  await runAnalysis();
}

/**
 * 준비된 state.turns 로 실제 요청을 보냅니다.
 * 네트워크가 끊겼다 돌아왔을 때 그대로 다시 부를 수 있도록 분리했습니다.
 */
async function runAnalysis() {
  if (state.busy) return;
  const cfg = activeConfig(settings);
  if (!cfg.ready || !state.turns.length) return;
  const followup = state.pendingFollowup;

  // 연결이 없으면 요청을 아예 보내지 않습니다. 화면 공유는 그대로 둡니다.
  if (navigator.onLine === false) {
    showNetworkError('인터넷에 연결되어 있지 않습니다. 와이파이 또는 모바일 데이터를 켜 주세요.');
    return;
  }

  state.busy = true;
  state.controller = new AbortController();
  setProgress('image');
  const startedAt = Date.now();
  setStatus('분석 중…', 'busy');
  el.btnAbort.hidden = false;
  el.btnSolve.disabled = true;
  el.btnFollowup.disabled = true;
  revealAnswer();

  let acc = '';
  renderAnswer('', true);
  // 청크마다 마크다운 전체를 다시 그리면 폰에서 눈에 띄게 버벅입니다.
  // 화면 갱신은 약 10fps 로 제한하고, 마지막 상태는 아래에서 확실히 그립니다.
  let lastPaint = 0;
  let paintTimer = null;

  try {
    const full = await streamCompletion({
      provider: cfg.provider,
      useProxy: cfg.useProxy,
      accessCode: cfg.accessCode,
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      system: currentSystemPrompt(),
      turns: state.turns,
      signal: state.controller.signal,
      onDelta: (chunk) => {
        if (!acc) setProgress('read');
        else if (acc.includes('풀이') || acc.includes('정답')) setProgress('solve');
        acc += chunk;
        const now = Date.now();
        if (now - lastPaint >= 100) {
          lastPaint = now;
          clearTimeout(paintTimer);
          paintTimer = null;
          renderAnswer(acc, true);
        } else if (!paintTimer) {
          paintTimer = setTimeout(() => {
            paintTimer = null;
            lastPaint = Date.now();
            renderAnswer(acc, true);
          }, 100);
        }
      },
    });

    clearTimeout(paintTimer);
    setProgress('verify');
    state.awaitingNetwork = false;
    state.turns.push({ role: 'assistant', text: full });
    renderAnswer(full, false);          // 여기서 앱이 직접 검산합니다
    setProgress('done');
    setTimeout(() => setProgress(null), 1500);
    state.lastDebug = {
      provider: cfg.provider, model: cfg.model, viaProxy: cfg.useProxy,
      ms: Date.now() - startedAt, chars: full.length,
    };
    if (settings.debug) showDebugLine();
    idleStatus();
    if (!followup) {
      addHistory(state.lastImage, full);
      rememberSolved(full);      // 다음 문제·질문이 참고할 수 있게 기억
    } else {
      updateActiveHistory(full);
    }
    el.btnCopy.disabled = false;
    el.followup.disabled = false;
  } catch (err) {
    clearTimeout(paintTimer);
    setProgress(null);
    if (err.name === 'AbortError') {
      renderAnswer(acc + '\n\n_(중단됨)_', false);
      idleStatus();
    } else if (isNetworkError(err)) {
      renderAnswer(acc, false);
      showNetworkError(await networkHint());
    } else {
      renderAnswer(acc, false);
      showError(err.message || String(err), err);
      setStatus('오류', 'error');
    }
  } finally {
    state.busy = false;
    state.controller = null;
    el.btnAbort.hidden = true;
    el.btnSolve.disabled = !capture.active;
    el.btnFollowup.disabled = !state.turns.length;
    state.lastSolveAt = Date.now();
  }
}

/* ── 자동 감지 루프 ─────────────────────────────── */
function restartLoop() {
  clearInterval(state.timer);
  if (!capture.isLive) return;
  state.timer = setInterval(tick, settings.interval);
}

function tick() {
  const tune = SOURCES[state.source];
  const sig = capture.signature();
  if (!sig) return;

  const changed = diffPercent(sig, state.lastSig);
  const sinceAnalyzed = diffPercent(sig, state.analyzedSig);
  state.lastSig = sig;

  const threshold = settings.sensitivity * tune.changeMult;
  el.meterFill.style.width = `${Math.min(100, (sinceAnalyzed / threshold) * 100)}%`;
  el.meterFill.classList.toggle('over', sinceAnalyzed >= threshold);
  el.meterText.textContent = `${sinceAnalyzed.toFixed(1)}%`;

  if (!el.autoMode.checked || state.busy) return;
  if (navigator.onLine === false) return;            // 연결이 없으면 캡처만 하고 보내지 않습니다
  if (Date.now() - state.lastSolveAt < 3000) return; // 같은 문제를 연달아 보내지 않도록

  if (sinceAnalyzed >= threshold) state.pendingChange = true;

  if (state.pendingChange) {
    if (changed < tune.stable) state.stableCount += 1;
    else state.stableCount = 0;

    if (state.stableCount >= 2) {
      state.pendingChange = false;
      state.stableCount = 0;
      el.autoNote.textContent = '새 화면을 감지해 분석했습니다.';
      solve();
    } else {
      el.autoNote.textContent = state.source === 'camera'
        ? '변화 감지됨 — 카메라를 잠시 고정하세요…'
        : '변화 감지됨 — 화면이 멈추면 분석합니다…';
    }
  } else {
    el.autoNote.textContent = idleNote();
  }
}

/* ── 기록 ──────────────────────────────────────── */

/**
 * 목록에 쓸 작은 미리보기를 만듭니다.
 * 원본(화면 한 장이 수백 KB)을 그대로 <img> 에 올리면 폰에서 메모리를 크게
 * 먹습니다. 원본은 이어서 질문용으로 배열에만 남기고, 화면에는 축소본을 씁니다.
 */
async function makeThumb(dataUrl, width = 240) {
  try {
    const img = new Image();
    img.src = dataUrl;
    if (img.decode) await img.decode();
    else await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
    if (!img.naturalWidth) return dataUrl;
    const scale = Math.min(1, width / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const thumb = canvas.toDataURL('image/jpeg', 0.6);
    return thumb.length < dataUrl.length ? thumb : dataUrl;
  } catch {
    return dataUrl;
  }
}

async function addHistory(dataUrl, text) {
  const item = { id: Date.now(), image: dataUrl, thumb: null, text, at: new Date() };
  state.history.unshift(item);
  state.history = state.history.slice(0, 12);
  state.activeHistory = item.id;
  drawHistory();
  item.thumb = await makeThumb(dataUrl);
  drawHistory();
  persist();
}

function updateActiveHistory(text) {
  const item = state.history.find((h) => h.id === state.activeHistory);
  if (item) item.text = text;
  persist();
}

/** 풀이 내용에서 과목을 추정합니다 (§7, §26 필터용). */
function guessSubject(text) {
  const t = String(text || '');
  const hit = (re) => re.test(t);
  if (hit(/방정식|함수|미분|적분|확률|통계|기하|도형|삼각|수학/)) return '수학';
  if (hit(/영어|문법|어법|해석|English|단어/i)) return '영어';
  if (hit(/국어|지문|문단|화자|서술자/)) return '국어';
  if (hit(/과학|물리|화학|생명|지구|실험|원소/)) return '과학';
  if (hit(/사회|역사|지리|경제|정치|헌법/)) return '사회';
  return '기타';
}

/** 검색어·과목·정렬을 적용한 목록 (§26) */
function visibleHistory() {
  const q = (el.historySearch?.value || '').trim().toLowerCase();
  const subject = el.historySubject?.value || '';
  const sort = el.historySort?.value || 'new';

  let rows = state.history.filter((h) => {
    if (subject && guessSubject(h.text) !== subject) return false;
    if (!q) return true;
    return String(h.text || '').toLowerCase().includes(q);
  });
  rows = [...rows].sort((a, b) => (sort === 'old' ? a.id - b.id : b.id - a.id));
  return rows;
}

function drawHistory() {
  el.history.innerHTML = '';
  const rows = visibleHistory();
  if (!rows.length) {
    el.history.innerHTML = state.history.length
      ? '<li class="history-empty muted">조건에 맞는 기록이 없습니다.</li>'
      : '<li class="history-empty muted">분석한 화면이 여기에 쌓입니다.</li>';
    return;
  }
  for (const h of rows) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'history-item' + (h.id === state.activeHistory ? ' active' : '');
    const { answer } = splitFinalAnswer(h.text);
    const label = answer || parseSolution(h.text).sections.translation || '풀이';
    const preview = h.thumb || h.image;
    btn.innerHTML =
      (preview
        ? `<img alt="캡처 미리보기" src="${preview}" />`
        : '<span class="history-noimg" aria-hidden="true">📄</span>')
      + `<span class="history-meta"><strong>${escapeText(label.split('\n')[0])}</strong>`
      + `${h.at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>`;
    btn.addEventListener('click', () => {
      state.activeHistory = h.id;
      // 지난 실행에서 복원한 항목에는 원본 이미지가 없습니다(저장하지 않습니다).
      // 이때는 이미지 없이 풀이 내용만으로 이어서 질문할 수 있게 합니다.
      state.turns = [
        ...sessionTurns(),
        h.image
          ? { role: 'user', text: SOLVE_INSTRUCTION, image: splitDataUrl(h.image) }
          : { role: 'user', text: '(앞서 푼 문제입니다. 아래 풀이를 참고해 이어서 답해 주세요.)' },
        { role: 'assistant', text: h.text },
      ];
      state.lastImage = h.image;
      renderAnswer(h.text, false);
      el.btnCopy.disabled = false;
      el.followup.disabled = false;
      el.btnFollowup.disabled = false;
      drawHistory();
      revealAnswer();
    });
    li.append(btn);
    el.history.append(li);
  }
}

/* ── 영역 지정 ─────────────────────────────────── */
let cropDrag = null;

/** object-fit: contain 기준으로 실제 콘텐츠가 그려지는 영역 */
function contentRectInStage() {
  const src = capture.source();
  if (!src || !src.w) return null;
  const box = capture.displayEl.getBoundingClientRect();
  const scale = Math.min(box.width / src.w, box.height / src.h);
  const w = src.w * scale;
  const h = src.h * scale;
  return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, w, h, scale };
}

el.cropLayer.addEventListener('pointerdown', (e) => {
  const r = contentRectInStage();
  if (!r) return;
  e.preventDefault();
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

function finishCrop(e) {
  if (!cropDrag) return;
  const { r } = cropDrag;
  const x1 = Math.min(cropDrag.x, e.clientX);
  const y1 = Math.min(cropDrag.y, e.clientY);
  const x2 = Math.max(cropDrag.x, e.clientX);
  const y2 = Math.max(cropDrag.y, e.clientY);
  cropDrag = null;
  const thenSolve = state.selectThenSolve;
  endCropMode();

  if (x2 - x1 < 12 || y2 - y1 < 12) {          // 실수로 누른 경우
    if (thenSolve) startCropMode(true);        // 선택 모드는 유지합니다
    return;
  }
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
  if (thenSolve) solve();   // 고른 영역만 바로 풀이합니다
}

el.cropLayer.addEventListener('pointerup', finishCrop);
el.cropLayer.addEventListener('pointercancel', () => { cropDrag = null; endCropMode(); });

/**
 * 영역 지정 시작.
 * @param {boolean} thenSolve 영역을 고르면 바로 풀이할지 (스크린샷을 받았을 때)
 */
function startCropMode(thenSolve = false) {
  if (!capture.active) {
    if (nativeSharing()) {
      showError('아직 받아온 화면이 없습니다. ⚡ 지금 풀기를 누르거나, 문제 화면으로 이동해 자동 분석을 기다린 뒤 영역을 지정하세요.');
    }
    return;
  }
  state.selectThenSolve = thenSolve;
  // 풀이 결과로 스크롤된 뒤라면 캡처 화면이 화면 밖에 있을 수 있습니다.
  // 드래그할 대상이 보이지 않으면 영역 지정이 불가능하므로 먼저 올려 줍니다.
  const box = el.stage.getBoundingClientRect();
  if (box.top < 0 || box.bottom > window.innerHeight) {
    el.stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  el.cropLayer.hidden = false;
  el.cropBox.hidden = true;
  el.cropBox.removeAttribute('style');
  el.btnSolveAll.hidden = !thenSolve;
  el.cropHint.innerHTML = thenSolve
    ? '풀고 싶은 <strong>문제 영역을 드래그</strong>하세요'
    : '분석할 영역을 드래그해서 지정하세요 · <kbd>Esc</kbd> 취소';
}

function endCropMode() {
  el.cropLayer.hidden = true;
  el.cropBox.hidden = true;
  el.cropBox.removeAttribute('style');
  el.btnSolveAll.hidden = true;
  state.selectThenSolve = false;
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

/* ── 캡처 시작/중지 ────────────────────────────── */
async function startCapture() {
  try {
    // Android 앱: 시스템 권한창 → MediaProjection (네이티브가 캡처를 이어갑니다)
    if (isNativeScreen()) {
      beginSession();          // 화면 공유를 새로 켜면 이전 대화는 잊습니다
      androidBridge.setConfig(nativeConfig());
      androidBridge.start();
      return;
    }
    // 사진 모드, 그리고 화면 공유가 불가능한 폰에서는 파일 선택으로 갑니다.
    if (state.source === 'photo' || (state.source === 'screen' && !SCREEN_SUPPORTED)) {
      el.filePhoto.click();
      return;
    }
    beginSession();            // 새로 켜는 것이므로 이전 대화는 잊습니다
    if (state.source === 'screen') await capture.startScreen();
    else await capture.startCamera();

    onCaptureReady();
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showError(state.source === 'camera'
        ? '카메라 사용이 거부되었습니다. 브라우저 주소창의 권한 설정에서 카메라를 허용해 주세요.'
        : '화면 공유가 취소되었습니다.');
    } else {
      showError(`입력을 시작하지 못했습니다: ${err.message}`);
    }
    idleStatus();
  }
}

function onCaptureReady() {
  syncStageMode();
  el.btnStop.disabled = false;
  el.btnSolve.disabled = false;
  el.btnCrop.disabled = false;
  el.btnStart.hidden = capture.isStreaming; // 켜져 있는 동안에는 자리를 비웁니다
  el.btnStop.hidden = !capture.isStreaming;
  el.btnStop.disabled = !capture.isStreaming;
  el.meter.hidden = !capture.isStreaming;
  state.lastSig = capture.signature();
  state.analyzedSig = null;
  state.pendingChange = false;
  state.stableCount = 0;
  state.lastSolveAt = 0;
  idleStatus();
  restartLoop();
}

function stopCapture({ keepStatus = false } = {}) {
  if (capture.mode === 'native' || (isNativeScreen() && androidBridge.status().running)) {
    androidBridge.stop();
  }
  stopNativeMeter();
  capture.stop();
  clearInterval(state.timer);
  el.still.removeAttribute('src');
  syncStageMode();
  el.btnStop.disabled = true;
  el.btnSolve.disabled = true;
  el.btnCrop.disabled = true;
  el.btnStart.hidden = false;
  el.btnCropClear.hidden = true;
  el.meter.hidden = true;
  markCropBadge(false);
  endCropMode();
  if (!keepStatus) idleStatus();
}

/* ── Android 네이티브 화면 공유 ─────────────────── */

/** 웹 설정값을 네이티브 판정기 설정으로 변환합니다. */
function nativeConfig() {
  return {
    // 화면을 확인하는 주기. 시그니처 비교만 하므로 짧아도 부담이 적습니다.
    sampleIntervalMs: settings.interval,
    sensitivity: settings.sensitivity,
    // 화면이 멎었다고 볼 시간. 확인 주기와 무관하게 짧게 잡아야 반응이 빠릅니다.
    stableMs: settings.stableMs,
    minAnalysisIntervalMs: settings.cooldown,
    maxWidth: settings.maxWidth,
    jpegQuality: 80,
    autoAnalyze: el.autoMode.checked,
  };
}

/**
 * 수동 캡처 요청 후 화면이 오지 않으면 상태 표시가 계속 남습니다.
 * 정지된 화면에서는 새 프레임이 생기지 않을 수 있으므로 반드시 시간 제한을 둡니다.
 */
function armFrameTimeout() {
  clearTimeout(state.frameTimer);
  state.frameTimer = setTimeout(() => {
    state.frameTimer = null;
    if (state.busy) return;
    showError('화면을 받지 못했습니다. 화면 공유가 켜져 있는지 확인하고 다시 눌러 주세요.');
    idleStatus();
  }, 4000);
}

function stopNativeMeter() {
  clearInterval(state.nativeMeter);
  state.nativeMeter = null;
}

/** 네이티브 상태(변화량·상태머신)를 미터에 반영합니다. */
function startNativeMeter() {
  stopNativeMeter();
  state.nativeMeter = setInterval(() => {
    const st = androidBridge.status();
    if (!st.running) return;
    const threshold = settings.sensitivity;
    el.meterFill.style.width = `${Math.min(100, (st.changePercent / threshold) * 100)}%`;
    el.meterFill.classList.toggle('over', st.changePercent >= threshold);
    el.meterText.textContent = `${(st.changePercent || 0).toFixed(1)}%`;
    if (!state.busy) {
      el.autoNote.textContent = {
        change_detected: '변화 감지됨 — 화면이 멈추면 분석합니다…',
        waiting_stable: '안정화 중…',
        analyzing: '분석 준비 중…',
      }[st.state] || nativeIdleNote();
    }
  }, 700);
}

function wireAndroidBridge() {
  if (!IS_ANDROID_APP) return;

  const mismatch = bridgeMismatch();
  if (mismatch !== null) {
    showError(`앱과 웹 화면의 버전이 다릅니다 (앱 브리지 v${mismatch}). 앱을 최신 버전으로 업데이트해 주세요.`);
  }

  exposePublicApi({
    // Android 뒤로가기: 웹이 먼저 처리할 게 있으면 true
    onBack: () => {
      if (el.settings.open) { el.settings.close(); return true; }
      if (!el.cropLayer.hidden) { endCropMode(); return true; }
      return false;
    },
  });

  androidBridge.on('screen-capture-started', () => {
    el.btnStart.hidden = true;
    el.btnStop.hidden = false;
    el.btnStop.disabled = false;
    el.btnSolve.disabled = false;
    el.btnCrop.disabled = false;
    el.meter.hidden = false;
    androidBridge.setConfig(nativeConfig());
    startNativeMeter();
    setStatus('🔴 화면 공유 중', 'live');
    el.autoNote.textContent = nativeIdleNote();
  });

  androidBridge.on('screen-capture-stopped', () => {
    clearTimeout(state.frameTimer);
    state.frameTimer = null;
    stopNativeMeter();
    capture.stop();
    el.still.removeAttribute('src');
    syncStageMode();
    el.btnStart.hidden = false;
    el.btnStop.disabled = true;
    el.btnSolve.disabled = true;
    el.btnCrop.disabled = true;
    el.meter.hidden = true;
    markCropBadge(false);
    endCropMode();
    idleStatus();
  });

  androidBridge.on('screen-capture-error', (detail) => {
    stopNativeMeter();
    if (detail.error) showError(detail.error);
    setStatus('오류', 'error');
  });

  // 네이티브가 "분석할 가치가 있다"고 판정한 프레임만 여기로 옵니다.
  androidBridge.on('screen-capture-frame', async (detail) => {
    clearTimeout(state.frameTimer);
    state.frameTimer = null;
    const dataUrl = androidBridge.takeFrame();
    if (!dataUrl) return;
    try {
      await capture.setNativeFrame(dataUrl);
      syncStageMode();
      el.btnSolve.disabled = false;
      el.btnCrop.disabled = false;
      // 자동 프레임은 바로 풀이합니다. 수동(⚡ 지금 풀기)도 마찬가지입니다.
      if (detail.reason === 'manual' || el.autoMode.checked) solve();
    } catch (err) {
      showError(err.message);
    }
  });
}

/* ── 이벤트 배선 ───────────────────────────────── */
el.sourceTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-source]');
  if (!tab || tab.disabled) return;
  setSource(tab.dataset.source);
});

el.btnStart.addEventListener('click', startCapture);
el.btnStop.addEventListener('click', () => stopCapture());
el.btnFlip.addEventListener('click', async () => {
  try {
    await capture.flipCamera();
    onCaptureReady();
  } catch (err) {
    showError(`카메라를 전환하지 못했습니다: ${err.message}`);
  }
});

/** 사진·스크린샷 한 장을 불러와 즉시 풀이합니다. (파일 선택 / 공유 / 붙여넣기 공통) */
/** 지원 이미지 형식과 크기 상한 (§51) */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
const MAX_FILE_BYTES = 25 * 1024 * 1024;

async function loadPhoto(file) {
  if (!file) return;

  // 형식·크기를 먼저 확인해, 읽을 수 없는 파일로 API 를 호출하지 않습니다.
  if (file.type && !ALLOWED_TYPES.includes(file.type)) {
    showError(`이 형식(${file.type})은 지원하지 않습니다. JPG · PNG · WEBP 파일을 선택해 주세요.`);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showError(`이미지가 너무 큽니다 (${Math.round(file.size / 1024 / 1024)}MB). 25MB 이하의 사진을 선택해 주세요.`);
    return;
  }

  try {
    await capture.setPhoto(file);
    onCaptureReady();
    // 스크린샷은 화면 전체라 UI·광고까지 섞여 있으므로, 기본은 문제 영역을
    // 먼저 고르게 합니다. (설정에서 끄면 곧바로 풉니다.)
    if (el.selectFirst.checked) startCropMode(true);
    else solve();
  } catch (err) {
    showError(err.message);
  }
}

el.filePhoto.addEventListener('change', () => {
  const file = el.filePhoto.files?.[0];
  el.filePhoto.value = ''; // 같은 사진을 다시 골라도 change 가 발생하도록
  loadPhoto(file);
});

capture.onEnded = () => stopCapture();

el.btnSolve.addEventListener('click', () => {
  // 네이티브 공유 중에는 "지금 화면"을 새로 받아서 풀이합니다.
  // 첫 프레임이 오기 전에도 동작해야 하므로 capture.mode 가 아니라
  // 네이티브 실행 여부로 판단합니다.
  if (nativeSharing()) {
    setStatus('화면 받는 중…', 'busy');
    androidBridge.requestFrame();
    armFrameTimeout();
  } else {
    solve();
  }
});
el.btnCrop.addEventListener('click', () => startCropMode(false));

el.btnSolveAll.addEventListener('pointerdown', (e) => e.stopPropagation()); // 드래그로 오인하지 않도록
el.btnSolveAll.addEventListener('click', (e) => {
  e.stopPropagation();
  capture.crop = null;
  markCropBadge(false);
  el.btnCropClear.hidden = true;
  endCropMode();
  solve();
});

el.selectFirst.addEventListener('change', () => {
  settings.selectFirst = el.selectFirst.checked;
  saveSettings(settings);
});
el.btnCropClear.addEventListener('click', () => {
  capture.crop = null;
  el.btnCropClear.hidden = true;
  markCropBadge(false);
  state.analyzedSig = null;
});

el.btnNewSession.addEventListener('click', () => {
  state.controller?.abort();
  beginSession();
  idleStatus();
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
  el.followup.blur(); // 모바일 키보드를 닫아 답변이 가려지지 않게
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
  if (IS_ANDROID_APP) androidBridge.setConfig(nativeConfig());
});

for (const node of [el.historySearch, el.historySubject, el.historySort]) {
  node.addEventListener('input', drawHistory);
}

el.btnClearHistory.addEventListener('click', () => {
  state.history = [];
  state.activeHistory = null;
  drawHistory();
  persist();
});

/* ── 테마 · 보기 탭 · 하단 네비 (§36, §10, §46) ── */

el.btnTheme.addEventListener('click', () => {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(settings.theme) + 1) % THEME_ORDER.length];
  settings.theme = next;
  saveSettings(settings);
  applyTheme();
});

el.modeTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn || btn.dataset.mode === settings.mode) return;
  settings.mode = btn.dataset.mode;
  saveSettings(settings);
  applyMode();
  // 모드가 바뀌면 이전 대화 문맥은 맞지 않으므로 새로 시작합니다.
  // 화면 공유는 그대로 두므로, 켜 둔 채 모드만 바꿔도 계속 이어집니다.
  beginSession();
  el.answer.innerHTML = isTranslateMode()
    ? '<div class="placeholder"><p><strong>🌐 화면 번역 모드</strong></p>'
      + '<p class="muted">화면 공유를 켜 두면 화면이 바뀔 때마다 자동으로 번역합니다. '
      + '카메라·사진도 같은 방식으로 번역할 수 있습니다.</p></div>'
    : '<div class="placeholder"><p><strong>🧮 풀이 모드</strong></p>'
      + '<p class="muted">문제를 비추거나 화면을 공유하면 단계별로 풀어드립니다.</p></div>';
  idleStatus();
});

el.translateTo.addEventListener('change', () => {
  settings.translateTo = el.translateTo.value;
  saveSettings(settings);
  // 언어를 바꾸면 이전 번역과 섞이지 않게 문맥을 비웁니다.
  state.turns = [];
});

el.viewTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  viewMode = btn.dataset.view;
  applyViewMode();
});

/** 하단 네비 — 해당 영역으로 이동하거나 화면을 전환합니다. */
el.bottomNav.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-nav]');
  if (!btn) return;
  const to = btn.dataset.nav;

  if (to === 'settings') { openSettings(); return; }
  if (to === 'camera') {
    // 화면 공유 중에는 입력 소스를 바꾸지 않습니다.
    // 앱에서는 화면 공유가 주 흐름이라, 실수로 눌러 공유가 끊기면 안 됩니다.
    // 이때는 캡처 화면으로 이동만 하고, 바꾸려면 위쪽 탭을 직접 누르게 합니다.
    if (nativeSharing() || capture.isStreaming) {
      // 상태 표시는 건드리지 않습니다 — 공유가 그대로 살아 있다는 뜻이므로.
      flashNavHint('화면 공유 중입니다. 카메라로 바꾸려면 위쪽 탭을 눌러 주세요.');
    } else {
      setSource('camera');
    }
    document.querySelector('.panel-capture')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (to === 'notes') {
    showNotesPanel(true);
    el.panelNotes.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (to === 'history') {
    showNotesPanel(false);
    el.panelHistory.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    showNotesPanel(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  for (const b of el.bottomNav.querySelectorAll('[data-nav]')) {
    b.setAttribute('aria-current', String(b === btn));
  }
});

/** 하단 네비에서 막힌 동작을 했을 때 잠깐 알려 줍니다. */
let navHintTimer = null;
function flashNavHint(message) {
  let hint = document.getElementById('nav-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'nav-hint';
    hint.className = 'nav-hint';
    hint.setAttribute('role', 'status');
    document.body.append(hint);
  }
  hint.textContent = message;
  hint.hidden = false;
  clearTimeout(navHintTimer);
  navHintTimer = setTimeout(() => { hint.hidden = true; }, 2600);
}

/* ── 오답노트 (§25) ────────────────────────────── */

function showNotesPanel(show) {
  el.panelNotes.hidden = !show;
  if (show) drawNotes();
}

function drawNotes() {
  const notes = loadNotes();
  el.notesSize.textContent = notes.length ? `${notes.length}개 · ${notesSizeKb()}KB` : '';
  el.notes.innerHTML = '';
  if (!notes.length) {
    el.notes.innerHTML = '<li class="history-empty muted">다시 볼 문제를 오답노트에 담아 두세요.</li>';
    return;
  }
  for (const n of notes) {
    const li = document.createElement('li');
    li.className = 'note-item';

    const head = document.createElement('div');
    head.className = 'note-head';
    head.innerHTML = `<strong>${escapeText(n.question || '문제')}</strong>`
      + `<span class="note-meta">${escapeText(n.subject)} · `
      + `${n.at.toLocaleDateString('ko-KR')}</span>`;

    const body = document.createElement('div');
    body.className = 'note-body';
    body.innerHTML = (n.thumb ? `<img alt="문제 미리보기" src="${n.thumb}" />` : '')
      + `<div><b>정답</b> ${escapeText(n.answer || '-')}</div>`
      + (n.reason ? `<div class="note-reason"><b>틀린 이유</b> ${escapeText(n.reason)}</div>` : '');

    const acts = document.createElement('div');
    acts.className = 'note-actions';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-ghost';
    open.textContent = '풀이 보기';
    open.addEventListener('click', () => {
      renderAnswer(n.solution || '', false);
      revealAnswer();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost';
    del.textContent = '삭제';
    del.addEventListener('click', () => { removeNote(n.id); drawNotes(); });

    acts.append(open, del);
    li.append(head, body, acts);
    el.notes.append(li);
  }
}

el.btnClearNotes.addEventListener('click', () => {
  if (!loadNotes().length) return;
  clearNotes();
  drawNotes();
});

/* ── API 키 연결 테스트 · 모델 목록 (§4, §38) ──── */

el.btnTestKey.addEventListener('click', async () => {
  const provider = currentPickedProvider();
  const apiKey = el.apiKey.value.trim();
  const endpoint = el.endpoint.value.trim() || PROVIDERS[provider].defaultEndpoint;

  el.btnTestKey.disabled = true;
  el.keyTestResult.className = 'test-result testing';
  el.keyTestResult.textContent = '확인 중…';
  try {
    const { models } = await testConnection({ provider, apiKey, endpoint });
    el.keyTestResult.className = 'test-result ok';
    el.keyTestResult.textContent = models.length
      ? `✓ 연결 성공 · 모델 ${models.length}개`
      : '✓ 연결 성공';
    if (models.length) mergeFetchedModels(provider, models);
  } catch (err) {
    el.keyTestResult.className = 'test-result bad';
    // 원본 오류가 아니라 정리된 문구만 보여 줍니다 (§32).
    el.keyTestResult.textContent = `✕ ${err.message}`;
  } finally {
    el.btnTestKey.disabled = false;
  }
});

/** 서버에서 받아 온 모델을 사용자 목록에 합칩니다. */
function mergeFetchedModels(provider, models) {
  const known = new Set(PROVIDERS[provider].models.map((m) => m.id));
  const extra = models.map((m) => m.id).filter((id) => !known.has(id));
  settings.customModels[provider] = [
    ...new Set([...(settings.customModels[provider] || []), ...extra]),
  ].slice(0, 80);
  fillModelOptions(provider, el.model.value || settings.models[provider]);
}

el.btnRefreshModels.addEventListener('click', () => el.btnTestKey.click());

el.btnAddModel.addEventListener('click', () => {
  const provider = currentPickedProvider();
  const id = el.customModel.value.trim();
  if (!id) return;
  settings.customModels[provider] = [
    ...new Set([...(settings.customModels[provider] || []), id]),
  ];
  el.customModel.value = '';
  fillModelOptions(provider, id);
  syncKeyFlags();
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

for (const r of [el.interval, el.sensitivity, el.maxWidth, el.stableMs, el.cooldown]) {
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

// 연결이 끊겼다 돌아오면, 실패했던 분석을 자동으로 이어서 시도합니다.
window.addEventListener('online', () => {
  if (!state.awaitingNetwork || state.busy) { idleStatus(); return; }
  state.awaitingNetwork = false;
  el.answer.querySelectorAll('.error-box').forEach((b) => b.remove());
  runAnalysis();
});

window.addEventListener('offline', () => {
  if (!state.busy) setStatus('오프라인', 'error');
});

// 백그라운드로 갔을 때 카메라·감지 루프가 계속 도는 것을 막습니다.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearInterval(state.timer);
  else restartLoop();
});

/* ── 초기화 ────────────────────────────────────── */
function init() {
  el.detail.value = settings.detail;
  el.autoMode.checked = settings.autoMode;
  el.selectFirst.checked = settings.selectFirst;
  el.apiKey.dataset.provider = settings.provider;

  // 지난 실행에서 푼 문제들을 복원합니다. '새로 시작'을 누르기 전까지 이어집니다.
  const restored = loadHistory();
  state.history = restored.history;
  state.session = restored.session;

  applyTheme();
  applyViewMode();
  applyMode();
  syncProviderBadge();
  syncSessionBadge();
  syncKeyStorageNote();
  buildResultActions();
  drawHistory();
  drawNotes();

  // 서버 프록시가 있으면 키 없이도 쓸 수 있으므로, 확인되면 화면을 갱신합니다.
  probeProxy().then(() => {
    syncProviderBadge();
    syncProxyNote();
    idleStatus();
  });

  // 화면 공유 탭은 폰에서도 남겨 두고(스크린샷 공유 안내로 바뀝니다),
  // 카메라만 지원 여부에 따라 비활성화합니다.
  const screenTab = el.sourceTabs.querySelector('[data-source="screen"]');
  const cameraTab = el.sourceTabs.querySelector('[data-source="camera"]');
  if (!SCREEN_SUPPORTED) {
    screenTab.title = '이 브라우저는 화면을 직접 캡처할 수 없어, 스크린샷을 공유하는 방법을 안내합니다.';
  }
  if (!CAMERA_SUPPORTED) {
    cameraTab.disabled = true;
    cameraTab.title = '이 브라우저는 카메라를 지원하지 않습니다.';
  }

  // 사용자가 고른 소스가 있으면 그대로, 없으면 기기에 맞는 소스를 자동 선택합니다.
  // (폰은 바로 쓸 수 있는 카메라 — 화면 공유 탭은 스크린샷 안내로 남아 있습니다.)
  const usable = (s) => SOURCES[s] && (s !== 'camera' || CAMERA_SUPPORTED);
  const auto = SCREEN_SUPPORTED ? 'screen' : CAMERA_SUPPORTED ? 'camera' : 'photo';
  setSource(usable(settings.source) ? settings.source : auto, { silent: true });

  wireAndroidBridge();

  // 공유·붙여넣기·설치
  registerServiceWorker();
  wireInstallButton(el.btnInstall);
  onPastedImage((file) => {
    setSource(state.source === 'camera' ? 'photo' : state.source, { silent: true });
    loadPhoto(file);
  });
  takeSharedImage().then((file) => {
    if (file) loadPhoto(file);   // 공유 메뉴로 들어온 스크린샷은 곧바로 풉니다
  });

  idleStatus();
}

init();
