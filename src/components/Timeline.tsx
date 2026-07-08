import { Fragment, useEffect, useState } from 'react';
import { QUOTA_TOTAL } from '../lib/constants';
import {
  countdownLabel,
  formatDate,
  formatDateTime,
  gapDays,
  silenceLabel,
} from '../lib/time';
import {
  deletePost,
  isMalleable,
  malleableRemainingMs,
  setPostVisibility,
  strikePost,
  type Post,
} from '../storage/db';

export function Timeline({
  posts,
  onChanged,
  onEditPost,
}: {
  posts: Post[];
  onChanged: () => Promise<void>;
  onEditPost: (id: string) => void;
}) {
  // 可塑期倒數需要隨時間前進，每 30 秒重算一次
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (posts.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-stone-600">
        還沒有任何一則。第一刀之前，想清楚。
      </p>
    );
  }

  return (
    <div>
      {posts.map((post, i) => (
        <Fragment key={post.id}>
          {i > 0 && (
            <GapMarker days={gapDays(posts[i - 1].etchedAt, post.etchedAt)} />
          )}
          {isMalleable(post, now) ? (
            <MalleablePostCard
              post={post}
              now={now}
              onChanged={onChanged}
              onEdit={() => onEditPost(post.id)}
            />
          ) : (
            <HardenedPostCard post={post} onChanged={onChanged} />
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** 兩則之間的沉默也是內容：間隔越長，留白越深。 */
function GapMarker({ days }: { days: number }) {
  if (days < 2) return <div className="h-6" />;
  const height = Math.min(160, 32 + Math.log2(days) * 16);
  return (
    <div
      style={{ height }}
      className="flex flex-col items-center justify-center gap-2"
    >
      <div className="w-px flex-1 bg-stone-800" />
      <span className="text-xs text-stone-600">{silenceLabel(days)}</span>
      <div className="w-px flex-1 bg-stone-800" />
    </div>
  );
}

/** 可塑期中的貼文：未定號，可編輯、可刪除（刪除退還額度）。 */
function MalleablePostCard({
  post,
  now,
  onChanged,
  onEdit,
}: {
  post: Post;
  now: Date;
  onChanged: () => Promise<void>;
  onEdit: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <article className="rounded border border-dashed border-stone-700 bg-stone-900/40 p-5">
      <header className="mb-3 flex items-baseline justify-between text-xs text-stone-500">
        <span className="tabular-nums">
          No. {post.n} / {QUOTA_TOTAL}
          {post.visibility === 'public' && (
            <span className="ml-2 rounded border border-stone-700 px-1.5 py-0.5 text-stone-400">
              公開
            </span>
          )}
          <span className="ml-2 italic text-stone-600">
            可塑期・{countdownLabel(malleableRemainingMs(post, now))}後定形
          </span>
        </span>
        <time dateTime={post.etchedAt}>{formatDateTime(post.etchedAt)}</time>
      </header>
      <p className="etch-content">{post.text}</p>
      <footer className="mt-4 flex items-center justify-end gap-3 text-xs">
        {confirmingDelete ? (
          <div className="flex flex-col items-end gap-2">
            <p className="text-stone-400">
              刪除不留任何痕跡，額度退還，之後的貼文編號往前遞補。定形之後就沒有這個選項了。
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmingDelete(false)}
                className="rounded px-3 py-1 text-stone-400 hover:text-stone-200"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  try {
                    await deletePost(post.id);
                    await onChanged();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
                className="rounded border border-red-900 px-3 py-1 text-red-400 hover:bg-red-950"
              >
                刪除
              </button>
            </div>
            {error && <p className="text-red-400">{error}</p>}
          </div>
        ) : (
          <>
            <button
              onClick={onEdit}
              className="text-stone-500 transition-colors hover:text-stone-200"
            >
              編輯
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              className="text-stone-700 transition-colors hover:text-stone-400"
            >
              刪除
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

type HardenedAction = 'strike' | 'reveal' | 'unlist';

const ACTION_COPY: Record<
  HardenedAction,
  { warning: string; button: string }
> = {
  strike: {
    warning:
      '劃掉代表「我曾經這樣想，現在不了」。貼文仍然可見、仍佔額度，且不可復原。',
    button: 'Strike',
  },
  reveal: {
    warning:
      '公開後，這則會以明文儲存；拿到你分享連結的人都能讀到它。內容本身不會改變。',
    button: 'Reveal',
  },
  unlist: {
    warning:
      '已看過的人、截圖與網路快取無法收回。此後這則貼文會回到加密儲存，不再對外展示。',
    button: 'Unlist',
  },
};

/** 定形的貼文：內容永遠不變；能做的只剩 Strike 與可見性切換。 */
function HardenedPostCard({
  post,
  onChanged,
}: {
  post: Post;
  onChanged: () => Promise<void>;
}) {
  const [action, setAction] = useState<HardenedAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const struck = post.struckAt !== null;
  const visibilityAction: HardenedAction =
    post.visibility === 'private' ? 'reveal' : 'unlist';

  const run = async (act: HardenedAction) => {
    try {
      if (act === 'strike') await strikePost(post.id);
      else await setPostVisibility(post.id, act === 'reveal' ? 'public' : 'private');
      setAction(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <article className="rounded border border-stone-800 bg-stone-900/40 p-5">
      <header className="mb-3 flex items-baseline justify-between text-xs text-stone-500">
        <span className="tabular-nums">
          No. {post.n} / {QUOTA_TOTAL}
          {post.visibility === 'public' && (
            <span className="ml-2 rounded border border-stone-700 px-1.5 py-0.5 text-stone-400">
              公開
            </span>
          )}
        </span>
        <time dateTime={post.etchedAt}>{formatDateTime(post.etchedAt)}</time>
      </header>
      <p
        className={`etch-content ${
          struck ? 'text-stone-500 line-through decoration-stone-500' : ''
        }`}
      >
        {post.text}
      </p>
      <footer className="mt-4 flex items-center justify-end gap-3 text-xs">
        {action !== null ? (
          <div className="flex flex-col items-end gap-2">
            <p className="max-w-md text-right text-stone-400">
              {ACTION_COPY[action].warning}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setAction(null)}
                className="rounded px-3 py-1 text-stone-400 hover:text-stone-200"
              >
                取消
              </button>
              <button
                onClick={() => void run(action)}
                className="rounded border border-red-900 px-3 py-1 text-red-400 hover:bg-red-950"
              >
                {ACTION_COPY[action].button}
              </button>
            </div>
            {error && <p className="text-red-400">{error}</p>}
          </div>
        ) : (
          <>
            <button
              onClick={() => setAction(visibilityAction)}
              className="text-stone-700 transition-colors hover:text-stone-400"
            >
              {post.visibility === 'private' ? 'Reveal' : 'Unlist'}
            </button>
            {!struck ? (
              <button
                onClick={() => setAction('strike')}
                className="text-stone-700 transition-colors hover:text-stone-400"
              >
                Strike
              </button>
            ) : (
              <span className="text-stone-600">
                於 {formatDate(post.struckAt!)} 劃掉
              </span>
            )}
          </>
        )}
      </footer>
    </article>
  );
}
