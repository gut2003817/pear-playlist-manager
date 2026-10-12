// 歌單管理 — Pear Desktop 插件
// https://github.com/gut2003817/pear-playlist-manager (MIT)
// 使用 Pear Desktop（pear-devs/pear-desktop, MIT）的插件框架

import { app } from 'electron';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import style from './style.css?inline';
import { runRefresh, start, stop } from './ui';
import { checkForUpdate } from './update-check';

const REFRESH_EVENT = 'playlist-manager:refresh';
const FULL_REFRESH_EVENT = 'playlist-manager:full-refresh';
const VERSION_EVENT = 'playlist-manager:app-version';

export default createPlugin({
  name: () => t('plugins.playlist-manager.name'),
  description: () => t('plugins.playlist-manager.description'),
  restartNeeded: false,
  addedVersion: '3.12.X',
  config: {
    enabled: false,
  },
  stylesheets: [style],
  menu: ({ window }) => [
    {
      label: t('plugins.playlist-manager.menu.refresh'),
      click() {
        window.webContents.send(REFRESH_EVENT);
      },
    },
    {
      label: t('plugins.playlist-manager.menu.full-refresh'),
      click() {
        window.webContents.send(FULL_REFRESH_EVENT);
      },
    },
  ],
  backend: {
    start({ ipc }) {
      // 前端拿不到 App 版本號，由主程序提供
      ipc.handle(VERSION_EVENT, () => app.getVersion());
    },
    stop({ ipc }) {
      ipc.removeHandler(VERSION_EVENT);
    },
  },
  renderer: {
    start({ ipc }) {
      ipc.on(REFRESH_EVENT, () => {
        runRefresh(true, 'quick').catch(console.error);
      });
      ipc.on(FULL_REFRESH_EVENT, () => {
        runRefresh(true, 'full').catch(console.error);
      });
      start();
      (ipc.invoke(VERSION_EVENT) as Promise<string>)
        .then((version) => checkForUpdate(version))
        .catch((err: unknown) => {
          console.warn('[playlist-manager] 無法檢查更新', err);
        });
    },
    stop({ ipc }) {
      ipc.removeAllListeners(REFRESH_EVENT);
      ipc.removeAllListeners(FULL_REFRESH_EVENT);
      stop();
    },
  },
});
