import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // API key 的 HTTP referrer 限制指定了 localhost:5173，port 不能悄悄漂移
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
