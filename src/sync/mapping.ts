import { Timestamp } from 'firebase/firestore';
import { decryptText, encryptText, sha256Hex } from '../crypto';
import type { Draft, Post, Visibility } from '../storage/db';

/**
 * 本地 Post ↔ Firestore 文件的轉換。
 * - 私密貼文：只上傳 ciphertext + iv，明文永不離開客戶端。
 * - 公開貼文：上傳 plaintext（用戶的選擇，走明文路徑供分享頁渲染）。
 * - 兩組欄位互斥，由 Security Rules 再驗一次。
 * - 時間欄位在雲端用 Firestore Timestamp，Rules 才能做時間比較（可塑期窗口）。
 */
export interface CloudPost {
  n: number;
  visibility: Visibility;
  contentHash: string;
  ciphertext?: string;
  iv?: string;
  plaintext?: string;
  etchedAt: Timestamp;
  lastEditedAt: Timestamp;
  struckAt: Timestamp | null;
}

export interface CloudDraft {
  ciphertext: string;
  iv: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

const toTs = (iso: string) => Timestamp.fromMillis(Date.parse(iso));
const fromTs = (ts: Timestamp) => ts.toDate().toISOString();

export async function toCloudPost(
  post: Post,
  key: CryptoKey | null,
): Promise<CloudPost> {
  const base = {
    n: post.n,
    visibility: post.visibility,
    contentHash: post.contentHash,
    etchedAt: toTs(post.etchedAt),
    lastEditedAt: toTs(post.lastEditedAt),
    struckAt: post.struckAt === null ? null : toTs(post.struckAt),
  };
  if (post.visibility === 'public') {
    return { ...base, plaintext: post.text };
  }
  if (!key) throw new Error('私密貼文需要解鎖金鑰才能上傳');
  const blob = await encryptText(key, post.text);
  return { ...base, ciphertext: blob.ciphertext, iv: blob.iv };
}

export async function fromCloudPost(
  id: string,
  cloud: CloudPost,
  key: CryptoKey,
): Promise<Post> {
  let text: string;
  if (cloud.visibility === 'public') {
    if (typeof cloud.plaintext !== 'string') {
      throw new Error(`雲端資料不完整（${id}）：公開貼文缺少明文`);
    }
    text = cloud.plaintext;
  } else {
    if (typeof cloud.ciphertext !== 'string' || typeof cloud.iv !== 'string') {
      throw new Error(`雲端資料不完整（${id}）：私密貼文缺少密文`);
    }
    try {
      text = await decryptText(key, { ciphertext: cloud.ciphertext, iv: cloud.iv });
    } catch {
      throw new Error('解密失敗——通關密語錯誤，或雲端資料已損毀');
    }
  }
  // contentHash 交叉驗證：私密貼文 GCM 已保完整性，公開貼文靠這裡把關
  if ((await sha256Hex(text)) !== cloud.contentHash) {
    throw new Error(`內容與 contentHash 不符（${id}）——資料可能被竄改`);
  }
  return {
    id,
    n: cloud.n,
    text,
    visibility: cloud.visibility,
    contentHash: cloud.contentHash,
    etchedAt: fromTs(cloud.etchedAt),
    lastEditedAt: fromTs(cloud.lastEditedAt),
    struckAt: cloud.struckAt === null ? null : fromTs(cloud.struckAt),
  };
}

export async function toCloudDraft(draft: Draft, key: CryptoKey): Promise<CloudDraft> {
  const blob = await encryptText(key, draft.text);
  return {
    ciphertext: blob.ciphertext,
    iv: blob.iv,
    createdAt: toTs(draft.createdAt),
    updatedAt: toTs(draft.updatedAt),
  };
}

export async function fromCloudDraft(
  id: string,
  cloud: CloudDraft,
  key: CryptoKey,
): Promise<Draft> {
  let text: string;
  try {
    text = await decryptText(key, { ciphertext: cloud.ciphertext, iv: cloud.iv });
  } catch {
    throw new Error('解密失敗——通關密語錯誤，或雲端資料已損毀');
  }
  return {
    id,
    text,
    createdAt: fromTs(cloud.createdAt),
    updatedAt: fromTs(cloud.updatedAt),
  };
}

/** 判斷本地貼文與雲端文件是否有差異（決定要不要上傳）。 */
export function cloudPostDiffers(post: Post, cloud: CloudPost): boolean {
  return (
    cloud.n !== post.n ||
    cloud.visibility !== post.visibility ||
    cloud.contentHash !== post.contentHash ||
    fromTs(cloud.lastEditedAt) !== post.lastEditedAt ||
    (cloud.struckAt === null ? null : fromTs(cloud.struckAt)) !== post.struckAt
  );
}
