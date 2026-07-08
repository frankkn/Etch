import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// 要求瀏覽器把儲存標記為持久，降低 IndexedDB 被自動清除的風險。
// Phase 1 資料只有本地一份，這行是第一道防線，匯出備份是第二道。
void navigator.storage?.persist?.();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
