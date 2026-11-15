#!/bin/bash
# 🔇 V8: az RNNoise C-mag (../rnnoise, xiph BSD-3) statikus XCFramework-ként iOS-re (eszköz + szimulátor).
# A pod a React Native fejléc-környezetében fordít (folly `Stdlib.h` ↔ `stdlib.h` ütközés) → a C-mag tiszta
# clang-gal, külön készül, a pod csak csatolja. Futtatás a modul gyökeréből: bash scripts/build-rnnoise-ios.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=rnnoise
OUT=ios/RemixRNNoise.xcframework
TMP=$(mktemp -d)
build() { # sdk arch minver
  local sdk=$1 arch=$2 dir="$TMP/$1-$2"
  mkdir -p "$dir"
  for f in $SRC/*.c; do
    xcrun -sdk "$sdk" clang -arch "$arch" -m"$3" -O3 -DUSE_WEIGHTS_FILE=1 -I"$SRC" -Iios -c "$f" -o "$dir/$(basename "$f" .c).o"
  done
  xcrun ar rcs "$dir/libremixrnnoise.a" "$dir"/*.o
}
build iphoneos arm64 "iphoneos-version-min=15.1"
build iphonesimulator arm64 "ios-simulator-version-min=15.1"
build iphonesimulator x86_64 "ios-simulator-version-min=15.1"
mkdir -p "$TMP/sim"
xcrun lipo -create "$TMP/iphonesimulator-arm64/libremixrnnoise.a" "$TMP/iphonesimulator-x86_64/libremixrnnoise.a" -output "$TMP/sim/libremixrnnoise.a"
rm -rf "$OUT"
xcodebuild -create-xcframework -library "$TMP/iphoneos-arm64/libremixrnnoise.a" -library "$TMP/sim/libremixrnnoise.a" -output "$OUT" >/dev/null
rm -rf "$TMP"
echo "kész: $OUT"
