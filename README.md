# 歌單管理插件（Pear Desktop）

> A [Pear Desktop](https://github.com/pear-devs/pear-desktop) plugin that shows which of your YouTube Music playlists a song is already in, and lets you remove it right from search results. Changes sync to all your devices. UI is in Traditional Chinese.

在 YouTube Music 搜尋歌曲時，直接顯示這首歌在你哪些歌單裡，並可以從歌單移除。修改的是雲端歌單，手機和 YouTube 會同步。

## 安裝（macOS）

```bash
git clone https://github.com/gut2003817/pear-playlist-manager.git
cd pear-playlist-manager
bash install.sh
```

1. 腳本會下載 Pear Desktop 原始碼、加入這個插件、編譯後取代 `/Applications/YouTube Music.app`（第一次約 3–5 分鐘）。
2. 原本的 App 會備份成「YouTube Music（原版備份）.app」，放在你的使用者資料夾。想還原就把它拖回應用程式資料夾。
3. 打開 App 後，左上角 **Plugins** → 勾選 **歌單管理**。

需要 Homebrew；Node.js 與 pnpm 沒有的話腳本會自動安裝。不需要安裝 Xcode。

## 功能
- **搜尋結果標示**：歌在歌單裡，旁邊會出現代表歌單（歌最多的那個）的封面和名稱；在多個歌單會顯示「+N」。
  - 實線框：就是這首。
  - 虛線框：名稱相同、但是不同版本（例如歌詞影片 vs 官方歌曲），請自行確認。
- **從歌單移除**：
  - 熱門結果卡片：「播放」「儲存」旁邊的「移除」按鈕。
  - 每一列：三點選單裡的「從歌單移除」，或直接點標示。
  - 只在一個歌單 → 直接移除，左下角可以按「復原」。
  - 在多個歌單 → 跳出勾選視窗，勾的移除、沒勾的保留。
- **跨裝置同步**：直接修改雲端歌單，手機 YouTube Music、YouTube 會同步。

## 資料更新
- 在 App 裡加歌（儲存至播放清單）、新建或刪除歌單，標示會在 1 秒內自動更新。
- 在其他裝置改的歌單，每 6 小時自動同步；想馬上同步可以到 Plugins → 歌單管理 → **更新有變動的歌單**（只重讀歌曲數有變的歌單）。
- 如果標示看起來不對，可以用 **全部重新讀取**。

## 限制
- 只會管理你自己建立的歌單，「喜歡的音樂」不算在內。
- 「復原」會把歌加回歌單最後面，原本的位置不會保留。
- 使用 YouTube Music 網頁版的非公開內部 API，YouTube 改版時可能失效。

## 更新
```bash
cd pear-playlist-manager
git pull
bash install.sh
```
Pear Desktop 官方出新版時也一樣，重跑 `install.sh` 就會拉最新原始碼並保留插件。

## 檔案說明
| 檔案 | 用途 |
|---|---|
| `playlist-manager/` | 插件本體，安裝時會複製到 Pear Desktop 的 `src/plugins/` |
| `install.sh` | 一鍵安裝／更新腳本 |
| `add-i18n.mjs` | 把插件名稱加進 Pear Desktop 的語系檔 |

## 來源與致謝
- **Pear Desktop**（[pear-devs/pear-desktop](https://github.com/pear-devs/pear-desktop)，前身為 th-ch/youtube-music，MIT 授權）：這個插件使用它的插件框架（`createPlugin`、多語系 `t()`），安裝腳本會在編譯時下載它的原始碼。
- 呼叫 YouTube Music API 時需要的登入驗證，直接引用 Pear Desktop 內建 `music-together` 插件的工具函式（`src/plugins/music-together/queue/client.ts`）；只是在編譯時 import，沒有複製它的程式碼到這個 repo。
- 程式碼由 [@gut2003817](https://github.com/gut2003817) 與 **Claude**（Anthropic 的 AI 助理）共同撰寫。
- 本專案與 Google、YouTube 無關，也不是 Pear Desktop 官方插件。

## 授權
[MIT](LICENSE)
