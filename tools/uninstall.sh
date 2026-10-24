#!/bin/bash
# Turn off and remove Animated Tiling.
set -euo pipefail

kwriteconfig6 --file kwinrc --group Plugins --key animatedtilingEnabled false
if qdbus6 org.kde.KWin /KWin >/dev/null 2>&1; then
    qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect animatedtiling >/dev/null 2>&1 || true
    qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure
fi
kpackagetool6 --type=KWin/Effect --remove animatedtiling
echo "Removed."
