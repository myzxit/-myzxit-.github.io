/**
 * 서버 프록시가 쓸 수 있는지 알려 줍니다 (§2B, §67, §68).
 *
 * 어떤 프로바이더를 서버 키로 쓸 수 있는지만 true/false 로 알려 주고,
 * 키 값이나 길이·앞자리 같은 힌트는 절대 내보내지 않습니다.
 *
 * 중요: 키가 환경변수에 "있다"는 것만으로는 켜지지 않습니다. 사이트가
 * 공개되어 있으면 주소를 아는 누구나 사이트 주인의 크레딧을 쓰게 되므로,
 * 주인이 PROXY_ENABLED=true 또는 PROXY_ACCESS_CODE 를 명시적으로 설정해야
 * 사용 가능으로 보고합니다.
 *
 * 아무것도 설정되지 않아도 오류가 아니라 `configured` 가 모두 false 입니다.
 * 사이트는 그대로 동작하고, 각 사용자가 자기 키를 입력합니다.
 */

import { proxyEnabled } from './ai.mjs';

const ENV = {
  claude: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export default async () => {
  const enabled = proxyEnabled();
  const configured = {};
  for (const [provider, name] of Object.entries(ENV)) {
    configured[provider] = enabled && Boolean(process.env[name]);
  }
  return new Response(
    JSON.stringify({
      proxy: true,
      enabled,
      // 코드가 필요한 경우 사용자에게 입력을 받아야 하므로 그 사실만 알립니다.
      needsCode: Boolean(process.env.PROXY_ACCESS_CODE),
      configured,
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    },
  );
};

export const config = { path: '/api/ai-status' };
