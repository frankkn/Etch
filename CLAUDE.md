# CLAUDE.md — Etch

## 這個專案是什麼

**Etch** 是一個「一生只能發 100 則貼文」的自我反思 app。

核心哲學：**稀缺性逼人認真**。真正的產品不是貼文功能，而是「要不要用掉這一則」的猶豫過程——那才是反思發生的地方。每則貼文像刻在濕黏土上：剛刻完的 24 小時內還能修幾刀，時間一到準時進窯燒成陶——再也改不了。

### 產品規則（不可妥協的設計約束）

1. **一個帳號一生只有 100 則額度**，用完就沒有了
2. **立即發布 + 可塑期（Malleable Window）**：按下 Etch 立刻發布——立刻取得編號、立刻佔一則額度。發布後 24 小時內可編輯（編號不變）、可刪除（額度退還）。**窗口固定錨定發布時間，編輯不重置、不延長**。24 小時一到即「**定形**」（定形時刻 = etchedAt + 24h，純時間比較，不需要排程）
3. **定形後不可刪除、不可編輯**。唯一的例外是「劃掉（Strike）」：可以在貼文上加刪除線，劃掉的貼文仍然可見、仍佔額度，代表「我曾經這樣想，現在不了」。每則只能劃掉一次，劃掉也不可逆。可塑期內不能 Strike（那時該用編輯或刪除）
4. **沒有讚、沒有留言、沒有追蹤、沒有演算法**。貼文只有編號（No. 23 / 100）和時間。**編號＝發布順序，發布時就給**。刪除一則時，之後的貼文編號往前遞補——它們必然發布得更晚、仍在各自的可塑期內，所以**已定形的編號永不變動**，編號永遠緊湊。想要最新編號？刪掉重發即可
5. **預設完全私密**，且後台（開發者）也讀不到內容（E2E 加密，見下方架構）
6. 未出版的草稿不會消失，進入「**草稿墳場**」——你差點說出口的話

### UI 用語

- 發佈按鈕叫 **Etch**（不是 Post / Publish）
- 劃掉叫 **Strike**
- 發布後 24 小時的窗口叫**可塑期**，期滿叫**定形**
- 貼文一律顯示 **No. X / 100**；可塑期中額外標示「可塑期」+ 距定形的倒數
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
  ├─ posts/{id}                  # id = UUID；額度 = posts 總數（含可塑期中的）
  │    ciphertext, iv            # 加密後內容
  │    n                         # 編號 1–100，發布時指定（＝發布順序）；定形後永不變動
  │    etchedAt                  # 發布時間；定形時刻 = etchedAt + 24h（純推導，不存欄位）
  │    lastEditedAt              # 發布或最後編輯時間（純紀錄，不影響任何窗口）
  │    struckAt?                 # 劃掉時間（一旦寫入不可再改；僅限定形後）
  └─ drafts/{id}
       ciphertext, iv, createdAt
```

- **不變性用 Firestore Security Rules 在後端強制**，不是只靠 UI：
  - `posts` 建立時檢查 `count(posts) < 100`（額度含可塑期中的貼文）與 `etchedAt == request.time`
  - 可塑期內（`request.time < etchedAt + 24h`）：`allow update:` 內容編輯（`n`、`etchedAt` 不可動）與編號遞補（僅允許 `n` 減一、其餘不變）；`allow delete: if true`（刪除即退額度）
  - 定形後（`request.time >= etchedAt + 24h`）：`allow delete: if false`；`allow update:` 只放行首次寫入 `struckAt`
  - 定形是純時間比較（`etchedAt + 24h`），不需要伺服器排程，也沒有狀態轉移要驗證——這是選「固定窗口」設計的架構紅利。規則本身就是產品承諾

### 前端技術棧

- **Vite + React + TypeScript**
- 狀態：先用 React 內建（useState/useReducer + context），不急著上狀態庫
- 樣式：Tailwind CSS
- 本地儲存：IndexedDB（用 `idb` 輕量 wrapper）
- 部署：Firebase Hosting 或 Vercel

## Roadmap

### Phase 1 — 核心閉環（MVP）
- [x] 專案腳手架（Vite + React + TS + Tailwind）
- [x] Crypto module：passphrase → 金鑰衍生 → AES-GCM 加解密 → 單元測試（先做，獨立驗證）
  - 註：採 PBKDF2-SHA256 600k iterations（規格的 fallback 路徑）。Argon2id 需要 WASM 庫，會破壞離線解密工具零依賴的前提；`kdf.algorithm` 欄位已保留演進空間
- [x] IndexedDB 本地儲存層（posts / drafts）
- [x] 寫作介面 + 草稿（含草稿墳場）
- [x] Etch 立即出版流程（確認問句：「十年後的你會想留著這則嗎？」）+ 發布即定號 + 額度扣減
- [x] 可塑期邏輯：發布後固定 24h（編輯不重置）可編輯（編號不變）、可刪除（退額度、編號遞補）；期滿即定形
- [x] 時間軸閱讀介面（編號、間隔可視化、可塑期倒數）
- [x] Strike 劃掉功能（僅限定形後）
- [x] 匯出/匯入加密 JSON
  - [x] 匯出檔自帶 KDF 參數（salt、演算法、iterations），解密只需通關密語，不依賴帳號或伺服器
  - [x] **公開格式規格**：`docs/EXPORT_FORMAT.md`（欄位定義、KDF 用法、AES-GCM IV 餵法），只用標準原語，讓任何人都能自行實作解密器。`tests/format-compat.test.ts` 用規格內的 node:crypto 參考實作交叉驗證，守住規格與實作的一致性
  - [x] **離線解密工具**：`public/etch-decryptor.html` 單檔 HTML（純 JS + Web Crypto API，零網路請求、零外部依賴），選檔案 + 輸入密語 → 顯示明文；可從備份頁下載。Etch 消失後它仍能打開你的一生——這是「你不需要我們」主權承諾的實體保證

### Phase 2 — 帳號與同步
- [ ] Firebase Auth 登入
- [ ] 密文同步到 Firestore（本地為主，雲端為備份）
- [ ] Security Rules 強制不變性 + 可塑期窗口 + 額度
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
- 不變性與可塑期窗口必須同時在客戶端與 Security Rules 兩層強制，UI 只是第一道
- Crypto 相關代碼要有測試，且不要自己發明密碼學——只用 Web Crypto API 標準原語
- 明文永遠不離開客戶端；任何新的網路請求都要檢查 payload 是否只含密文與 metadata
