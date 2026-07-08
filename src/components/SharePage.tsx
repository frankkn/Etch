import { Fragment, useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { QUOTA_TOTAL } from '../lib/constants';
import { formatDate, formatDateTime, gapDays, silenceLabel } from '../lib/time';
import { db } from '../sync/firebase';

/** 分享頁看到的貼文：只有公開的那幾則，內容是用戶選擇給世界看的明文。 */
interface SharedPost {
  id: string;
  n: number;
  text: string;
  etchedAt: string;
  struckAt: string | null;
}

type State =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'ready'; quotaUsed: number; posts: SharedPost[] };

/**
 * /s/{slug}——純閱讀，沒有任何互動元件。
 * 只渲染公開貼文；編號、空缺與真實進度照留（空缺本身就是內容）。
 */
export function SharePage({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const slugSnap = await getDoc(doc(db, 'publicSlugs', slug));
        if (!slugSnap.exists()) {
          if (!cancelled) setState({ kind: 'notFound' });
          return;
        }
        const { uid, quotaUsed } = slugSnap.data() as {
          uid: string;
          quotaUsed: number;
        };
        const snap = await getDocs(
          query(
            collection(db, 'users', uid, 'posts'),
            where('visibility', '==', 'public'),
          ),
        );
        const posts: SharedPost[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              n: data.n as number,
              text: data.plaintext as string,
              etchedAt: (data.etchedAt.toDate() as Date).toISOString(),
              struckAt:
                data.struckAt == null
                  ? null
                  : (data.struckAt.toDate() as Date).toISOString(),
            };
          })
          .sort((a, b) => a.n - b.n);
        if (!cancelled) setState({ kind: 'ready', quotaUsed, posts });
      } catch (e) {
        console.error(e);
        if (!cancelled) setState({ kind: 'notFound' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.kind === 'loading') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center text-sm text-stone-600">
        ⋯
      </div>
    );
  }

  if (state.kind === 'notFound') {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
        <h1 className="mb-6 text-2xl font-semibold tracking-[0.3em] text-stone-100">
          ETCH
        </h1>
        <p className="text-sm text-stone-500">
          這扇門不存在，或鑰匙已經換了。
        </p>
      </div>
    );
  }

  const { quotaUsed, posts } = state;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4">
      <header className="flex items-baseline justify-between border-b border-stone-800 py-5">
        <h1 className="text-xl font-semibold tracking-[0.3em] text-stone-100">
          ETCH
        </h1>
        <span className="text-sm tabular-nums text-stone-500">
          已刻 {quotaUsed} / {QUOTA_TOTAL}
        </span>
      </header>

      <main className="flex-1 py-8">
        {posts.length === 0 ? (
          <p className="py-16 text-center text-sm text-stone-600">
            刻了 {quotaUsed} 則，但沒有一則對世界公開。
          </p>
        ) : (
          <div>
            <HiddenMarker count={posts[0].n - 1} />
            {posts.map((post, i) => (
              <Fragment key={post.id}>
                {i > 0 && (
                  <ShareGap prev={posts[i - 1]} next={post} />
                )}
                <article className="rounded border border-stone-800 bg-stone-900/40 p-5">
                  <header className="mb-3 flex items-baseline justify-between text-xs text-stone-500">
                    <span className="tabular-nums">
                      No. {post.n} / {QUOTA_TOTAL}
                    </span>
                    <time dateTime={post.etchedAt}>
                      {formatDateTime(post.etchedAt)}
                    </time>
                  </header>
                  <p
                    className={`etch-content ${
                      post.struckAt !== null
                        ? 'text-stone-500 line-through decoration-stone-500'
                        : ''
                    }`}
                  >
                    {post.text}
                  </p>
                  {post.struckAt !== null && (
                    <p className="mt-3 text-right text-xs text-stone-600">
                      於 {formatDate(post.struckAt)} 劃掉
                    </p>
                  )}
                </article>
              </Fragment>
            ))}
            <HiddenMarker count={quotaUsed - posts[posts.length - 1].n} />
          </div>
        )}
      </main>

      <footer className="border-t border-stone-800 py-6 text-center text-xs text-stone-700">
        Etch——一生只能發 100 則。
      </footer>
    </div>
  );
}

/** 相鄰兩則公開貼文之間：先講被藏起來的刻痕，再講時間的沉默。 */
function ShareGap({ prev, next }: { prev: SharedPost; next: SharedPost }) {
  const hidden = next.n - prev.n - 1;
  const days = gapDays(prev.etchedAt, next.etchedAt);
  if (hidden <= 0 && days < 2) return <div className="h-6" />;
  const label =
    hidden > 0 ? `中間 ${hidden} 則沉默` : silenceLabel(days);
  const height = Math.min(160, 32 + Math.log2(Math.max(hidden, days, 2)) * 16);
  return (
    <div
      style={{ height }}
      className="flex flex-col items-center justify-center gap-2"
    >
      <div className="w-px flex-1 bg-stone-800" />
      <span className="text-xs text-stone-600">{label}</span>
      <div className="w-px flex-1 bg-stone-800" />
    </div>
  );
}

/** 時間軸開頭／結尾被藏起來的刻痕。 */
function HiddenMarker({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <p className="py-4 text-center text-xs text-stone-700">
      ⋯ {count} 則沉默 ⋯
    </p>
  );
}
