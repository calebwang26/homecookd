#!/bin/bash
# Backup plan: turn a glasses recording saved on this laptop into one MP4 on the Desktop (15 fps, the
# glasses' audio), then show it in Finder so you can AirDrop it to the phone.
#
#   ~/edible-glasses/tools/make_video.sh                     newest session
#   ~/edible-glasses/tools/make_video.sh sessions/<id>       a given one
#
# Power-cycle the glasses before each cook: a session runs from power-on, so this makes the whole of it.
cd "$(dirname "$0")/.." || exit 1
dir="${1:-$(ls -td sessions/*/ 2>/dev/null | head -1)}"
[ -d "$dir/raw" ] || { echo "No recording found (looked for $dir/raw)."; exit 1; }
out="$HOME/Desktop/glasses-$(date +%Y-%m-%d-%H%M).mp4"
.venv/bin/python - "$dir" "$out" <<'EOF'
import sys
from pathlib import Path
sys.path.insert(0, "receiver")
import session_builder as sb
d, out = Path(sys.argv[1]), Path(sys.argv[2])
s = sb.load_session(sb.raw_files_for(d))
print(f"Building {s.duration / 60:.1f} min from {d.name} ({len(s.gaps)} Wi-Fi gaps, held as a still frame)...")
sb.build_mp4(s, 0.0, s.duration, out, fps=15)
print(f"Done: {out}")
EOF
[ -f "$out" ] && open -R "$out"
