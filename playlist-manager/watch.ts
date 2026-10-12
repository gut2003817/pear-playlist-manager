/**
 * 偵測 YouTube Music 自己對歌單的修改（儲存至播放清單、新建、刪除歌單），
 * 只重新讀取受影響的那一個歌單，讓標示即時更新。
 * 插件自己的請求走 rawFetch，不會被這裡攔到。
 */
import * as store from './store';

type Body = Record<string, unknown>;

const ENDPOINTS = {
  edit: '/youtubei/v1/browse/edit_playlist',
  create: '/youtubei/v1/playlist/create',
  remove: '/youtubei/v1/playlist/delete',
};

const pending = new Map<string, number>();

/** 同一個歌單短時間內多次修改，只讀一次；稍等一下讓伺服器資料同步 */
const scheduleRefresh = (playlistId: string, titleHint?: string) => {
  window.clearTimeout(pending.get(playlistId));
  pending.set(
    playlistId,
    window.setTimeout(() => {
      pending.delete(playlistId);
      store.refreshOne(playlistId, titleHint).catch((err: unknown) => {
        console.warn('[playlist-manager] 無法更新歌單', playlistId, err);
      });
    }, 800),
  );
};

const parse = (text: unknown): Body | undefined => {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text) as Body;
  } catch {
    return undefined;
  }
};

const handle = (url: string, request?: Body, response?: Body) => {
  if (url.includes(ENDPOINTS.edit)) {
    const id = request?.playlistId;
    if (typeof id === 'string') scheduleRefresh(id);
  } else if (url.includes(ENDPOINTS.create)) {
    const id = response?.playlistId;
    const title =
      typeof request?.title === 'string' ? request.title : undefined;
    if (typeof id === 'string') scheduleRefresh(id, title);
  } else if (url.includes(ENDPOINTS.remove)) {
    const id = request?.playlistId;
    if (typeof id === 'string') store.dropPlaylist(id);
  }
};

const isWatched = (url: string) =>
  Object.values(ENDPOINTS).some((e) => url.includes(e));

/* ---------- fetch ---------- */

let originalFetch: typeof fetch | undefined;

const patchedFetch: typeof fetch = async (input, init) => {
  const res = await originalFetch!(input, init);
  try {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (isWatched(url) && res.ok) {
      const request = parse(init?.body);
      const response = (await res
        .clone()
        .json()
        .catch(() => undefined)) as Body | undefined;
      handle(url, request, response);
    }
  } catch {
    // 偵測失敗不影響原本的操作
  }
  return res;
};

/* ---------- XMLHttpRequest ---------- */

const urls = new WeakMap<XMLHttpRequest, string>();
let originalOpen: typeof XMLHttpRequest.prototype.open | undefined;
let originalSend: typeof XMLHttpRequest.prototype.send | undefined;

function patchedOpen(
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  urls.set(this, String(url));
  return (originalOpen as (...a: unknown[]) => void).call(
    this,
    method,
    url,
    ...rest,
  );
}

function patchedSend(
  this: XMLHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null,
) {
  const url = urls.get(this);
  if (url && isWatched(url)) {
    this.addEventListener('loadend', () => {
      if (this.status >= 200 && this.status < 300) {
        handle(url, parse(body), parse(this.responseText));
      }
    });
  }
  return originalSend!.call(this, body);
}

/* ---------- 啟動／停止 ---------- */

export const startWatching = () => {
  if (originalFetch) return;
  originalFetch = window.fetch;
  window.fetch = patchedFetch;
  // oxlint-disable-next-line typescript/unbound-method -- 只是暫存原本的方法，稍後用 call 綁定 this
  originalOpen = XMLHttpRequest.prototype.open;
  // oxlint-disable-next-line typescript/unbound-method
  originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open =
    patchedOpen as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = patchedSend;
};

export const stopWatching = () => {
  if (!originalFetch) return;
  window.fetch = originalFetch;
  if (originalOpen) XMLHttpRequest.prototype.open = originalOpen;
  if (originalSend) XMLHttpRequest.prototype.send = originalSend;
  originalFetch = originalOpen = originalSend = undefined;
  pending.forEach((t) => window.clearTimeout(t));
  pending.clear();
};
