// fetch_data.js — GAS API 테스트 스크립트 (Node.js)
// ⚠️ GAS URL 변경은 js/shared/config.js 에서만 하세요!

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fetch = require('node-fetch');

// config.js에서 GAS_URL을 동적으로 가져옵니다.
// (Node.js ESM 환경에서는 파일 경로 기준 import)
const { GAS_URL } = await import('./js/shared/config.js');

async function run() {
  console.log('[테스트] GAS URL:', GAS_URL);
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'getDrivers', data: {} }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
