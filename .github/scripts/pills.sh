#!/usr/bin/env bash
# Draws the README's glass pills. Usage: pills.sh <version> <stars>
set -euo pipefail
cd "$(dirname "$0")/../../branding"

pill() { # file width text
  cat > "$1" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="$2" height="28" viewBox="0 0 $2 28">
  <rect x="0.5" y="0.5" width="$(( $2 - 1 ))" height="27" rx="13.5" fill="#0b2537" fill-opacity="0.85" stroke="#38bdf8" stroke-opacity="0.45"/>
  <text x="$(( $2 / 2 ))" y="18.5" text-anchor="middle" fill="#e0f2fe" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12.5" font-weight="600">$3</text>
</svg>
EOF
}

version="$1"
stars="$2"
[ "$stars" = "1" ] && star_word="star" || star_word="stars"

pill pill-version.svg $(( 70 + ${#version} * 8 )) "🚀  Latest $version"
pill pill-stars.svg $(( 72 + ${#stars} * 8 )) "⭐  $stars $star_word"
pill pill-platforms.svg 196 "💻  Windows · macOS · Linux"
pill pill-free.svg 168 "✨  Free · No account"
