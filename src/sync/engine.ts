import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  createKdfParams,
  decryptText,
  deriveKey,
  encryptText,
  type KdfParams,
} from '../crypto';
import {
  getKcv,
  getKdfParams,
  importAll,
  isMalleable,
  isStoreEmpty,
  listDrafts,
  listPosts,
  setKcv,
  setKdfParams,
  type Kcv,
} from '../storage/db';
import { auth, db } from './firebase';
import { getSessionKey, setSessionKey } from './keySession';
import {
  cloudPostDiffers,
  fromCloudDraft,
  fromCloudPost,
  toCloudDraft,
  toCloudPost,
  type CloudDraft,
  type CloudPost,
} from './mapping';

const KCV_PLAINTEXT = 'etch-kcv:v1';

interface UserDoc {
  kdfParams?: KdfParams;
  kcv?: Kcv;
  quotaUsed?: number;
}

function requireUid(): string {
  const user = auth.currentUser;
  if (!user) throw new Error('尚未登入');
  return user.uid;
}

async function fetchUserDoc(uid: string): Promise<UserDoc | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as UserDoc) : null;
}

/** 雲端是否已有這個帳號的資料（用來決定顯示「還原」還是「開始同步」）。 */
export async function cloudHasData(): Promise<boolean> {
  const uid = requireUid();
  const userDoc = await fetchUserDoc(uid);
  return userDoc?.kdfParams != null;
}

/**
 * 解鎖同步：驗證（或首次建立）通關密語，把金鑰放進 session。
 * KCV 驗證順序：本地 → 雲端 → 都沒有就視為首次設定。
 * 金鑰與密語永不上傳；上傳的只有 kdfParams（非秘密）與 KCV（密文）。
 */
export async function unlockSync(passphrase: string): Promise<void> {
  const uid = requireUid();
  const cloudUser = await fetchUserDoc(uid);

  // kdfParams 以既有者為準：本地 → 雲端 → 新建
  const kdf =
    (await getKdfParams()) ?? cloudUser?.kdfParams ?? createKdfParams();
  const key = await deriveKey(passphrase, kdf);

  const kcv = (await getKcv()) ?? cloudUser?.kcv ?? null;
  if (kcv) {
    try {
      const plain = await decryptText(key, kcv);
      if (plain !== KCV_PLAINTEXT) throw new Error('bad kcv');
    } catch {
      throw new Error('通關密語錯誤');
    }
    await setKcv(kcv);
  } else {
    const fresh = await encryptText(key, KCV_PLAINTEXT);
    await setKcv(fresh);
  }
  await setKdfParams(kdf);
  setSessionKey(key);
}

/**
 * 推送：本地為主，雲端是本地的鏡像。
 * - 新增/可塑期變更 → 整份覆寫（Rules 在可塑期內放行）
 * - 定形後的 Strike → 只更新 struckAt 欄位（不重加密，Rules 只放行這一種變更）
 * - 本地不存在的雲端貼文 → 刪除（只可能是可塑期內刪掉的）
 */
export async function pushAll(): Promise<string> {
  const uid = requireUid();
  const key = getSessionKey();
  if (!key) throw new Error('尚未解鎖同步');
  const kdf = await getKdfParams();
  const kcv = await getKcv();
  if (!kdf || !kcv) throw new Error('尚未解鎖同步');

  const [posts, drafts] = await Promise.all([listPosts(), listDrafts()]);

  const postsCol = collection(db, 'users', uid, 'posts');
  const draftsCol = collection(db, 'users', uid, 'drafts');
  const [cloudPosts, cloudDrafts] = await Promise.all([
    getDocs(postsCol),
    getDocs(draftsCol),
  ]);
  const cloudPostById = new Map(
    cloudPosts.docs.map((d) => [d.id, d.data() as CloudPost]),
  );
  const cloudDraftById = new Map(
    cloudDrafts.docs.map((d) => [d.id, d.data() as CloudDraft]),
  );

  let uploaded = 0;
  let removed = 0;
  let skipped = 0;

  for (const post of posts) {
    const cloud = cloudPostById.get(post.id);
    cloudPostById.delete(post.id);
    if (cloud && !cloudPostDiffers(post, cloud)) continue;
    if (!cloud || isMalleable(post)) {
      await setDoc(doc(postsCol, post.id), await toCloudPost(post, key));
      uploaded++;
    } else if (
      post.struckAt !== null &&
      (cloud.struckAt === null || cloud.struckAt === undefined)
    ) {
      // 定形後唯一合法的變更：首次 Strike
      const struck = await toCloudPost(post, key);
      await updateDoc(doc(postsCol, post.id), { struckAt: struck.struckAt });
      uploaded++;
    } else {
      // 定形後的其他差異不該存在；不硬推（Rules 也會拒絕），留給人工檢查
      console.warn(`同步略過 No. ${post.n}（定形後出現非 Strike 差異）`);
      skipped++;
    }
  }
  for (const id of cloudPostById.keys()) {
    await deleteDoc(doc(postsCol, id));
    removed++;
  }

  for (const draft of drafts) {
    const cloud = cloudDraftById.get(draft.id);
    cloudDraftById.delete(draft.id);
    if (cloud && cloud.updatedAt.toDate().toISOString() === draft.updatedAt) {
      continue;
    }
    await setDoc(doc(draftsCol, draft.id), await toCloudDraft(draft, key));
    uploaded++;
  }
  for (const id of cloudDraftById.keys()) {
    await deleteDoc(doc(draftsCol, id));
    removed++;
  }

  await setDoc(
    doc(db, 'users', uid),
    { kdfParams: kdf, kcv, quotaUsed: posts.length, updatedAt: serverTimestamp() },
    { merge: true },
  );

  return (
    `已同步：上傳 ${uploaded}、刪除 ${removed}` +
    (skipped > 0 ? `、略過 ${skipped}（見主控台）` : '')
  );
}

/**
 * 還原（僅限全新裝置）：輸入通關密語 → 拉雲端密文 → 本地解密寫入。
 */
export async function restoreAll(passphrase: string): Promise<string> {
  const uid = requireUid();
  if (!(await isStoreEmpty())) {
    throw new Error('本機已有資料，不能還原覆蓋');
  }
  const cloudUser = await fetchUserDoc(uid);
  if (!cloudUser?.kdfParams) throw new Error('雲端沒有這個帳號的備份');
  const key = await deriveKey(passphrase, cloudUser.kdfParams);
  if (cloudUser.kcv) {
    try {
      const plain = await decryptText(key, cloudUser.kcv);
      if (plain !== KCV_PLAINTEXT) throw new Error('bad kcv');
    } catch {
      throw new Error('通關密語錯誤');
    }
  }

  const [cloudPosts, cloudDrafts] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'posts')),
    getDocs(collection(db, 'users', uid, 'drafts')),
  ]);
  const posts = [];
  for (const snap of cloudPosts.docs) {
    posts.push(await fromCloudPost(snap.id, snap.data() as CloudPost, key));
  }
  const drafts = [];
  for (const snap of cloudDrafts.docs) {
    drafts.push(await fromCloudDraft(snap.id, snap.data() as CloudDraft, key));
  }
  await importAll(posts, drafts, cloudUser.kdfParams);
  if (cloudUser.kcv) await setKcv(cloudUser.kcv);
  setSessionKey(key);
  return `已還原 ${posts.length} 則貼文、${drafts.length} 則草稿`;
}

// ---- 自動推送：每次本地變動後（App.refresh）輕輕推一把 ----

let autoPushTimer: ReturnType<typeof setTimeout> | null = null;

export function autoPushSoon(): void {
  if (!auth.currentUser || !getSessionKey()) return;
  if (autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(() => {
    autoPushTimer = null;
    pushAll().catch((e) => console.warn('自動同步失敗（稍後可手動同步）：', e));
  }, 2_000);
}
