# CLAUDE.md — Etch

## 這個專案是什麼

**Etch** 是一個「一生只能發 100 則貼文」的自我反思 app。

核心哲學：**稀缺性逼人認真**。真正的產品不是貼文功能，而是「要不要用掉這一則」的猶豫過程——那才是反思發生的地方。每則貼文像刻在濕黏土上：剛刻完的 24 小時內還能修幾刀，時間一到準時進窯燒成陶——再也改不了。

### 產品規則（不可妥協的設計約束）

1. **一個帳號一生只有 100 則額度**，用完就沒有了。公開與私密貼文都佔額度
2. **立即發布 + 可塑期（Malleable Window）**：按下 Etch 立刻發布——立刻取得編號、立刻佔一則額度。發布後 24 小時內可編輯（編號不變）、可刪除（額度退還）。**窗口固定錨定發布時間，編輯不重置、不延長**。24 小時一到即「**定形**」（定形時刻 = etchedAt + 24h，純時間比較，不需要排程）
3. **定形後不可刪除、不可編輯**。唯一的例外是「劃掉（Strike）」：可以在貼文上加刪除線，劃掉的貼文仍然可見、仍佔額度，代表「我曾經這樣想，現在不了」。每則只能劃掉一次，劃掉也不可逆。可塑期內不能 Strike（那時該用編輯或刪除）
4. **沒有讚、沒有留言、沒有追蹤、沒有演算法**。貼文只有編號（No. 23 / 100）和時間。**編號＝發布順序，發布時就給**。刪除一則時，之後的貼文編號往前遞補——它們必然發布得更晚、仍在各自的可塑期內，所以**已定形的編號永不變動**，編號永遠緊湊。想要最新編號？刪掉重發即可
5. **每則貼文在 Etch 當下選擇公開或私密**——這是出版儀式的一部分：「這一則，是刻給自己的，還是刻給世界的？」出版後可以雙向切換（見下方「公開與分享」），切換不需要任何等待期（已定案）。內容能不能改只由可塑期決定，與可見性無關
6. **草稿是唯一完全自由的空間**：可自由編輯、可直接刪除（真刪除，不留痕跡），沒有任何時間約束。草稿永遠不能公開
7. **沒有互動元件**：分享頁也一樣，純閱讀
8. **預設完全私密**，私密貼文 E2E 加密，後台（開發者）也讀不到內容（見下方架構）

### 公開與分享（三個已定案的設計決策）

**a. 可見性可雙向切換，但用語必須誠實**

- 私密 → 公開：允許，叫「**公開（Reveal）**」。多年後決定讓某段話見光，符合產品氣質
- 公開 → 私密：允許，但按鈕**不叫「轉為私密」，叫「停止展示（Unlist）」**。UI 必須明講：「已看過的人、截圖與網路快取無法收回。此後這則貼文會回到加密儲存，不再對外展示。」我們不提供假的安全感——收回展示做得到，收回資訊做不到
- 切換可見性**不可修改內容**（內容的可編輯性只由可塑期決定），內容不變性優先於一切

**b. 分享連結：隨機 slug，可重生**

- 每個用戶有一條**不可猜測的隨機連結**（如 `etch.app/s/x7Kq9mR2`），不是 username 門牌。它是「你主動遞出去的鑰匙」，不是「別人搜得到的門牌」
- 支援**連結重生（Regenerate）**：重新生成 slug，舊連結全部失效。內容收不回，但門可以換鎖——這是公開世界裡還給用戶的控制權
- username 式個人頁（`/u/frankkn`）留到 Phase 3+ 作為進階的「認領公開身份」選項

**c. 分享頁：只渲染公開貼文，編號、空缺與真實進度照留**

- 訪客看到的是 No. 7 ……（時間間隔）…… No. 23 ……（中間 15 則沉默）…… No. 41
- 空缺本身就是內容：看的人立刻明白這只是碎片，大部分刻痕不對他開放
- **分享頁顯示真實進度（如「已刻 60 / 100」）**，但只渲染公開貼文——訪客知道你刻了 60 則，看得到的只有你選擇公開的那幾則（已定案）
- 已劃掉且公開的貼文，在分享頁同樣以刪除線呈現
- 可塑期中的公開貼文照樣展示；期間的編輯、刪除與編號遞補會同步反映在分享頁——訪客可能看見還是黏土的那 24 小時，這是誠實的一部分

### 隱私承諾（對外文案的準繩）

「私密貼文端對端加密，連我們都讀不到；公開貼文是你選擇給世界看的，以明文儲存。」誠實、站得住腳，不多不少。

### UI 用語

- 發佈按鈕叫 **Etch**（不是 Post / Publish）
- 劃掉叫 **Strike**
- 發布後 24 小時的窗口叫**可塑期**，期滿叫**定形**
- 私密轉公開叫 **Reveal**，公開轉私密叫 **Unlist（停止展示）**
- 貼文一律顯示 **No. X / 100**；可塑期中額外標示「可塑期」+ 距定形的倒數
- 兩則貼文之間的時間間隔要在時間軸上可視化（沉默也是內容）

## 架構

### 總體：本地優先（local-first）+ 加密雲端備份 + 公開明文路徑

資料主體存在使用者裝置的 **IndexedDB**。雲端角色分兩種：

- **私密貼文**：雲端只是「加密備份桶」，上傳前已在客戶端加密，伺服器只存密文 blob
- **公開貼文**：走明文路徑存 Firestore，供分享頁渲染（伺服器讀得到——這是用戶的選擇，不是洩漏）

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
│      │                                   │
└──────┼───────────────────────────────────┘
       ▼
  Firebase: Auth（登入身份）
            Firestore（私密=密文 blob；公開=明文，供分享頁）
  分享頁: /s/{slug} 只讀公開貼文（無需登入）
```

### 加密層（crypto module）

- 使用者設定一組**通關密語**（passphrase），與登入密碼分開
- 金鑰衍生：`passphrase + salt → Argon2id（若瀏覽器支援困難則 PBKDF2, ≥600k iterations）→ AES-256-GCM key`
- 金鑰只存在記憶體 / session，**永不上傳**；salt 存 Firestore（salt 不是秘密）
- 每則貼文獨立加密（各自的 IV），密文才寫入 Firestore
- **密語遺失 = 私密貼文永久遺失**。沒有重設、沒有後門。這要在 onboarding 講得非常清楚，同時也是賣點：「連我們都救不回來，因為連我們都讀不到」
- **`contentHash`（SHA-256 of 明文）**：發布時計算，可塑期內隨編輯更新，**定形後不可變**——作為內容不變性的錨點：日後 Reveal 上傳的明文必須雜湊相符，防止「藉切換可見性偷改內容」
  - 誠實註記：明文雜湊無法還原內容，但持有者（含伺服器）可以「猜一段全文並驗證」，短貼文尤其可猜。這是支援伺服器端 Reveal 驗證的刻意取捨；若改用 HMAC 可堵住猜測，但伺服器就無法驗證。Phase 2 上雲前可再議
- 提供**匯出/匯入**：一個加密 JSON 檔就是你的一生（同時解決換裝置與備份焦慮）

### 登入與資料模型

- **Firebase Auth**（email link 或 Google 登入）— 只負責「你是誰」，不涉及內容解密
- Firestore 結構：

```
users/{uid}
  ├─ kdfSalt, kdfParams          # 金鑰衍生參數（非秘密）
  ├─ quotaUsed: number           # 彙總欄位＝posts 總數（含可塑期中的），分享頁顯示真實進度用
  ├─ publicSlug: string          # 分享連結 slug（隨機、可重生）
  ├─ posts/{id}                  # id = UUID
  │    n                         # 編號 1–100，發布時指定（＝發布順序）；定形後永不變動
  │    visibility                # 'private' | 'public'（Etch 當下選擇，之後 Reveal/Unlist）
  │    ciphertext?, iv?          # 私密時存這組
  │    plaintext?                # 公開時存這組（兩組互斥）
  │    contentHash               # SHA-256(明文)；可塑期內隨編輯更新，定形後不可變
  │    etchedAt                  # 發布時間；定形時刻 = etchedAt + 24h（純推導，不存欄位）
  │    lastEditedAt              # 發布或最後編輯時間（純紀錄，不影響任何窗口）
  │    struckAt?                 # 劃掉時間（一旦寫入不可再改；僅限定形後）
  └─ drafts/{id}
       ciphertext, iv, createdAt # 草稿自由空間：可編輯、可刪除，無時間約束

publicSlugs/{slug} → { uid, quotaUsed }  # 分享頁查詢用；重生 slug = 刪舊建新
                                 # quotaUsed 冗餘存這裡：分享頁只讀公開文件，
                                 # 不碰 users doc（避免曝露 kdfParams/kcv 等 metadata）
```

- 分享頁 `/s/{slug}`：經 `publicSlugs` 解析 uid，讀取 `visibility == 'public'` 的貼文 + `quotaUsed` 渲染。無需登入，無互動元件
- **不變性用 Firestore Security Rules 在後端強制**，不是只靠 UI：
  - `posts` 建立時檢查 `count(posts) < 100`（額度含可塑期中的貼文）、`etchedAt == request.time`、密文/明文欄位與 `visibility` 互斥
  - 可塑期內（`request.time < etchedAt + 24h`）：`allow update:` 內容編輯（`n`、`etchedAt` 不可動，`contentHash` 同步更新）、編號遞補（僅允許 `n` 減一、其餘不變）、可見性切換；`allow delete: if true`（刪除即退額度）
  - 定形後（`request.time >= etchedAt + 24h`）：`allow delete: if false`；`allow update:` 只放行「首次寫入 `struckAt`」與「可見性切換（`visibility` + 密文/明文欄位對調）」，`n`、`etchedAt`、`contentHash`、既有 `struckAt` 不可變
  - Rules 無法驗證「Reveal 上傳的明文雜湊等於 contentHash」（rules 不能算 SHA-256）→ 這項驗證放 **Cloud Function**（Phase 2 可先信任客戶端，函式驗證列為 Phase 2 收尾項）
  - `drafts`: 可自由建立、更新、刪除，無時間約束
  - 定形是純時間比較（`etchedAt + 24h`），不需要伺服器排程，也沒有狀態轉移要驗證——這是選「固定窗口」設計的架構紅利。規則本身就是產品承諾

### 前端技術棧

- **Vite + React + TypeScript**
- 狀態：先用 React 內建（useState/useReducer + context），不急著上狀態庫
- 樣式：Tailwind CSS
- 本地儲存：IndexedDB（用 `idb` 輕量 wrapper）
- Firebase 設定走 `VITE_FIREBASE_*` 環境變數（`.env`，範本見 `.env.example`）
- 部署：**Firebase Hosting，已上線 https://etch-5ae60.web.app**。`npm run build && firebase deploy --only hosting,firestore:rules`（rules 一律走 CLI 發布，repo 的 `firestore.rules` 就是唯一真相；SPA rewrite 已設定，`/s/{slug}` 直達分享頁）

## Roadmap

### Phase 1 — 核心閉環（MVP，純本地）
- [x] 專案腳手架（Vite + React + TS + Tailwind）
- [x] Crypto module：passphrase → 金鑰衍生 → AES-GCM 加解密 → 單元測試（先做，獨立驗證）
  - 註：採 PBKDF2-SHA256 600k iterations（規格的 fallback 路徑）。Argon2id 需要 WASM 庫，會破壞離線解密工具零依賴的前提；`kdf.algorithm` 欄位已保留演進空間
- [x] IndexedDB 本地儲存層（posts / drafts）
- [x] 寫作介面 + 草稿（可自由編輯、可刪除）
- [x] Etch 立即出版流程（確認問句：「十年後的你會想留著這則嗎？」）+ 發布即定號 + 額度扣減
- [x] 可塑期邏輯：發布後固定 24h（編輯不重置）可編輯（編號不變）、可刪除（退額度、編號遞補）；期滿即定形
- [x] 時間軸閱讀介面（編號、間隔可視化、可塑期倒數）
- [x] Strike 劃掉功能（僅限定形後）
- [x] 匯出/匯入加密 JSON
  - [x] 匯出檔自帶 KDF 參數（salt、演算法、iterations），解密只需通關密語，不依賴帳號或伺服器
  - [x] **公開格式規格**：`docs/EXPORT_FORMAT.md`（欄位定義、KDF 用法、AES-GCM IV 餵法），只用標準原語，讓任何人都能自行實作解密器。`tests/format-compat.test.ts` 用規格內的 node:crypto 參考實作交叉驗證，守住規格與實作的一致性
  - [x] **離線解密工具**：`public/etch-decryptor.html` 單檔 HTML（純 JS + Web Crypto API，零網路請求、零外部依賴），選檔案 + 輸入密語 → 顯示明文；可從備份頁下載。Etch 消失後它仍能打開你的一生——這是「你不需要我們」主權承諾的實體保證
- [x] Etch 時公開/私密二選一（本階段僅記錄意向 flag，分享頁 Phase 2 上線）+ `contentHash`（發布時計算，可塑期內隨編輯更新）

### Phase 2 — 帳號、同步與分享
- [x] Firebase Auth 登入（Google，`src/sync/firebase.ts`；登入身份與內容解密刻意分離）
- [x] 密文同步到 Firestore（本地為主，雲端為鏡像；差異同步，`src/sync/engine.ts`。通關密語解鎖 + KCV 驗證密語正確性；金鑰只在記憶體）
- [x] Security Rules 強制不變性 + 可塑期窗口 + 可見性欄位互斥（`firestore.rules`；額度目前以 n ∈ [1,100] 給上界，嚴格計數器驗證列為收尾項）
- [x] 多裝置：新裝置登入 → 輸入通關密語 → 拉密文 → 本地解密（備份頁「從雲端還原」）
- [x] 公開貼文明文同步 + 分享頁 `/s/{slug}`（無登入讀取；空缺可視化「中間 X 則沉默」+ 真實進度「已刻 X / 100」；`src/components/SharePage.tsx`）
- [x] Reveal / Unlist 切換（定形後亦可；Unlist 顯示誠實警語「已看過的人、截圖與網路快取無法收回」；Rules 只放行欄位對調且 contentHash 不可變）
- [x] 連結重生（Regenerate slug；另加「停用連結」——拆門但不動貼文可見性）
- [x] Cloud Function 驗證 Reveal 明文與 contentHash 相符（`functions/index.js`，不符即回滾）

**Phase 2 收尾項（程式碼全數完成，只差一個開關）：**

- [ ] **升級 Blaze 並部署 Cloud Functions**：Console 升級 Blaze 方案（綁卡；本產品的用量實際費用為 0）→ `firebase deploy --only functions`。一次部署兩個函式（`functions/index.js`）：
  - `verifyContentHash`：Reveal 明文＝contentHash 的伺服器端驗證，不符即回滾
  - `enforceQuota`：額度嚴格計數——rules 數不了集合，函式用伺服器端 count 仲裁：超過 100 則直接回收新建文件，並對帳 `users.quotaUsed` / `publicSlugs.quotaUsed` 彙總欄位
  - 未部署前這兩層信任客戶端——單人使用零風險，**開放他人使用前必須部署**

### Phase 3 — 之後再說
- [ ] 週年回訪通知 + 批註（每則限一次，不扣額度）
- [ ] username 式公開身份（`/u/{name}`，進階選項）
- [ ] 第 99 → 100 則的「最後一則」特殊模式
- [ ] 遺囑功能（一年未登入，寄給指定的人）

## 刻意不做的事

- 社交功能（讚、留言、追蹤、分享按鈕、閱讀數）——分享頁也不例外
- 通知轟炸、任何 engagement 優化
- 「忘記通關密語」的救援機制（沒有後門是特性）
- 假裝收回：不提供任何暗示「公開過的內容可以當作沒發生過」的功能或文案
- 富文本編輯器——純文字就好，最多支援換行
- 私密內容的後台審查工具（我們技術上就看不到）

## 給 Claude 的開發準則

- 任何功能實作前先問：這會不會削弱「稀缺、不可逆、私密」三個核心？會就不做
- 不變性與可塑期窗口必須同時在客戶端與 Security Rules 兩層強制，UI 只是第一道
- Crypto 相關代碼要有測試，且不要自己發明密碼學——只用 Web Crypto API 標準原語
- 私密貼文的明文永遠不離開客戶端；任何新的網路請求都要檢查 payload 是否只含密文與 metadata。唯一例外：用戶明確選擇公開的貼文明文
- 涉及可見性的 UI 文案，寧可嚇跑用戶也不可過度承諾
