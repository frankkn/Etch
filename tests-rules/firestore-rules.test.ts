import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

/**
 * 對真正的 firestore.rules 跑權限測試（Firestore emulator）。
 * 三種身份：本人（alice）、別人（mallory）、未登入訪客。
 * 這裡驗的是產品承諾本身：可塑期、定形、Strike 一次、額度邊界、
 * 分享頁讀取、slug 防枚舉。
 */

let env: RulesTestEnvironment;

const HOUR = 3_600_000;
const ts = (offsetMs: number) => Timestamp.fromMillis(Date.now() + offsetMs);

/** 可塑期中的私密貼文（發布於 1 分鐘前） */
const freshPost = (over: Record<string, unknown> = {}) => ({
  n: 1,
  visibility: 'private',
  contentHash: 'a'.repeat(64),
  ciphertext: 'ZmFrZS1jaXBoZXJ0ZXh0',
  iv: 'aXYtZmFrZQ==',
  etchedAt: ts(-60_000),
  lastEditedAt: ts(-60_000),
  struckAt: null,
  ...over,
});

/** 定形的私密貼文（發布於 25 小時前） */
const hardenedPost = (over: Record<string, unknown> = {}) =>
  freshPost({ etchedAt: ts(-25 * HOUR), lastEditedAt: ts(-25 * HOUR), ...over });

const publicFields = (text = '公開的話') => ({
  visibility: 'public',
  plaintext: text,
  ciphertext: undefined,
  iv: undefined,
});

/** 以管理者身份植入資料（繞過 rules，模擬既有狀態） */
async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

function alice() {
  return env.authenticatedContext('alice').firestore();
}
function mallory() {
  return env.authenticatedContext('mallory').firestore();
}
function visitor() {
  return env.unauthenticatedContext().firestore();
}

const clean = (obj: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'etch-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed('users/alice', { quotaUsed: 1 });
});

describe('身份界線', () => {
  it('本人可讀寫自己的 users 文件；別人與訪客不行', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'users/alice')));
    await assertFails(getDoc(doc(mallory(), 'users/alice')));
    await assertFails(getDoc(doc(visitor(), 'users/alice')));
    await assertFails(
      setDoc(doc(mallory(), 'users/alice'), { quotaUsed: 0 }),
    );
  });

  it('users 文件不可刪除；quotaUsed 超界拒絕', async () => {
    await assertFails(deleteDoc(doc(alice(), 'users/alice')));
    await assertFails(setDoc(doc(alice(), 'users/alice'), { quotaUsed: 101 }));
    await assertFails(setDoc(doc(alice(), 'users/alice'), { quotaUsed: -1 }));
  });

  it('users 文件可只更新 quotaUsed（merge）——公開路徑同步的對帳寫法', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'users/alice'), { quotaUsed: 2 }, { merge: true }),
    );
  });

  it('別人不能碰我的貼文與草稿', async () => {
    await seed('users/alice/posts/p1', freshPost());
    await assertFails(getDoc(doc(mallory(), 'users/alice/posts/p1')));
    await assertFails(deleteDoc(doc(mallory(), 'users/alice/posts/p1')));
    await assertFails(
      setDoc(doc(mallory(), 'users/alice/drafts/d1'), {
        ciphertext: 'x',
        iv: 'y',
        createdAt: ts(0),
        updatedAt: ts(0),
      }),
    );
  });
});

describe('發布（create）', () => {
  it('合法的私密／公開貼文可建立', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'users/alice/posts/p1'), freshPost()),
    );
    await assertSucceeds(
      setDoc(
        doc(alice(), 'users/alice/posts/p2'),
        clean(freshPost({ n: 2, ...publicFields() })),
      ),
    );
  });

  it('拒絕：發布時間在未來、出生即劃掉、編號越界', async () => {
    await assertFails(
      setDoc(
        doc(alice(), 'users/alice/posts/p1'),
        freshPost({ etchedAt: ts(HOUR), lastEditedAt: ts(HOUR) }),
      ),
    );
    await assertFails(
      setDoc(doc(alice(), 'users/alice/posts/p1'), freshPost({ struckAt: ts(0) })),
    );
    await assertFails(
      setDoc(doc(alice(), 'users/alice/posts/p1'), freshPost({ n: 0 })),
    );
    await assertFails(
      setDoc(doc(alice(), 'users/alice/posts/p1'), freshPost({ n: 101 })),
    );
  });

  it('拒絕：私密夾帶明文、公開夾帶密文（欄位互斥）', async () => {
    await assertFails(
      setDoc(
        doc(alice(), 'users/alice/posts/p1'),
        freshPost({ plaintext: '偷渡明文' }),
      ),
    );
    await assertFails(
      setDoc(
        doc(alice(), 'users/alice/posts/p1'),
        clean(freshPost({ ...publicFields(), ciphertext: 'leftover' })),
      ),
    );
  });
});

describe('可塑期（發布後 24 小時）', () => {
  it('編號可連續遞補（一次一位）；一次跳兩位拒絕', async () => {
    // engine 的 stepDownN 依賴這個行為：跨多位遞補時逐步降
    await seed('users/alice/posts/p1', freshPost({ n: 5 }));
    await assertFails(updateDoc(doc(alice(), 'users/alice/posts/p1'), { n: 3 }));
    await assertSucceeds(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), { n: 4 }),
    );
    await assertSucceeds(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), { n: 3 }),
    );
  });

  it('可編輯內容（etchedAt 不可動）、編號可遞補一位、可刪除', async () => {
    await seed('users/alice/posts/p1', freshPost({ n: 5 }));
    await assertSucceeds(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), {
        ciphertext: 'bmV3LWNpcGhlcg==',
        iv: 'bmV3aXY=',
        contentHash: 'b'.repeat(64),
        lastEditedAt: ts(0),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), { n: 4 }),
    );
    await assertFails(updateDoc(doc(alice(), 'users/alice/posts/p1'), { n: 6 }));
    await assertFails(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), { etchedAt: ts(0) }),
    );
    await assertSucceeds(deleteDoc(doc(alice(), 'users/alice/posts/p1')));
  });
});

describe('定形（發布超過 24 小時）', () => {
  it('不可編輯、不可刪除', async () => {
    await seed('users/alice/posts/p1', hardenedPost());
    await assertFails(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), {
        ciphertext: 'dGFtcGVyZWQ=',
        lastEditedAt: ts(0),
      }),
    );
    await assertFails(deleteDoc(doc(alice(), 'users/alice/posts/p1')));
  });

  it('Strike：只能寫一次 struckAt，且不能夾帶其他變更', async () => {
    await seed('users/alice/posts/p1', hardenedPost());
    await assertFails(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), {
        struckAt: ts(0),
        contentHash: 'c'.repeat(64), // 夾帶
      }),
    );
    await assertSucceeds(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), { struckAt: ts(0) }),
    );
    await assertFails(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), { struckAt: ts(60_000) }),
    );
  });

  it('Reveal：欄位對調且 contentHash 不變 → 放行；動到 contentHash → 拒絕', async () => {
    await seed('users/alice/posts/p1', hardenedPost());
    await assertFails(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), {
        visibility: 'public',
        plaintext: '假的原文',
        ciphertext: null, // 未真正移除欄位——形狀不合法
        iv: null,
      }),
    );
    await assertFails(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), {
        visibility: 'public',
        plaintext: '假的原文',
        contentHash: 'd'.repeat(64), // 想換錨點——擋
      }),
    );
  });

  it('Reveal：欄位真正對調（明文入、密文移除）且 contentHash 不變 → 放行', async () => {
    // engine 的 pushPublic 依賴：Reveal 不需要金鑰也能在定形後完成
    await seed('users/alice/posts/p1', hardenedPost());
    const { deleteField } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), {
        visibility: 'public',
        plaintext: '多年後決定讓它見光',
        ciphertext: deleteField(),
        iv: deleteField(),
      }),
    );
  });

  it('補回定形貼文（兩段式）：先以未劃掉的樣子建立，再首次寫入 struckAt', async () => {
    // engine 的 putPostDoc 依賴：可塑期內 Unlist 刪除的雲端文件，解鎖後要能重建
    await assertSucceeds(
      setDoc(doc(alice(), 'users/alice/posts/p1'), hardenedPost()),
    );
    await assertSucceeds(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), { struckAt: ts(0) }),
    );
  });

  it('Unlist：公開切回私密（密文補回、明文移除）→ 放行', async () => {
    await seed(
      'users/alice/posts/p1',
      clean(hardenedPost({ ...publicFields() })),
    );
    const { deleteField } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(alice(), 'users/alice/posts/p1'), {
        visibility: 'private',
        ciphertext: 'YmFjay10by1jaXBoZXI=',
        iv: 'aXYy',
        plaintext: deleteField(),
      }),
    );
  });
});

describe('分享頁（未登入訪客）', () => {
  it('訪客可讀公開貼文、不可讀私密貼文', async () => {
    await seed('users/alice/posts/pub', clean(hardenedPost({ ...publicFields() })));
    await seed('users/alice/posts/priv', hardenedPost({ n: 2 }));
    await assertSucceeds(getDoc(doc(visitor(), 'users/alice/posts/pub')));
    await assertFails(getDoc(doc(visitor(), 'users/alice/posts/priv')));
  });

  it('訪客可用 visibility == public 條件查詢；不帶條件的全撈拒絕', async () => {
    await seed('users/alice/posts/pub', clean(hardenedPost({ ...publicFields() })));
    const posts = collection(visitor(), 'users/alice/posts');
    await assertSucceeds(
      getDocs(query(posts, where('visibility', '==', 'public'))),
    );
    await assertFails(getDocs(posts));
  });

  it('slug：訪客可 get、不可 list（防枚舉）', async () => {
    await seed('publicSlugs/Kq9mR2abcdEF', { uid: 'alice', quotaUsed: 1 });
    await assertSucceeds(getDoc(doc(visitor(), 'publicSlugs/Kq9mR2abcdEF')));
    await assertFails(getDocs(collection(visitor(), 'publicSlugs')));
  });

  it('slug 管理：本人可建立/刪除；不能替別人建、訪客不能建', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'publicSlugs/newSlugAaBb2'), {
        uid: 'alice',
        quotaUsed: 1,
      }),
    );
    await assertFails(
      setDoc(doc(mallory(), 'publicSlugs/stolenSlug99'), {
        uid: 'alice', // mallory 想替 alice 開門
        quotaUsed: 1,
      }),
    );
    await assertFails(
      setDoc(doc(visitor(), 'publicSlugs/anonSlug1234'), {
        uid: 'alice',
        quotaUsed: 1,
      }),
    );
    await assertSucceeds(deleteDoc(doc(alice(), 'publicSlugs/newSlugAaBb2')));
    // 別人不能拆我的門
    await seed('publicSlugs/aliceDoor123', { uid: 'alice', quotaUsed: 1 });
    await assertFails(deleteDoc(doc(mallory(), 'publicSlugs/aliceDoor123')));
  });
});
