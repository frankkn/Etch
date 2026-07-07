# CLAUDE.md — Etch

## 這個專案是什麼

**Etch** 是一個「一生只能發 100 則貼文」的自我反思 app。

核心哲學：**稀缺性逼人認真**。真正的產品不是貼文功能，而是「要不要用掉這一則」的猶豫過程——那才是反思發生的地方。每則貼文像刻在石頭上：刻下去就擦不掉。

### 產品規則（不可妥協的設計約束）

1. **一個帳號一生只有 100 則額度**，用完就沒有了
2. **不可刪除、不可編輯**。唯一的例外是「劃掉（Strike）」：可以在貼文上加刪除線，劃掉的貼文仍然可見、仍佔額度，代表「我曾經這樣想，現在不了」。每則只能劃掉一次，劃掉也不可逆
3. **冷靜期（Cooling Period）**：寫完不能立刻發佈，強制存為草稿至少 24 小時，之後回來按「Etch」確認出版才扣額度。衝動性貼文會在冷靜期死掉——這是刻意設計
4. **沒有讚、沒有留言、沒有追蹤、沒有演算法**。貼文只有編號（No. 23 / 100）和時間
5. **預設完全私密**，且後台（開發者）也讀不到內容（E2E 加密，見下方架構）
6. 未出版的草稿不會消失，進入「**草稿墳場**」——你差點說出口的話

### UI 用語

- 發佈按鈕叫 **Etch**（不是 Post / Publish）
- 劃掉叫 **Strike**
- 貼文顯示為 **No. X / 100**
- 兩則貼文之間的時間間隔要在時間軸上可視化（沉默也是內容）

## 架構

### 總體：本地優先（local-first）+ 加密雲端備份

資料主體存在使用者裝置的 **IndexedDB**。雲端只是「加密備份桶」：上傳前已在客戶端加密，伺服器只存密文 blob，**連開發者都無法讀取明文**。這是產品承諾，不只是實作細節。

```
┌─────────────────────────────────────────┐
│  Browser (client)                        │
│                                          │
│  UI (React) ── posts/drafts (明文)       │
│      │                                   │
│  IndexedDB  ←— 資料主體，明文只存在本地   │
│      │                                   │
│  Crypto layer (Web Crypto API)           │
│   - 通關密語 → Argon2id/PBKDF2 衍生金鑰   │
│   - AES-256-GCM 加密                     │
│      │ (密文)                            │
└──────┼───────────────────────────────────┘
       ▼
  Firebase: Auth（登入身份）
            Firestore（只存密文 blob + metadata）
```

### 加密層（crypto module）

- 使用者設定一組**通關密語**（passphrase），與登入密碼分開
- 金鑰衍生：`passphrase + salt → Argon2id（若瀏覽器支援困難則 PBKDF2, ≥600k iterations）→ AES-256-GCM key`
- 金鑰只存在記憶體 / session，**永不上傳**；salt 存 Firestore（salt 不是秘密）
- 每則貼文獨立加密（各自的 IV），密文才寫入 Firestore
- **密語遺失 = 資料永久遺失**。沒有重設、沒有後門。這要在 onboarding 講得非常清楚，同時也是賣點：「連我們都救不回來，因為連我們都讀不到」
- 提供**匯出/匯入**：一個加密 JSON 檔就是你的一生（同時解決換裝置與備份焦慮）

### 登入與資料模型

- **Firebase Auth**（email link 或 Google 登入）— 只負責「你是誰」，不涉及內容解密
- Firestore 結構：

```
users/{uid}
  ├─ kdfSalt, kdfParams          # 金鑰衍生參數（非秘密）
  ├─ quotaUsed: number           # 已用額度（0–100）
  ├─ posts/{n}                   # n = 編號 1–100
  │    ciphertext, iv            # 加密後內容
  │    etchedAt                  # 出版時間
  │    struckAt?                 # 劃掉時間（一旦寫入不可再改）
  └─ drafts/{id}
       ciphertext, iv, createdAt # createdAt 用於冷靜期檢查
```

- **不變性用 Firestore Security Rules 在後端強制**，不是只靠 UI：
  - `posts`: `allow delete: if false`；`allow update:` 只放行首次寫入 `struckAt`
  - `posts` 建立時檢查 `request.time - draft.createdAt >= 24h`（冷靜期）與 `quotaUsed < 100`
  - 規則本身就是產品承諾

### 前端技術棧

- **Vite + React + TypeScript**
- 狀態：先用 React 內建（useState/useReducer + context），不急著上狀態庫
- 樣式：Tailwind CSS
- 本地儲存：IndexedDB（用 `idb` 輕量 wrapper）
- 部署：Firebase Hosting 或 Vercel

## Roadmap

### Phase 1 — 核心閉環（MVP）
- [ ] 專案腳手架（Vite + React + TS + Tailwind）
- [ ] Crypto module：passphrase → 金鑰衍生 → AES-GCM 加解密 → 單元測試（先做，獨立驗證）
- [ ] IndexedDB 本地儲存層（posts / drafts）
- [ ] 寫作介面 + 草稿（含草稿墳場）
- [ ] 冷靜期邏輯（24h 後才出現 Etch 按鈕）
- [ ] Etch 出版流程（確認問句：「十年後的你會想留著這則嗎？」）+ 額度扣減
- [ ] 時間軸閱讀介面（編號、間隔可視化）
- [ ] Strike 劃掉功能
- [ ] 匯出/匯入加密 JSON

### Phase 2 — 帳號與同步
- [ ] Firebase Auth 登入
- [ ] 密文同步到 Firestore（本地為主，雲端為備份）
- [ ] Security Rules 強制不變性 + 冷靜期 + 額度
- [ ] 多裝置：新裝置輸入通關密語 → 拉密文 → 本地解密

### Phase 3 — 之後再說
- [ ] 週年回訪通知 + 批註（每則限一次，不扣額度）
- [ ] 公開頁（用戶主動選擇公開的貼文走明文路徑，`/u/{name}` 極簡靜態頁）
- [ ] 第 99 → 100 則的「最後一則」特殊模式
- [ ] 遺囑功能（一年未登入，寄給指定的人）

## 刻意不做的事

- 社交功能（讚、留言、追蹤、分享按鈕）
- 通知轟炸、任何 engagement 優化
- 「忘記通關密語」的救援機制（沒有後門是特性）
- 富文本編輯器——純文字就好，最多支援換行
- 後台內容審查工具（我們技術上就看不到）

## 給 Claude 的開發準則

- 任何功能實作前先問：這會不會削弱「稀缺、不可逆、私密」三個核心？會就不做
- 不變性與冷靜期必須同時在客戶端與 Security Rules 兩層強制，UI 只是第一道
- Crypto 相關代碼要有測試，且不要自己發明密碼學——只用 Web Crypto API 標準原語
- 明文永遠不離開客戶端；任何新的網路請求都要檢查 payload 是否只含密文與 metadata
