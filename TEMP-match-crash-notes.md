# TEMPORARY: match-screen freeze/crash investigation (delete this file when resolved)

Status as of 2026-10-23: PAUSED. A code audit found a likely root cause (see "Leading suspect"
below); it still has to be confirmed on the phone.

## Symptom
Entering a bot match on the user's phone (Redmi, Android 15 / HyperOS, Snapdragon "bengal",
Adreno 610, 7.8 GB RAM, package com.rockstylechess.app): the board draws without pieces, flickers,
the screen is unresponsive, touching it kills the app. Happens with every bot tier (so not the
Stockfish WebView). Intermittent: also happened on the previous APK and went away after restarts.

## What the phone log (adb logcat) showed
- ~5 s after "Bot challenged" the render thread logs
  `Adreno-GSL ioctl KGSL_GPU_COMMAND failed: Resource deadlock would occur`,
  HWUI "Davey" frames of 2.2-2.5 s, 241 skipped frames, a 1344x768 image taking 2.9 s to load
  (CPU/GPU starvation), then `tgkill: send 9` on the RenderThread and the process dies on touch.
- Google Mobile Ads SDK starts at launch and creates its own in-process Vulkan/WebView context.
- Piece sprites are very heavy auto-traced SVGs: 170-450 KB and **121-2,089 `<path>` elements
  each** (counted 2026-10-23; Molten Gold's bk/wn have 2,000+, Crimson Reaper's 1,500-1,800), 12
  per set. The earlier "up to 261 paths" figure was wrong.

## Leading suspect (code audit, 2026-10-23, not yet confirmed on device)
expo-image 3.0.11 on Android does NOT rasterize SVGs: `SVGDrawableTranscoder.kt` turns each one
into an `SVGPictureDrawable` (a `PictureDrawable`, i.e. recorded vector commands), and nothing in
expo-image flattens it to a bitmap. So every frame in which the board area redraws, HWUI replays
every path of all 32 pieces on the GPU. The match screen always has something animating (clock
pulse, World Tour shimmer, check pulse, move animations), so the redraws are continuous. That fits
every symptom: a low-end Adreno 610 GPU overloaded (`KGSL_GPU_COMMAND failed`, 2.5 s frames, the
RenderThread killed), every bot tier affected, intermittent, worse since the board got bigger in
6726d5d.

Consequences:
- The `sizeFinal` gate below only avoids parsing the SVGs twice; it cannot help the per-frame
  drawing cost.
- `BoardAssetPrewarm` warms 44x44 entries; Glide keys its cache by size, so it never warms the
  board's real size.

Fix ready to try: `scripts/rasterize-pieces.mjs` (committed) already renders every SVG to a
256x256 PNG in `assets/pieces/png/<set>/` (generated, **not committed**; `crimson-reaper` is
missing and must be generated). Point `src/components/ui/pieceSprites.ts` (and the prewarm) at
the PNGs. The SVGs stay in the repo as the source files. **Needs the user's OK** (see suspect 5).

## Layout-per-frame fix (2026-10-24, applied, NOT yet tested on device)
Piece, dying-piece and check-pulse animated styles no longer return width/height (plain style from
`squareSize` instead; only transform/opacity/zIndex animate), and `package.json` sets
`reanimated.staticFeatureFlags.ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS = true` so those updates skip
layout on Android. The flag is compiled in, so it needs a native rebuild (`scripts/build-apk.sh`,
not just a JS reload). Test on the phone with the same deep link; check `Davey` / `Resource deadlock`.

## Other suspects (none confirmed)
1. The board is laid out in two passes since commit 6726d5d (2026-10-16, "Enlarge match board,
   height-cap it"): full width first, then capped to the measured space, so 32 heavy SVG pieces
   decode at two sizes. First symptoms appeared after that commit. (Mitigated by `sizeFinal`.)
2. Heavy blurred boxShadows / glow layers on the board, header pills, action bar.
3. Full-screen backdrop + crowd images.
4. AdMob SDK GPU/WebView contention.
5. The SVG piece decoding itself (user wants the SVGs KEPT; do not rasterize them to PNG unless
   the user agrees).

## Changes made for this investigation
The ChessBoard / match.tsx changes below were **committed** with `8bd310c` ("Economy sinks"), not
left in the working tree as this file used to say. The Kotlin plugin is still uncommitted.
- `src/components/ui/ChessBoard.tsx`: new props `sizeFinal` (pieces mount only after the board
  size has been stable for 150 ms; only the match screen passes it), plus diagnostic props
  `debugNoPieces`, `debugPlain`.
- `src/app/(play)/match.tsx`: passes `sizeFinal`; diagnostic route param `dbg` = comma list:
  `np` no pieces, `ng` no board glow/frame shadow, `nv` no backdrop + crowd image,
  `nsh` no header/action-bar shadows. REMOVE these switches once the cause is found.
- `plugins/withKotlinMetadataSkip.js` + `app.json` plugin entry: REQUIRED for the AdMob native
  build (keep; unrelated to the crash). Not yet committed.
- A diagnostic release APK containing all of the above is built at
  `android/app/build/outputs/apk/release/app-release.apk` (2026-10-19 20:36), NOT yet installed on
  the phone (phone was not connected). The previous build (pieces gating only) may or may not have
  been installed by the user; the user reported the problem unchanged.

## Plan to resume
1. Reconnect phone (USB debugging; udev rule for Xiaomi already added in /etc/udev/rules.d/51-android.rules).
   adb is at ~/Android/Sdk/platform-tools/adb.
2. `adb install -r` the APK, start `adb logcat`, and open the match through a deep link, e.g.
   `adb shell am start -a android.intent.action.VIEW -d "rockstylechess://match?mode=bot&difficulty=easy&botId=roadie-rick&botName=Roadie%20Rick&botEmoji=%F0%9F%A7%A2&color=w&duration=5m&venueTier=garage&dbg=np"`
   and repeat with dbg=ng, nv, nsh, and combinations, plus no dbg. After each, grep the log for
   `Resource deadlock`, `Davey`, `tgkill`, `has died`.
3. Build one APK with the PNG pieces (see "Leading suspect") and repeat step 2 without `dbg`.
   If `Resource deadlock` / `Davey` are gone, that was it. Otherwise fall back to the other
   suspects. Then remove the `dbg` switches.
4. Delete this file. Commit the Kotlin plugin + the real fix.

Do NOT use `pkill -f`/`pgrep -f` with a pattern that appears in the same command (kills the shell).
