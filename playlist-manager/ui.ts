/**
 * 介面：搜尋結果標示、「從歌單移除」按鈕、三點選單項目、勾選視窗、提示訊息。
 */
import * as store from './store';
import { startWatching, stopWatching } from './watch';

import type { Membership } from './store';

interface SongInfo {
  videoId: string;
  title: string;
  artists: string;
}

const ROW = 'ytmusic-responsive-list-item-renderer';
const CARD = 'ytmusic-card-shelf-renderer';

/* ---------------- 小工具 ---------------- */

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const videoIdFrom = (root: Element): string | undefined => {
  for (const a of root.querySelectorAll<HTMLAnchorElement>(
    'a[href*="watch?v="]',
  )) {
    const id = new URL(a.href, location.origin).searchParams.get('v');
    if (id) return id;
  }
  return undefined;
};

const textIn = (root: Element, selectors: string[]) => {
  for (const s of selectors) {
    const t = root.querySelector<HTMLElement>(s)?.innerText?.trim();
    if (t) return t;
  }
  return '';
};

const songFromRow = (row: Element): SongInfo | undefined => {
  const videoId = videoIdFrom(row);
  if (!videoId) return undefined;
  const title = textIn(row, ['.title-column .title', '.title']);
  // 第二欄的格式是「歌曲 • 歌手 • 播放次數」
  const secondary = textIn(row, [
    '.secondary-flex-columns',
    '.flex-column:nth-child(2)',
  ]);
  const parts = secondary.split(/\s*[•·]\s*/).filter(Boolean);
  const artists = parts.length >= 2 ? parts[1] : (parts[0] ?? '');
  return { videoId, title, artists };
};

const songFromCard = (card: Element): SongInfo | undefined => {
  const videoId = videoIdFrom(card);
  if (!videoId) return undefined;
  const title = textIn(card, ['.title', 'yt-formatted-string.title']);
  const subtitle = textIn(card, ['.subtitle', '.details .subtitle']);
  const parts = subtitle.split(/\s*[•·]\s*/).filter(Boolean);
  const artists = parts.length >= 2 ? parts[1] : (parts[0] ?? '');
  return { videoId, title, artists };
};

const lookup = (song: SongInfo) => ({
  exact: store.exactMatches(song.videoId),
  fuzzy: store.fuzzyMatches(song.videoId, song.title, song.artists),
});

/* ---------------- 提示訊息 ---------------- */

let toastTimer: number | undefined;
export const toast = (
  message: string,
  action?: { label: string; run: () => void },
  ms = 5000,
) => {
  document.querySelector('.pm-toast')?.remove();
  const box = el('div', 'pm-toast');
  box.append(el('span', '', message));
  if (action) {
    const btn = el('button', 'pm-toast-action', action.label);
    btn.onclick = () => {
      box.remove();
      action.run();
    };
    box.append(btn);
  }
  document.body.append(box);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => box.remove(), ms);
};

/* ---------------- 移除流程 ---------------- */

const removeMany = async (song: SongInfo, targets: Membership[]) => {
  const removed: Membership[] = [];
  const failed: string[] = [];
  for (const m of targets) {
    try {
      await store.remove(m);
      removed.push(m);
    } catch (err) {
      console.error('[playlist-manager]', err);
      failed.push(m.playlist.title);
    }
  }
  if (removed.length) {
    const names = removed.map((m) => `「${m.playlist.title}」`).join('、');
    toast(
      `已從 ${names} 移除「${song.title}」`,
      {
        label: '復原',
        run: async () => {
          for (const m of removed) {
            try {
              await store.restore(m);
            } catch (err) {
              console.error('[playlist-manager]', err);
            }
          }
          toast('已加回歌單（會排在歌單最後面）');
        },
      },
      8000,
    );
  }
  if (failed.length) toast(`無法從 ${failed.join('、')} 移除，請稍後再試`);
};

export const startRemoveFlow = (song: SongInfo) => {
  const { exact, fuzzy } = lookup(song);
  if (!exact.length && !fuzzy.length) {
    toast('這首歌不在你的歌單裡');
    return;
  }
  // 只在一個歌單、且沒有其他版本 → 直接移除（可復原）
  if (exact.length === 1 && !fuzzy.length) {
    removeMany(song, exact).catch(console.error);
    return;
  }
  openDialog(song, exact, fuzzy);
};

/* ---------------- 勾選視窗 ---------------- */

const openDialog = (
  song: SongInfo,
  exact: Membership[],
  fuzzy: Membership[],
) => {
  document.querySelector('.pm-overlay')?.remove();
  const overlay = el('div', 'pm-overlay');
  const dialog = el('div', 'pm-dialog');
  overlay.append(dialog);

  dialog.append(el('h2', 'pm-dialog-title', '從歌單移除'));
  dialog.append(
    el(
      'p',
      'pm-dialog-sub',
      `勾選要移除「${song.title}」的歌單，沒勾的會保留。`,
    ),
  );

  const checks: { box: HTMLInputElement; m: Membership }[] = [];
  const section = (
    label: string,
    list: Membership[],
    checked: boolean,
    showTitle: boolean,
  ) => {
    if (!list.length) return;
    dialog.append(el('div', 'pm-section', label));
    const ul = el('ul', 'pm-list');
    for (const m of list) {
      const li = el('li', 'pm-item');
      const lab = el('label');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = checked;
      checks.push({ box, m });
      const img = el('img', 'pm-cover');
      if (m.playlist.thumbnail) img.src = m.playlist.thumbnail;
      const info = el('div', 'pm-info');
      info.append(el('div', 'pm-name', m.playlist.title));
      info.append(
        el(
          'div',
          'pm-meta',
          showTitle
            ? `${m.entry.title} · ${m.entry.artists}`
            : `${m.playlist.count} 首`,
        ),
      );
      lab.append(box, img, info);
      li.append(lab);
      ul.append(li);
    }
    dialog.append(ul);
  };

  section('這首歌所在的歌單', exact, exact.length === 1, false);
  section('可能是同一首的其他版本（請自行確認）', fuzzy, false, true);

  const footer = el('div', 'pm-footer');
  const refreshBtn = el('button', 'pm-link', '重新整理歌單資料');
  const spacer = el('div', 'pm-spacer');
  const cancel = el('button', 'pm-btn', '取消');
  const confirm = el('button', 'pm-btn pm-primary', '移除');
  footer.append(refreshBtn, spacer, cancel, confirm);
  dialog.append(footer);

  const close = () => overlay.remove();
  const sync = () => {
    const n = checks.filter((c) => c.box.checked).length;
    confirm.disabled = n === 0;
    confirm.textContent = n ? `移除（${n}）` : '移除';
  };
  checks.forEach((c) => c.box.addEventListener('change', sync));
  sync();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  cancel.onclick = close;
  confirm.onclick = () => {
    const targets = checks.filter((c) => c.box.checked).map((c) => c.m);
    close();
    removeMany(song, targets).catch(console.error);
  };
  refreshBtn.onclick = () => {
    close();
    runRefresh(true).catch(console.error);
  };

  document.body.append(overlay);
  overlay.tabIndex = -1;
  overlay.focus();
};

/* ---------------- 標示（歌單封面） ---------------- */

const makeBadge = (song: SongInfo) => {
  const { exact, fuzzy } = lookup(song);
  if (!exact.length && !fuzzy.length) return null;
  const isExact = exact.length > 0;
  const list = isExact ? exact : fuzzy;
  const rep = list[0]; // 歌最多的歌單 = 代表
  const uniq = new Set(list.map((m) => m.playlist.id));

  const badge = el('button', `pm-badge${isExact ? '' : ' pm-badge-fuzzy'}`);
  badge.dataset.pm = '1';
  const img = el('img', 'pm-badge-cover');
  if (rep.playlist.thumbnail) img.src = rep.playlist.thumbnail;
  badge.append(img, el('span', 'pm-badge-name', rep.playlist.title));
  if (uniq.size > 1)
    badge.append(el('span', 'pm-badge-more', `+${uniq.size - 1}`));

  const names = [...new Set(list.map((m) => m.playlist.title))].join('、');
  badge.title = isExact
    ? `在這些歌單裡：${names}\n點一下管理`
    : `其他版本在：${names}\n點一下確認`;
  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openDialog(song, exact, fuzzy);
  });
  return badge;
};

const decorateRow = (row: Element) => {
  const song = songFromRow(row);
  const key = song ? `${song.videoId}|${stamp}` : '';
  if ((row as HTMLElement).dataset.pmKey === key) return;
  (row as HTMLElement).dataset.pmKey = key;
  row.querySelectorAll('.pm-badge').forEach((b) => b.remove());
  if (!song) return;
  const badge = makeBadge(song);
  if (!badge) return;
  const host =
    row.querySelector('.title-column') ??
    row.querySelector('.flex-columns') ??
    row;
  host.append(badge);
};

/** 照抄旁邊「儲存」按鈕的外觀，讓新按鈕跟原生按鈕一致 */
const matchNativeButton = (host: Element, btn: HTMLElement) => {
  const natives = [...host.querySelectorAll<HTMLElement>('button')].filter(
    (b) => !b.classList.contains('pm-card-remove'),
  );
  const ref = natives[natives.length - 1]; // 最後一個通常是外框樣式的「儲存」
  if (!ref) return;
  const cs = getComputedStyle(ref);
  Object.assign(btn.style, {
    height: cs.height,
    borderRadius: cs.borderRadius,
    paddingLeft: cs.paddingLeft,
    paddingRight: cs.paddingRight,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    border: cs.border,
    backgroundColor: cs.backgroundColor,
    color: cs.color,
  });
  const wrapper = ref.closest(
    'yt-button-renderer, ytmusic-play-button-renderer',
  );
  const gap = wrapper ? getComputedStyle(wrapper).marginRight : '';
  if (gap && gap !== '0px') btn.style.marginLeft = gap;
};

const decorateCard = (card: Element) => {
  const song = songFromCard(card);
  const key = song ? `${song.videoId}|${stamp}` : '';
  if ((card as HTMLElement).dataset.pmKey === key) return;
  (card as HTMLElement).dataset.pmKey = key;
  card
    .querySelectorAll('.pm-badge, .pm-card-remove')
    .forEach((b) => b.remove());
  if (!song) return;

  const badge = makeBadge(song);
  if (!badge) return;
  const titleHost =
    card.querySelector('.details') ??
    card.querySelector('.title')?.parentElement ??
    card;
  titleHost.append(badge);

  // 「播放」「儲存」旁邊的按鈕
  const buttonHost =
    card.querySelector('#buttons, .buttons, #action-buttons') ??
    card.querySelector('yt-button-renderer')?.parentElement;
  if (buttonHost) {
    const btn = el('button', 'pm-card-remove');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm12.4 1.4 1.4-1.4L19 16.2l2.2-2.2 1.4 1.4-2.2 2.2 2.2 2.2-1.4 1.4-2.2-2.2-2.2 2.2-1.4-1.4 2.2-2.2z"/></svg><span>移除</span>';
    btn.title = '從歌單移除';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startRemoveFlow(song);
    });
    matchNativeButton(buttonHost, btn);
    buttonHost.append(btn);
  }
};

/* 索引更新後，用 stamp 讓所有標示重畫 */
let stamp = 0;

const scan = () => {
  if (!store.isReady()) return;
  document.querySelectorAll(CARD).forEach(decorateCard);
  document.querySelectorAll(ROW).forEach(decorateRow);
};

/* ---------------- 三點選單 ---------------- */

let menuSong: SongInfo | undefined;

const onMenuClick = (e: Event) => {
  const target = e.target as Element | null;
  if (!target?.closest('ytmusic-menu-renderer')) return;
  const card = target.closest(CARD);
  const row = target.closest(ROW);
  menuSong = row ? songFromRow(row) : card ? songFromCard(card) : undefined;
  // 選單是 Polymer 動態產生，稍等一下再插入
  window.setTimeout(injectMenuItem, 60);
  window.setTimeout(injectMenuItem, 250);
};

const injectMenuItem = () => {
  const popup = [
    ...document.querySelectorAll('ytmusic-menu-popup-renderer'),
  ].find((p) => (p as HTMLElement).offsetParent !== null);
  const listbox = popup?.querySelector('tp-yt-paper-listbox, #items');
  if (!listbox) return;
  listbox.querySelector('.pm-menu-item')?.remove();
  const song = menuSong;
  if (!song) return;
  const { exact, fuzzy } = lookup(song);
  if (!exact.length && !fuzzy.length) return;

  const item = el('div', 'pm-menu-item');
  item.setAttribute('role', 'menuitem');
  item.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm12.4 1.4 1.4-1.4L19 16.2l2.2-2.2 1.4 1.4-2.2 2.2 2.2 2.2-1.4 1.4-2.2-2.2-2.2 2.2-1.4-1.4 2.2-2.2z"/></svg>';
  item.append(
    el('span', '', exact.length ? '從歌單移除' : '從歌單移除（其他版本）'),
  );
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = popup?.closest('tp-yt-iron-dropdown') as
      | (HTMLElement & { close?: () => void })
      | null;
    dropdown?.close?.();
    startRemoveFlow(song);
  });
  listbox.append(item);
};

/* ---------------- 索引更新 ---------------- */

export const runRefresh = async (
  manual = false,
  mode: store.RefreshMode = 'quick',
) => {
  if (store.isRefreshing()) {
    if (manual) toast('歌單資料更新中…');
    return;
  }
  const first = !store.isReady();
  const loud = first || manual;
  if (loud) {
    toast(
      first || mode === 'full'
        ? '正在讀取你的歌單…'
        : '正在檢查哪些歌單有變動…',
      undefined,
      60_000,
    );
  }
  try {
    const result = await store.refresh(first ? 'full' : mode, (done, total) => {
      if (loud)
        toast(`正在讀取你的歌單…（${done}/${total}）`, undefined, 60_000);
    });
    if (!loud) return;
    if (first || mode === 'full') toast(`已讀取 ${result.total} 個歌單`);
    else if (result.read === 0) toast('歌單沒有變動');
    else toast(`已更新 ${result.read} 個有變動的歌單`);
  } catch (err) {
    console.error('[playlist-manager]', err);
    toast(`讀取歌單失敗：${(err as Error).message}`);
  }
};

/* ---------------- 啟動／停止 ---------------- */

let observer: MutationObserver | undefined;
let unsubscribe: (() => void) | undefined;
let scheduled = false;

const schedule = () => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    scan();
  });
};

export const start = () => {
  store.load();
  unsubscribe = store.onChange(() => {
    stamp++;
    schedule();
  });
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', onMenuClick, true);
  startWatching();
  schedule();
  if (store.isStale()) runRefresh().catch(console.error);
};

export const stop = () => {
  observer?.disconnect();
  unsubscribe?.();
  document.removeEventListener('click', onMenuClick, true);
  stopWatching();
  document
    .querySelectorAll(
      '.pm-badge, .pm-card-remove, .pm-menu-item, .pm-overlay, .pm-toast',
    )
    .forEach((e) => e.remove());
  document.querySelectorAll<HTMLElement>('[data-pm-key]').forEach((e) => {
    delete e.dataset.pmKey;
  });
};
