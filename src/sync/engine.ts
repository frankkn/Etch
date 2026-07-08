import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentReference,
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
  type Post,
} from '../storage/db';
import { auth, db } from './firebase';
import { getSessionKey, setSessionKey } from './keySession';
import { generateSlug } from './slug';
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
  publicSlug?: string;
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

/** 編號遞補：Rules 一次只准減一，跨多位時逐步降到目標值。 */
async function stepDownN(
  ref: DocumentReference,
  from: number,
  to: number,
): Promise<void> {
  for (let k = from - 1; k >= to; k--) {
    await updateDoc(ref, { n: k });
  }
}

/**
 * 寫入整份貼文文件。定形且已劃掉的貼文無法一次建立（create 不收 struckAt）：
 * 先以未劃掉的樣子建立，再走「定形後首次 Strike」的規則分支補上。
 */
async function putPostDoc(
  ref: DocumentReference,
  post: Post,
  data: CloudPost,
): Promise<void> {
  if (!isMalleable(post) && post.struckAt !== null) {
    await setDoc(ref, { ...data, struckAt: null });
    await updateDoc(ref, {
      struckAt: Timestamp.fromMillis(Date.parse(post.struckAt)),
    });
  } else {
    await setDoc(ref, data);
  }
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
      const ref = doc(postsCol, post.id);
      if (cloud && cloud.n > post.n + 1) {
        await stepDownN(ref, cloud.n, post.n + 1); // 最後一位由整份覆寫一起完成
      }
      await putPostDoc(ref, post, await toCloudPost(post, key));
      uploaded++;
      continue;
    }
    // 定形後合法的變更只有兩種，Rules 各有一條放行分支，必須分開送
    let touched = false;
    if (
      post.struckAt !== null &&
      (cloud.struckAt === null || cloud.struckAt === undefined)
    ) {
      await updateDoc(doc(postsCol, post.id), {
        struckAt: Timestamp.fromMillis(Date.parse(post.struckAt)),
      });
      touched = true;
    }
    if (post.visibility !== cloud.visibility) {
      if (post.visibility === 'public') {
        // Reveal：換成明文路徑（contentHash 不變，是防偷改的錨點）
        await updateDoc(doc(postsCol, post.id), {
          visibility: 'public',
          plaintext: post.text,
          ciphertext: deleteField(),
          iv: deleteField(),
        });
      } else {
        // Unlist：回到加密儲存，不再對外展示
        const blob = await encryptText(key, post.text);
        await updateDoc(doc(postsCol, post.id), {
          visibility: 'private',
          ciphertext: blob.ciphertext,
          iv: blob.iv,
          plaintext: deleteField(),
        });
      }
      touched = true;
    }
    if (touched) {
      uploaded++;
    } else {
      // 定形後的其他差異不該存在；不硬推（Rules 也會拒絕），留給人工檢查
      console.warn(`同步略過 No. ${post.n}（定形後出現非法差異）`);
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

  // 分享連結存在時，同步真實進度到公開的 slug 文件（分享頁只讀這份公開資料）
  const userDoc = await fetchUserDoc(uid);
  if (userDoc?.publicSlug) {
    await setDoc(doc(db, 'publicSlugs', userDoc.publicSlug), {
      uid,
      quotaUsed: posts.length,
    });
  }

  return (
    `已同步：上傳 ${uploaded}、刪除 ${removed}` +
    (skipped > 0 ? `、略過 ${skipped}（見主控台）` : '')
  );
}

/**
 * 公開路徑同步（登入即可，不需要通關密語）：只推送無需金鑰的變更。
 * 涵蓋：公開貼文的新增／編輯／刪除、Reveal（含定形後）、Strike、
 * 編號遞補（公私貼文的 n 都是明文 metadata）、quotaUsed 對帳。
 * 不涵蓋（需解鎖）：私密貼文內容與草稿的上傳、定形後的 Unlist——
 * 這些需要金鑰產生密文，留給解鎖後的 pushAll。
 * 可塑期內的 Unlist 以「刪除雲端文件」立即下架，解鎖後由 pushAll 補回密文版本。
 *
 * 安全邊界：雲端已有加密備份（kdfParams 存在）而本機從未同步過（新裝置尚未還原）
 * 時整個拒推，避免把別台裝置的備份誤當成「本地已刪除」而清掉。
 */
export async function pushPublic(): Promise<string> {
  const uid = requireUid();
  const [kdf, kcv] = await Promise.all([getKdfParams(), getKcv()]);
  const established = kdf !== null && kcv !== null;
  const cloudUser = await fetchUserDoc(uid);
  if (!established && cloudUser?.kdfParams) {
    throw new Error(
      '這台裝置尚未同步過。請先「從雲端還原」或解鎖同步，避免覆寫雲端備份',
    );
  }

  const posts = await listPosts();
  const postsCol = collection(db, 'users', uid, 'posts');
  const cloudPosts = await getDocs(postsCol);
  const cloudPostById = new Map(
    cloudPosts.docs.map((d) => [d.id, d.data() as CloudPost]),
  );

  let uploaded = 0;
  let removed = 0;
  let pending = 0;

  for (const post of posts) {
    const cloud = cloudPostById.get(post.id);
    cloudPostById.delete(post.id);
    if (cloud && !cloudPostDiffers(post, cloud)) continue;
    const ref = doc(postsCol, post.id);

    if (post.visibility === 'public') {
      if (!cloud || isMalleable(post)) {
        if (cloud && cloud.n > post.n + 1) {
          await stepDownN(ref, cloud.n, post.n + 1);
        }
        await putPostDoc(ref, post, await toCloudPost(post, null));
        uploaded++;
      } else {
        // 定形的公開貼文：無金鑰可完成的只有 Strike 與 Reveal
        let touched = false;
        if (
          post.struckAt !== null &&
          (cloud.struckAt === null || cloud.struckAt === undefined)
        ) {
          await updateDoc(ref, {
            struckAt: Timestamp.fromMillis(Date.parse(post.struckAt)),
          });
          touched = true;
        }
        if (cloud.visibility === 'private') {
          await updateDoc(ref, {
            visibility: 'public',
            plaintext: post.text,
            ciphertext: deleteField(),
            iv: deleteField(),
          });
          touched = true;
        }
        if (touched) {
          uploaded++;
        } else {
          console.warn(`公開同步略過 No. ${post.n}（定形後出現非法差異）`);
          pending++;
        }
      }
    } else if (!cloud) {
      pending++; // 新的私密貼文：內容需要金鑰加密，等解鎖
    } else if (cloud.visibility === 'public') {
      // Unlist：無金鑰寫不出密文。可塑期內先刪雲端文件立即下架；定形後只能等解鎖
      if (isMalleable(post)) {
        await deleteDoc(ref);
        removed++;
      }
      pending++; // 兩種情況都要在解鎖後補上密文版本
    } else {
      // 私密 → 私密：無金鑰能推進的只有編號遞補與 Strike；內容變更等解鎖
      let touched = false;
      if (cloud.n > post.n) {
        await stepDownN(ref, cloud.n, post.n);
        touched = true;
      }
      if (
        post.struckAt !== null &&
        (cloud.struckAt === null || cloud.struckAt === undefined)
      ) {
        await updateDoc(ref, {
          struckAt: Timestamp.fromMillis(Date.parse(post.struckAt)),
        });
        touched = true;
      }
      if (
        cloud.contentHash !== post.contentHash ||
        cloud.lastEditedAt.toDate().toISOString() !== post.lastEditedAt
      ) {
        pending++;
      } else if (touched) {
        uploaded++;
      }
    }
  }

  // 本地不存在的雲端貼文 → 刪除。頂部的安全邊界已保證：能走到這裡，
  // 這台裝置要嘛已建立同步關係（本地為主），要嘛雲端沒有加密備份可誤刪
  for (const id of cloudPostById.keys()) {
    await deleteDoc(doc(postsCol, id));
    removed++;
  }

  await setDoc(
    doc(db, 'users', uid),
    { quotaUsed: posts.length, updatedAt: serverTimestamp() },
    { merge: true },
  );
  if (cloudUser?.publicSlug) {
    await setDoc(doc(db, 'publicSlugs', cloudUser.publicSlug), {
      uid,
      quotaUsed: posts.length,
    });
  }

  return (
    `已同步公開內容：上傳 ${uploaded}、刪除 ${removed}` +
    (pending > 0 ? `；${pending} 則私密變更待解鎖後同步` : '')
  );
}

/** 依解鎖狀態選路：有金鑰走完整同步，沒有就走公開路徑。 */
export function syncNow(): Promise<string> {
  return getSessionKey() ? pushAll() : pushPublic();
}

/** 已登入但未解鎖時，定形貼文的 Unlist 無法立即從分享頁收回——UI 用來加註警語。 */
export function unlistNeedsUnlock(): boolean {
  return auth.currentUser !== null && getSessionKey() === null;
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

// ---- 分享連結：隨機 slug，可重生（換鎖）、可停用 ----

export async function getShareSlug(): Promise<string | null> {
  const uid = requireUid();
  const userDoc = await fetchUserDoc(uid);
  return userDoc?.publicSlug ?? null;
}

/** 建立分享連結。回傳新 slug。 */
export async function enableShare(): Promise<string> {
  const uid = requireUid();
  const quotaUsed = (await listPosts()).length;
  const slug = generateSlug();
  const batch = writeBatch(db);
  batch.set(doc(db, 'publicSlugs', slug), { uid, quotaUsed });
  batch.set(doc(db, 'users', uid), { publicSlug: slug, quotaUsed }, { merge: true });
  await batch.commit();
  return slug;
}

/** 連結重生：舊連結全部失效（換鎖），內容不動。回傳新 slug。 */
export async function regenerateShare(): Promise<string> {
  const uid = requireUid();
  const userDoc = await fetchUserDoc(uid);
  const oldSlug = userDoc?.publicSlug;
  const quotaUsed = (await listPosts()).length;
  const slug = generateSlug();
  const batch = writeBatch(db);
  if (oldSlug) batch.delete(doc(db, 'publicSlugs', oldSlug));
  batch.set(doc(db, 'publicSlugs', slug), { uid, quotaUsed });
  batch.set(doc(db, 'users', uid), { publicSlug: slug, quotaUsed }, { merge: true });
  await batch.commit();
  return slug;
}

/** 停用分享連結：門直接拆掉。公開貼文的 visibility 不變，想收回展示請逐則 Unlist。 */
export async function disableShare(): Promise<void> {
  const uid = requireUid();
  const userDoc = await fetchUserDoc(uid);
  const quotaUsed = (await listPosts()).length;
  const batch = writeBatch(db);
  if (userDoc?.publicSlug) {
    batch.delete(doc(db, 'publicSlugs', userDoc.publicSlug));
  }
  batch.set(
    doc(db, 'users', uid),
    { publicSlug: deleteField(), quotaUsed },
    { merge: true },
  );
  await batch.commit();
}

// ---- 自動推送：每次本地變動後（App.refresh）輕輕推一把 ----

let autoPushTimer: ReturnType<typeof setTimeout> | null = null;

export function autoPushSoon(): void {
  if (!auth.currentUser) return;
  if (autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(() => {
    autoPushTimer = null;
    syncNow().catch((e) => console.warn('自動同步失敗（稍後可手動同步）：', e));
  }, 2_000);
}
