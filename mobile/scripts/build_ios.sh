#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
config_path="${1:-release.json}"
build_number="${2:-}"
if [[ ! "$build_number" =~ ^[1-9][0-9]*$ ]]; then
  echo 'Cách dùng: bash scripts/build_ios.sh release.json <build-number-mới>' >&2
  exit 1
fi
python3 scripts/check_ios_release.py "$config_path"
flutter pub get
flutter analyze
flutter test --concurrency=1
flutter build ipa --release --build-number="$build_number" \
  --dart-define-from-file="$config_path" --dart-define=DEMO_LOGIN=false \
  --export-options-plist=ios/ExportOptions.plist
