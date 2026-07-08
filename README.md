# Etch

**一生只能發 100 則貼文的自我反思 app。**

🔗 線上版：**https://etch-5ae60.web.app**

## 這是什麼

Etch 的核心哲學是**稀缺性逼人認真**。真正的產品不是貼文功能，而是「要不要用掉這一則」的猶豫過程——那才是反思發生的地方。

每則貼文像刻在濕黏土上：剛刻完的 24 小時內還能修幾刀，時間一到準時進窯燒成陶——再也改不了。

### 規則

- **一生只有 100 則額度**，用完就沒有了
- **按下 Etch 立刻發布**：立刻取得編號（No. X / 100）、立刻用掉一則額度
- **可塑期**：發布後 24 小時內可編輯（編號不變）、可刪除（額度退還）。窗口固定，編輯不延長
- **定形**：24 小時一到，永遠不可編輯、不可刪除。唯一的例外是**劃掉（Strike）**——劃掉的貼文仍然可見、仍佔額度，代表「我曾經這樣想，現在不了」。每則只能劃掉一次，劃掉也不可逆
- **沒有讚、沒有留言、沒有追蹤、沒有演算法**。貼文只有編號和時間；兩則之間的沉默也是內容
- **預設完全私密**。每則可在出版當下選擇「刻給自己」或「刻給世界」，之後可雙向切換（Reveal / Unlist）

## 隱私與資料主權

> 「私密貼文端對端加密，連我們都讀不到；公開貼文是你選擇給世界看的，以明文儲存。」

- **本地優先**：資料主體存在你裝置的 IndexedDB，不登入就能完整使用
- **E2E 加密備份**：登入後可同步到雲端，但上傳前已在客戶端以你的**通關密語**加密（PBKDF2 600k + AES-256-GCM），伺服器只存密文。**密語遺失＝資料永久遺失**——沒有重設、沒有後門，這是特性不是缺陷
- **你不需要我們**：
  - 匯出功能給你一個加密 JSON 檔——[格式完全公開](docs/EXPORT_FORMAT.md)，只用標準密碼學原語，任何人都能自行實作解密器
  - 附帶[單檔離線解密工具](public/etch-decryptor.html)（純 HTML + Web Crypto，零依賴、零網路請求）。就算 Etch 消失了，它配上你的密語仍然打得開你的一生
- **分享**：一條不可猜測的隨機連結（可換鎖、可拆門），訪客只看得到你選擇公開的貼文——編號、空缺（「中間 X 則沉默」）與真實進度照留
- **不變性是後端強制的**：可塑期、定形、Strike 一次、額度上限都寫在 [Firestore Security Rules](firestore.rules) 裡，並有 [Cloud Functions](functions/index.js) 做伺服器端仲裁——規則本身就是產品承諾

## 技術棧

Vite + React + TypeScript + Tailwind CSS｜IndexedDB（idb）｜Web Crypto API｜Firebase（Auth / Firestore / Hosting / Functions）

架構細節、產品規則的完整定義與 roadmap 見 [CLAUDE.md](CLAUDE.md)。

## 開發

```bash
npm install
cp .env.example .env   # 填入 Firebase 專案設定（Console → 專案設定 → 你的應用程式）
npm run dev            # http://localhost:5173
```

### 測試

```bash
npm test               # 單元測試：crypto、儲存不變量、匯出格式、同步映射
npm run test:rules     # Security Rules 測試（需 Java；以 emulator 模擬本人／別人／訪客三種身份）
```

改動 `firestore.rules` 必須先通過 `test:rules` 才能部署。

### 部署

```bash
npm run build
firebase deploy --only hosting,firestore:rules
firebase deploy --only functions   # 需 Blaze 方案
```

## 刻意不做的事

社交功能（讚、留言、追蹤、閱讀數）、通知轟炸、任何 engagement 優化、「忘記密語」的救援機制、富文本編輯器、假裝收回（不提供任何暗示「公開過的內容可以當作沒發生過」的功能），以及私密內容的後台審查工具——我們技術上就看不到。

---

用完就沒有了。這不是限制，是為了讓每一則都值得。
