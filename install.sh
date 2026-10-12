#!/bin/bash
# 歌單管理插件 — 一鍵安裝／更新
# 用法：bash install.sh
# 之後 Pear Desktop 官方有新版時，再執行一次就會更新。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HOME/pear-desktop-custom"
APP="/Applications/YouTube Music.app"
BACKUP="$HOME/YouTube Music（原版備份）.app"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

# 1. 工具
say "檢查必要工具"
if ! command -v brew >/dev/null; then
  echo "需要 Homebrew，請先到 https://brew.sh 安裝後再執行一次。"; exit 1
fi
command -v git >/dev/null || brew install git
NODE_OK=$(node -e 'const [a,b,c]=process.versions.node.split(".").map(Number);console.log(a>=24||(a===22&&(b>22||(b===22&&c>=2)))?1:0)' 2>/dev/null || echo 0)
if [ "$NODE_OK" != "1" ]; then
  echo "安裝 Node.js…"; brew install node@24 && brew link --overwrite --force node@24
fi
PNPM_MAJOR=$(pnpm -v 2>/dev/null | cut -d. -f1 || echo 0)
if [ "${PNPM_MAJOR:-0}" -lt 11 ]; then
  echo "安裝 pnpm 11…"; npm i -g pnpm@11
fi

# 2. 原始碼
say "下載／更新 Pear Desktop 原始碼"
if [ -d "$REPO/.git" ]; then
  git -C "$REPO" checkout -- src/i18n/resources >/dev/null 2>&1 || true
  git -C "$REPO" pull --ff-only
else
  git clone --depth 1 https://github.com/pear-devs/pear-desktop.git "$REPO"
fi

# 3. 放入插件
say "加入歌單管理插件"
rm -rf "$REPO/src/plugins/playlist-manager"
cp -R "$HERE/playlist-manager" "$REPO/src/plugins/playlist-manager"
node "$HERE/add-i18n.mjs" "$REPO"

# 4. 編譯
say "編譯 App（第一次約 3–5 分鐘）"
cd "$REPO"
pnpm install
pnpm clean
pnpm build
ARCH=$(uname -m); [ "$ARCH" = "arm64" ] || ARCH="x64"
# 官方圖示是 Xcode 26 才能處理的 .icon 格式；改用 PNG 圖示，就不需要安裝 Xcode
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron-builder --mac dir --"$ARCH" -p never \
  -c.mac.icon=assets/generated/icons/png/1024x1024.png
BUILT=$(find "$REPO/pack" -maxdepth 2 -name "*.app" -type d | head -1)
[ -n "$BUILT" ] || { echo "找不到編譯好的 App"; exit 1; }

# 5. 安裝
say "安裝到應用程式資料夾"
osascript -e 'quit app "YouTube Music"' >/dev/null 2>&1 || true
sleep 2
if [ -d "$APP" ] && [ ! -d "$BACKUP" ]; then
  echo "備份原本的 App 到：$BACKUP"
  mv "$APP" "$BACKUP"
else
  rm -rf "$APP"
fi
cp -R "$BUILT" "$APP"
xattr -cr "$APP"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

say "完成！"
cat <<'EOF'
接下來：
  1. 打開 YouTube Music（登入狀態和設定都會保留）
     若跳出「鑰匙圈存取」詢問，請選「永遠允許」。
  2. 左上角 Plugins（插件）→ 勾選「歌單管理」
  3. 第一次會花幾秒讀取所有歌單，左下角會顯示進度。

想還原成原版：把「YouTube Music（原版備份）.app」拖回應用程式資料夾即可。
EOF
open "$APP"
