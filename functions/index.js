'use strict';

// Etch Cloud Functions
//
// verifyContentHash：內容不變性的最後一道鎖。
// Security Rules 允許定形後切換可見性（Reveal 會上傳明文），但 rules 算不了
// SHA-256，無法驗證「上傳的明文 === 當年刻下的內容」。這個 trigger 補上這一刀：
// 任何公開貼文寫入後，立刻驗證 SHA-256(plaintext) 是否等於 contentHash；
// 不符就整份回滾到寫入前的狀態——偷改的內容一秒都不該公開存在。
//
// 部署需要 Blaze 方案：firebase deploy --only functions

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { createHash } = require('node:crypto');
const admin = require('firebase-admin');

admin.initializeApp();

exports.verifyContentHash = onDocumentWritten(
  'users/{uid}/posts/{postId}',
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return; // 刪除不用驗

    const post = after.data();
    if (post.visibility !== 'public') return; // 私密貼文只有密文，無從驗也不必驗
    if (typeof post.plaintext !== 'string' || typeof post.contentHash !== 'string') {
      return; // 形狀不對的寫入 rules 就該擋掉；這裡不重複把關
    }

    const actual = createHash('sha256').update(post.plaintext, 'utf8').digest('hex');
    if (actual === post.contentHash) return;

    // 雜湊不符 = 有人試圖藉 Reveal 偷改內容
    const before = event.data.before;
    if (before && before.exists) {
      await after.ref.set(before.data()); // 回滾到寫入前的狀態
    } else {
      await after.ref.delete(); // 出生就不誠實的文件，直接抹掉
    }
    console.warn(
      `contentHash 不符，已回滾：users/${event.params.uid}/posts/${event.params.postId}`,
    );
  },
);
