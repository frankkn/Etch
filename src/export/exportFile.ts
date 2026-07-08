import {
  decryptText,
  deriveKey,
  encryptText,
  type KdfParams,
} from '../crypto';
import type { Draft, Post } from '../storage/db';

// 格式規格見 docs/EXPORT_FORMAT.md——這個檔案是使用者資料主權的載體，
// 欄位一經發佈就是對外承諾，改動必須升 version 並保留舊版解析。

export interface ExportedPost {
  id: string;
  n: number; // 編號＝發布順序；可塑期中可能因較早貼文被刪除而遞補
  ciphertext: string;
  iv: string;
  etchedAt: string; // 定形時刻 = etchedAt + 24h（可推導，不另存欄位）
  lastEditedAt: string;
  struckAt: string | null;
}

export interface ExportedDraft {
  id: string;
  ciphertext: string;
  iv: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExportFileV1 {
  format: 'etch-export';
  version: 1;
  exportedAt: string;
  kdf: KdfParams;
  cipher: 'AES-256-GCM';
  quotaUsed: number; // = posts.length，含可塑期中的貼文
  posts: ExportedPost[];
  drafts: ExportedDraft[];
}

export async function buildExportFile(
  passphrase: string,
  kdf: KdfParams,
  posts: Post[],
  drafts: Draft[],
  exportedAt = new Date(),
): Promise<ExportFileV1> {
  const key = await deriveKey(passphrase, kdf);
  const exportedPosts: ExportedPost[] = [];
  for (const post of posts) {
    const blob = await encryptText(key, post.text);
    exportedPosts.push({
      id: post.id,
      n: post.n,
      ciphertext: blob.ciphertext,
      iv: blob.iv,
      etchedAt: post.etchedAt,
      lastEditedAt: post.lastEditedAt,
      struckAt: post.struckAt,
    });
  }
  const exportedDrafts: ExportedDraft[] = [];
  for (const draft of drafts) {
    const blob = await encryptText(key, draft.text);
    exportedDrafts.push({
      id: draft.id,
      ciphertext: blob.ciphertext,
      iv: blob.iv,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    });
  }
  return {
    format: 'etch-export',
    version: 1,
    exportedAt: exportedAt.toISOString(),
    kdf,
    cipher: 'AES-256-GCM',
    quotaUsed: posts.length,
    posts: exportedPosts,
    drafts: exportedDrafts,
  };
}

export function parseExportFile(json: string): ExportFileV1 {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('這不是有效的 JSON 檔');
  }
  const file = data as Partial<ExportFileV1>;
  if (file.format !== 'etch-export') throw new Error('這不是 Etch 匯出檔');
  if (file.version !== 1) throw new Error(`不支援的版本：${file.version}`);
  if (!file.kdf || typeof file.kdf.salt !== 'string') {
    throw new Error('匯出檔缺少 KDF 參數');
  }
  if (!Array.isArray(file.posts) || !Array.isArray(file.drafts)) {
    throw new Error('匯出檔內容不完整');
  }
  return file as ExportFileV1;
}

export async function decryptExportFile(
  file: ExportFileV1,
  passphrase: string,
): Promise<{ posts: Post[]; drafts: Draft[] }> {
  const key = await deriveKey(passphrase, file.kdf);
  const posts: Post[] = [];
  for (const p of file.posts) {
    let text: string;
    try {
      text = await decryptText(key, { ciphertext: p.ciphertext, iv: p.iv });
    } catch {
      throw new Error('解密失敗——通關密語錯誤，或檔案已損毀');
    }
    posts.push({
      id: p.id,
      n: p.n,
      text,
      etchedAt: p.etchedAt,
      lastEditedAt: p.lastEditedAt,
      struckAt: p.struckAt,
    });
  }
  const drafts: Draft[] = [];
  for (const d of file.drafts) {
    let text: string;
    try {
      text = await decryptText(key, { ciphertext: d.ciphertext, iv: d.iv });
    } catch {
      throw new Error('解密失敗——通關密語錯誤，或檔案已損毀');
    }
    drafts.push({ id: d.id, text, createdAt: d.createdAt, updatedAt: d.updatedAt });
  }
  return { posts, drafts };
}
