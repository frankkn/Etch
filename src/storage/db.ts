import { openDB, type DBSchema, type IDBPDatabase, type IDBPObjectStore } from 'idb';
import { sha256Hex, type KdfParams } from '../crypto';
import { MALLEABLE_WINDOW_MS, QUOTA_TOTAL } from '../lib/constants';

export type Visibility = 'private' | 'public';

/**
 * 貼文生命週期：發布（Etch）→ 可塑期 → 定形。
 * - 發布立即佔一則額度、立即取得編號（編號＝發布順序，緊湊 1..N）。
 * - 可塑期＝發布後 24 小時，錨定 etchedAt，編輯不重置：可編輯（編號不變）、
 *   可刪除（額度退還，之後的貼文編號往前遞補）。
 * - 遞補永遠安全：編號較大的貼文必然發布得更晚，窗口必然還沒關。
 * - 期滿即定形（定形時刻 = etchedAt + 24h，純時間比較）：永遠不可編輯與刪除，
 *   唯一例外是 Strike（一次、不可逆）。
 */
export interface Post {
  id: string;
  n: number; // 編號 1–100，發布時指定；可塑期中可能因較早貼文被刪除而往前遞補
  text: string;
  visibility: Visibility; // Etch 當下選擇；Phase 1 僅記錄意向，分享頁 Phase 2 上線
  contentHash: string; // SHA-256(明文) hex；可塑期內隨編輯更新，定形後不可變
  etchedAt: string; // 發布時間；定形時刻 = etchedAt + 24h
  lastEditedAt: string; // 發布或最後一次編輯（純紀錄，不影響任何窗口）
  struckAt: string | null; // 一旦寫入不可再改；僅限定形後
}

export interface Draft {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

interface EtchDB extends DBSchema {
  posts: { key: string; value: Post };
  drafts: { key: string; value: Draft };
  meta: { key: string; value: unknown };
}

const DB_NAME = 'etch';

let dbPromise: Promise<IDBPDatabase<EtchDB>> | null = null;

function getDb(): Promise<IDBPDatabase<EtchDB>> {
  // v4：posts 加入 visibility 與 contentHash。
  // v1–v3 只存在於未發佈的開發期，沒有真實使用者資料，直接重建；
  // 正式上線後任何 schema 變更都必須寫遷移
  dbPromise ??= openDB<EtchDB>(DB_NAME, 4, {
    upgrade(db) {
      for (const store of Array.from(db.objectStoreNames)) {
        db.deleteObjectStore(store);
      }
      db.createObjectStore('posts', { keyPath: 'id' });
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('meta');
    },
  });
  return dbPromise;
}

/** 僅供測試：關閉並清掉快取的連線，讓下個測試拿到乾淨的 DB。 */
export async function _closeDbForTests(): Promise<void> {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
}

// ---- 可塑期判定（純時間比較，無任何狀態轉移）----

export function hardenTimeMs(post: Post): number {
  return new Date(post.etchedAt).getTime() + MALLEABLE_WINDOW_MS;
}

export function isMalleable(post: Post, now = new Date()): boolean {
  return hardenTimeMs(post) > now.getTime();
}

export function malleableRemainingMs(post: Post, now = new Date()): number {
  return Math.max(0, hardenTimeMs(post) - now.getTime());
}

// ---- posts ----

export async function listPosts(): Promise<Post[]> {
  const db = await getDb();
  const posts = await db.getAll('posts');
  return posts.sort((a, b) => a.n - b.n); // 編號＝發布順序
}

/** 額度 = 現存貼文數（含可塑期中的）。刪除可塑貼文即自動退還。 */
export async function getQuotaUsed(): Promise<number> {
  const db = await getDb();
  return db.count('posts');
}

type PostsRwStore = IDBPObjectStore<
  EtchDB,
  ArrayLike<'posts' | 'drafts'>,
  'posts',
  'readwrite'
>;

export interface EtchOptions {
  visibility?: Visibility;
  now?: Date;
}

// 注意：contentHash 必須在開 IndexedDB 交易之前算完——
// 交易中 await 任何非 IDB 的 promise（如 crypto.subtle）會讓交易自動關閉。

async function addPostInTx(
  store: PostsRwStore,
  text: string,
  contentHash: string,
  visibility: Visibility,
  now: Date,
): Promise<Post> {
  if (text.trim() === '') throw new Error('空白的內容無法出版');
  const count = await store.count();
  if (count >= QUOTA_TOTAL) {
    throw new Error(`一生只有 ${QUOTA_TOTAL} 則，已經用完了`);
  }
  const post: Post = {
    id: crypto.randomUUID(),
    n: count + 1, // 編號緊湊是全域不變量，count + 1 即最新編號
    text,
    visibility,
    contentHash,
    etchedAt: now.toISOString(),
    lastEditedAt: now.toISOString(),
    struckAt: null,
  };
  await store.add(post);
  return post;
}

/** 立即出版一段文字（不經過草稿）。 */
export async function etchText(
  text: string,
  { visibility = 'private', now = new Date() }: EtchOptions = {},
): Promise<Post> {
  const contentHash = await sha256Hex(text);
  const db = await getDb();
  const tx = db.transaction(['posts', 'drafts'], 'readwrite');
  const post = await addPostInTx(
    tx.objectStore('posts'),
    text,
    contentHash,
    visibility,
    now,
  );
  await tx.done;
  return post;
}

/** 出版既有草稿：寫入貼文、刪除草稿，單一交易。 */
export async function etchDraft(
  draftId: string,
  { visibility = 'private', now = new Date() }: EtchOptions = {},
): Promise<Post> {
  const db = await getDb();
  const peek = await db.get('drafts', draftId);
  if (!peek) throw new Error('草稿不存在');
  const contentHash = await sha256Hex(peek.text); // 交易外先算好
  const tx = db.transaction(['posts', 'drafts'], 'readwrite');
  const draft = await tx.objectStore('drafts').get(draftId);
  if (!draft) throw new Error('草稿不存在');
  const post = await addPostInTx(
    tx.objectStore('posts'),
    draft.text,
    contentHash,
    visibility,
    now,
  );
  await tx.objectStore('drafts').delete(draftId);
  await tx.done;
  return post;
}

/** 編輯：僅限可塑期內。編號不變、不延長可塑期；contentHash 隨內容更新。 */
export async function editPost(
  id: string,
  text: string,
  { visibility, now = new Date() }: EtchOptions = {},
): Promise<Post> {
  if (text.trim() === '') {
    throw new Error('不能改成空白——想抹去這則請用刪除');
  }
  const contentHash = await sha256Hex(text); // 交易外先算好
  const db = await getDb();
  const tx = db.transaction('posts', 'readwrite');
  const post = await tx.store.get(id);
  if (!post) throw new Error('貼文不存在');
  if (!isMalleable(post, now)) {
    throw new Error('已定形——發布超過 24 小時的貼文，再也不能編輯');
  }
  const updated: Post = {
    ...post,
    text,
    contentHash,
    visibility: visibility ?? post.visibility,
    lastEditedAt: now.toISOString(),
  };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

/**
 * 刪除：僅限可塑期內。額度退還，之後的貼文編號往前遞補。
 * 遞補的貼文必然都還在可塑期（發布得更晚），不會動到任何定形的編號。
 */
export async function deletePost(id: string, now = new Date()): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('posts', 'readwrite');
  const post = await tx.store.get(id);
  if (!post) throw new Error('貼文不存在');
  if (!isMalleable(post, now)) {
    throw new Error('已定形——發布超過 24 小時的貼文，再也不能刪除');
  }
  await tx.store.delete(id);
  const rest = await tx.store.getAll();
  for (const p of rest) {
    if (p.n > post.n) await tx.store.put({ ...p, n: p.n - 1 });
  }
  await tx.done;
}

/** Strike：僅限定形後，每則一次，不可逆。 */
export async function strikePost(id: string, now = new Date()): Promise<Post> {
  const db = await getDb();
  const tx = db.transaction('posts', 'readwrite');
  const post = await tx.store.get(id);
  if (!post) throw new Error('貼文不存在');
  if (isMalleable(post, now)) {
    throw new Error('可塑期內想反悔，請用編輯或刪除；Strike 是留給定形之後的');
  }
  if (post.struckAt !== null) throw new Error('這則已經劃掉過了，劃掉不可逆');
  const struck: Post = { ...post, struckAt: now.toISOString() };
  await tx.store.put(struck);
  await tx.done;
  return struck;
}

// ---- drafts ----
// 草稿是唯一完全自由的空間：可編輯、可刪除（真刪除），無時間約束。

export async function listDrafts(): Promise<Draft[]> {
  const db = await getDb();
  const drafts = await db.getAll('drafts');
  return drafts.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function saveDraft(
  text: string,
  id?: string,
  now = new Date(),
): Promise<Draft> {
  const db = await getDb();
  const tx = db.transaction('drafts', 'readwrite');
  const existing = id ? await tx.store.get(id) : undefined;
  const draft: Draft = existing
    ? { ...existing, text, updatedAt: now.toISOString() }
    : {
        id: id ?? crypto.randomUUID(),
        text,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
  await tx.store.put(draft);
  await tx.done;
  return draft;
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('drafts', id);
}

// ---- meta ----

export async function getKdfParams(): Promise<KdfParams | null> {
  const db = await getDb();
  return ((await db.get('meta', 'kdfParams')) as KdfParams) ?? null;
}

export async function setKdfParams(params: KdfParams): Promise<void> {
  const db = await getDb();
  await db.put('meta', params, 'kdfParams');
}

/** KCV（key check value）：用金鑰加密一段固定字串，解鎖時驗證密語正確。 */
export interface Kcv {
  ciphertext: string;
  iv: string;
}

export async function getKcv(): Promise<Kcv | null> {
  const db = await getDb();
  return ((await db.get('meta', 'kcv')) as Kcv) ?? null;
}

export async function setKcv(kcv: Kcv): Promise<void> {
  const db = await getDb();
  await db.put('meta', kcv, 'kcv');
}

export async function isOnboarded(): Promise<boolean> {
  const db = await getDb();
  return ((await db.get('meta', 'onboarded')) as boolean) ?? false;
}

export async function setOnboarded(): Promise<void> {
  const db = await getDb();
  await db.put('meta', true, 'onboarded');
}

// ---- import（僅限全新裝置還原）----

export async function isStoreEmpty(): Promise<boolean> {
  const db = await getDb();
  const [postCount, draftCount] = await Promise.all([
    db.count('posts'),
    db.count('drafts'),
  ]);
  return postCount === 0 && draftCount === 0;
}

export async function importAll(
  posts: Post[],
  drafts: Draft[],
  kdfParams: KdfParams,
): Promise<void> {
  if (!(await isStoreEmpty())) {
    throw new Error('本機已有資料，不能匯入覆蓋。匯入只用於全新裝置還原。');
  }
  const db = await getDb();
  const tx = db.transaction(['posts', 'drafts', 'meta'], 'readwrite');
  for (const post of posts) await tx.objectStore('posts').add(post);
  for (const draft of drafts) await tx.objectStore('drafts').add(draft);
  await tx.objectStore('meta').put(kdfParams, 'kdfParams');
  await tx.objectStore('meta').put(true, 'onboarded');
  await tx.done;
}
