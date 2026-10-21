#!/bin/bash
# Build dist/animatedtiling-<version>.kwineffect, the file System Settings
# and the KDE Store install from (a zip of package/).
#   tools/package.sh [OUTDIR]
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT="${1:-$ROOT/dist}"
mkdir -p "$OUT"
python3 - "$ROOT/package" "$OUT" <<'PY'
import json, os, sys, zipfile
package, out = sys.argv[1], sys.argv[2]
version = json.load(open(os.path.join(package, "metadata.json")))["KPlugin"]["Version"]
path = os.path.abspath(os.path.join(out, "animatedtiling-%s.kwineffect" % version))
with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(package):
        for name in sorted(files):
            full = os.path.join(root, name)
            z.write(full, os.path.relpath(full, package))
print(path)
PY
