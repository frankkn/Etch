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

// enforceQuota：額度的嚴格計數（Phase 2 收尾項）。
// Security Rules 數不了集合，只能用 n ∈ [1,100] 給上界——惡意客戶端仍可能塞出
// 重複編號或操弄彙總欄位。這個 trigger 用伺服器端 count 做最終仲裁：
//   1. 超過 100 則：剛建立的那筆直接刪除（一生只有 100 則，不是建議，是物理）
//   2. 對帳：users.quotaUsed 與 publicSlugs/{slug}.quotaUsed 以真實 count 為準
exports.enforceQuota = onDocumentWritten(
  'users/{uid}/posts/{postId}',
  async (event) => {
    const db = admin.firestore();
    const { uid } = event.params;
    const postsCol = db.collection(`users/${uid}/posts`);

    const countSnap = await postsCol.count().get();
    const count = countSnap.data().count;

    const before = event.data && event.data.before;
    const after = event.data && event.data.after;
    const isCreate = after && after.exists && (!before || !before.exists);

    if (count > 100 && isCreate) {
      await after.ref.delete(); // 會再觸發一次本函式，屆時 count ≤ 100 走對帳路徑
      console.warn(`額度超限，已回收：users/${uid}/posts/${event.params.postId}`);
      return;
    }

    // 對帳彙總欄位（客戶端寫錯或漂移時，以伺服器計數為準）
    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return;
    if (userSnap.get('quotaUsed') !== count) {
      await userRef.set({ quotaUsed: count }, { merge: true });
    }
    const slug = userSnap.get('publicSlug');
    if (slug) {
      const slugRef = db.doc(`publicSlugs/${slug}`);
      const slugSnap = await slugRef.get();
      if (slugSnap.exists && slugSnap.get('quotaUsed') !== count) {
        await slugRef.set({ uid, quotaUsed: count }, { merge: true });
      }
    }
  },
);
