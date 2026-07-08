# Etch 匯出檔格式規格（etch-export v1）

這份文件是公開規格。目的：**任何人不依賴 Etch 也能解密自己的資料**。
全部只用標準密碼學原語（PBKDF2、AES-GCM），任何主流語言的標準庫或
Web Crypto API 都能實作解密器。repo 內附的 `public/etch-decryptor.html`
是參考實作——單檔 HTML、零依賴、可離線執行。

格式一經發佈即為承諾：欄位語義不會改變；任何不相容的變更都會升 `version`，
且解密工具必須永遠保留舊版支援。

## 檔案結構

匯出檔是一個 UTF-8 編碼的 JSON 檔。**檔案本身是明文**，但每則內容
（`ciphertext`）是密文。metadata（編號、時間戳）刻意保留明文，讓匯入與
渲染時間軸不需要先解密。

```json
{
  "format": "etch-export",
  "version": 1,
  "exportedAt": "2026-07-08T10:00:00.000Z",
  "kdf": {
    "algorithm": "PBKDF2-SHA256",
    "iterations": 600000,
    "salt": "<base64，16 bytes>"
  },
  "cipher": "AES-256-GCM",
  "quotaUsed": 23,
  "posts": [
    {
      "id": "<uuid>",
      "n": 1,
      "ciphertext": "<base64>",
      "iv": "<base64，12 bytes>",
      "etchedAt": "2026-01-15T08:30:00.000Z",
      "lastEditedAt": "2026-01-15T08:30:00.000Z",
      "struckAt": null
    }
  ],
  "drafts": [
    {
      "id": "<uuid>",
      "ciphertext": "<base64>",
      "iv": "<base64，12 bytes>",
      "createdAt": "2026-07-01T12:00:00.000Z",
      "updatedAt": "2026-07-01T12:00:00.000Z"
    }
  ]
}
```

| 欄位 | 說明 |
| --- | --- |
| `format` | 固定為 `"etch-export"`，識別用 |
| `version` | 格式版本，目前為 `1` |
| `exportedAt` | 匯出時間，ISO 8601 |
| `kdf` | 金鑰衍生參數（見下）。salt 不是秘密 |
| `cipher` | 固定為 `"AES-256-GCM"` |
| `quotaUsed` | 已用額度（0–100）＝ `posts` 的則數，含可塑期中的貼文 |
| `posts[].id` | 貼文的穩定識別碼（UUID） |
| `posts[].n` | 貼文編號 1–100，發布時指定（＝發布順序），永遠緊湊 |
| `posts[].etchedAt` | 發布時間；**定形時刻 = `etchedAt` + 24h**（可推導，不另存欄位） |
| `posts[].lastEditedAt` | 發布或最後一次編輯的時間（純紀錄，不影響任何窗口） |
| `posts[].struckAt` | 劃掉時間；未劃掉為 `null` |
| `drafts[].createdAt` | 草稿建立時間 |

貼文生命週期：發布（Etch）即取得編號、佔一則額度。發布後 24 小時內是**可塑期**
（錨定 `etchedAt`，編輯不重置）：可編輯（編號不變）、可刪除（額度退還，之後的
貼文編號往前遞補——它們必然發布得更晚、仍在各自的可塑期內，因此已定形的編號
永不變動）。期滿即**定形**：不可編輯、不可刪除，僅可劃掉一次（`struckAt`）。

## 金鑰衍生（KDF）

```
key = PBKDF2(
  password   = 通關密語（UTF-8 bytes）,
  salt       = base64decode(kdf.salt),
  iterations = kdf.iterations,      // ≥ 600,000
  hash       = SHA-256,
  keyLength  = 256 bits
)
```

- `kdf.algorithm` 目前只有 `"PBKDF2-SHA256"`。若未來加入 Argon2id，
  會使用新的 algorithm 值，舊檔案仍照本節解密。
- 同一個匯出檔內所有 posts / drafts 共用同一把 key。

## 內容加密

每則內容獨立加密：

```
plaintext  = 貼文原文（UTF-8 bytes，純文字，僅含換行）
iv         = 隨機 12 bytes（每則各自產生，base64 存於該則的 iv 欄位）
ciphertext = AES-256-GCM(key, iv, plaintext)   // 無 additional authenticated data
```

- GCM 認證標籤（16 bytes）**附加在密文尾端**（Web Crypto API 的預設行為）。
  使用 OpenSSL / cryptography 等把 tag 分開處理的庫時，取密文最後 16 bytes 作為 tag。
- 解密失敗（標籤驗證不過）代表：通關密語錯誤，或檔案被竄改/損毀。

## 參考實作（Node.js，僅用標準庫）

```js
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';

const file = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const passphrase = process.argv[3];

const key = pbkdf2Sync(
  Buffer.from(passphrase, 'utf8'),
  Buffer.from(file.kdf.salt, 'base64'),
  file.kdf.iterations, 32, 'sha256');

for (const post of file.posts) {
  const data = Buffer.from(post.ciphertext, 'base64');
  const ct = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(post.iv, 'base64'));
  decipher.setAuthTag(tag);
  const text = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  console.log(`No. ${post.n} (${post.etchedAt})${post.struckAt ? ' [已劃掉]' : ''}\n${text}\n`);
}
```

用法：`node decrypt.mjs etch-export-2026-07-08.json '你的通關密語'`

## 安全性質與限制

- 沒有通關密語就無法讀取內容。**密語遺失＝資料永久遺失**，這是設計而非缺陷。
- 明文 metadata 洩漏的資訊：貼文數量、發文時間分佈、哪幾則被劃掉、草稿數量。
  若這對你也是敏感資訊，請把整個檔案再放進你信任的加密容器。
- 匯出檔可以放在任何雲端硬碟——它的安全性來自密碼學，不來自存放位置。
