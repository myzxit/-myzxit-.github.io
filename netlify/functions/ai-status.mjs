/**
 * 서버 프록시가 쓸 수 있는지 알려 줍니다 (§2B, §67).
 *
 * 어떤 프로바이더의 키가 서버에 설정되어 있는지만 true/false 로 알려 주고,
 * 키 값이나 길이·앞자리 같은 힌트는 절대 내보내지 않습니다.
 *
 * 환경변수가 하나도 없어도 오류가 아니라 `configured: {}` 를 돌려주어,
 * 사이트 전체가 죽지 않고 "직접 키 입력" 모드로 동작하게 합니다.
 */

const ENV = {
  claude: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export default async () => {
  const configured = {};
  for (const [provider, name] of Object.entries(ENV)) {
    configured[provider] = Boolean(process.env[name]);
  }
  return new Response(JSON.stringify({ proxy: true, configured }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};

export const config = { path: '/api/ai-status' };
