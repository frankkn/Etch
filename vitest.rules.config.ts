import { defineConfig } from 'vitest/config';

// Rules 測試需要 Firestore emulator，獨立於一般單元測試：
//   npm run test:rules（透過 firebase emulators:exec 啟動 emulator 再跑）
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests-rules/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
