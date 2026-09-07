// 설정 저장/불러오기 (localStorage)
// API 키는 프로바이더별로 따로 보관해서, 프로바이더를 바꿔도 기존 키가 남아 있습니다.
//
// API 키만은 일반 설정과 다르게 다룹니다.
//   Android 앱  → Android Keystore 로 암호화해 보관 (설정 JSON 에는 남기지 않음)
//   웹 브라우저 → localStorage 평문 (브라우저에는 더 나은 저장소가 없습니다)
// 앱에서 처음 실행하면 예전에 평문으로 저장돼 있던 키를 암호화 저장소로 옮기고
// 평문 쪽은 지웁니다.

import { androidBridge } from './android.js';

const KEY = 'screensolver.settings.v2';

/** 암호화 저장소에서 쓰는 이름 (프로바이더별) */
const SECRET_NAME = { claude: 'apikey.claude', openai: 'apikey.openai', gemini: 'apikey.gemini' };

/** 이 기기에서 API 키를 암호화해 보관할 수 있는지 */
export function secureKeysAvailable() {
  return androidBridge.secure.available();
}

export const PROVIDERS = {
  claude: {
    label: 'Claude (Anthropic)',
    free: false,
    cost: '유료 · 크레딧 충전 필요',
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    models: [
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (권장 · 빠르고 정확)' },
      { id: 'claude-opus-5', label: 'Claude Opus 5 (최고 정확도)' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (가장 빠름)' },
    ],
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    free: false,
    cost: '유료 · 크레딧 충전 필요',
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    models: [
      { id: 'gpt-5', label: 'GPT-5 (권장)' },
      { id: 'gpt-5-mini', label: 'GPT-5 mini (빠름)' },
      { id: 'gpt-4o', label: 'GPT-4o' },
    ],
  },
  gemini: {
    label: 'Gemini (Google)',
    free: true,
    cost: '무료 등급 있음',
    keyPlaceholder: 'AIza...',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (무료 등급 · 권장)' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (무료 등급)' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (고성능 · 무료 등급 제한적)' },
    ],
  },
};

export const DEFAULTS = {
  provider: 'claude',
  keys: { claude: '', openai: '', gemini: '' },
  models: { claude: 'claude-sonnet-5', openai: 'gpt-5', gemini: 'gemini-2.5-flash' },
  endpoints: { claude: '', openai: '', gemini: '' }, // 비우면 기본 엔드포인트 사용
  source: '',       // 사용자가 고른 입력 소스. 비어 있으면 기기에 맞춰 자동 선택합니다.
  interval: 800,    // 프레임 확인 주기(ms) — 짧을수록 반응이 빠릅니다
  stableMs: 500,    // 화면이 이만큼 멎으면 "멈췄다"고 봅니다
  cooldown: 3000,   // 자동 분석 사이 최소 간격(ms) — API 비용 보호
  sensitivity: 6,   // 1~20, 클수록 둔감
  lang: 'ko',
  detail: 'brief',
  subject: 'auto',   // 과목 (auto 면 AI 가 분류)
  grade: 'auto',     // 학년 — 설명 눈높이
  extra: '',
  maxWidth: 1400,
  autoMode: true,
  selectFirst: true,  // 이미지를 받으면 문제 영역을 먼저 고르게 할지
};

/** structuredClone 이 없는 구형 WebView 에서도 동작하는 깊은 복사 */
function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

export function loadSettings() {
  let settings;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      settings = cloneDefaults();
    } else {
      const saved = JSON.parse(raw);
      // 예전 기본값(1500ms)을 그대로 쓰던 설치본은 더 빠른 새 기본값으로 옮깁니다.
      if (saved.interval === 1500) delete saved.interval;
      settings = {
        ...DEFAULTS,
        ...saved,
        keys: { ...DEFAULTS.keys, ...(saved.keys || {}) },
        models: { ...DEFAULTS.models, ...(saved.models || {}) },
        endpoints: { ...DEFAULTS.endpoints, ...(saved.endpoints || {}) },
      };
    }
  } catch {
    settings = cloneDefaults();
  }

  if (secureKeysAvailable()) {
    let migrated = false;
    for (const [provider, name] of Object.entries(SECRET_NAME)) {
      const plain = (settings.keys[provider] || '').trim();
      if (plain) {
        // 예전 버전이 평문으로 남긴 키 → 암호화 저장소로 옮깁니다.
        androidBridge.secure.set(name, plain);
        migrated = true;
      } else {
        settings.keys[provider] = androidBridge.secure.get(name) || '';
      }
    }
    // 평문이 남아 있었다면 즉시 지웁니다.
    if (migrated) saveSettings(settings);
  }
  return settings;
}

export function saveSettings(settings) {
  try {
    if (secureKeysAvailable()) {
      // 키는 암호화 저장소에만 두고, 설정 JSON 에는 절대 남기지 않습니다.
      const stripped = { ...settings, keys: { ...DEFAULTS.keys } };
      for (const [provider, name] of Object.entries(SECRET_NAME)) {
        const value = (settings.keys[provider] || '').trim();
        if (value) androidBridge.secure.set(name, value);
        else androidBridge.secure.remove(name);
      }
      localStorage.setItem(KEY, JSON.stringify(stripped));
      return true;
    }
    localStorage.setItem(KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false; // 시크릿 모드 등 저장이 막힌 경우
  }
}

/** 현재 프로바이더 기준으로 실제 사용할 키/모델/엔드포인트를 정리해서 반환 */
export function activeConfig(s) {
  // 저장값이 손상됐거나 예전 버전이면 기본 프로바이더로 되돌립니다.
  const p = PROVIDERS[s.provider] ? s.provider : DEFAULTS.provider;
  const meta = PROVIDERS[p];
  return {
    provider: p,
    meta,
    apiKey: (s.keys[p] || '').trim(),
    model: s.models[p] || meta.models[0].id,
    endpoint: (s.endpoints[p] || '').trim() || meta.defaultEndpoint,
  };
}
