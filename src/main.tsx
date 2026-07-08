import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { SharePage } from './components/SharePage';
import { SLUG_PATTERN } from './sync/slug';

// 要求瀏覽器把儲存標記為持久，降低 IndexedDB 被自動清除的風險。
// Phase 1 資料只有本地一份，這行是第一道防線，匯出備份是第二道。
void navigator.storage?.persist?.();

// 極簡路由：/s/{slug} 是無需登入的分享頁，其餘一律進 app
const shareMatch = window.location.pathname.match(SLUG_PATTERN);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shareMatch ? <SharePage slug={shareMatch[1]} /> : <App />}
  </StrictMode>,
);
