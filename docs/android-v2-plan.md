# Android: Home revamp, updater, and PC features

The phases are built in this order. Each phase gets its own commit on the `android` branch and is tested on the emulator.

## 1. GitHub updater
- **When it checks:** on launch, at most once a day (the last-check time is kept in localStorage), plus a "Check for updates" button in Settings.
- **Source:** `api.github.com/repos/<owner>/oceanic/releases`. It takes the newest release whose tag starts with `android-v`, and that release must have an `.apk` asset.
- **Version check:** the tag's semver is compared with the app version (`getVersion()`).
- **Prompt:** a bottom sheet showing the version and the release notes (markdown rendered as plain text), with three buttons: Update, Later, and Skip this version (the skip is stored).
- **Update:**
  1. A small Kotlin plugin downloads the APK to the cache with a progress bar.
  2. It opens the system installer through a FileProvider intent.
  3. The manifest gets `REQUEST_INSTALL_PACKAGES`. If "install unknown apps" isn't allowed yet, the app sends the user to that setting.
- **Signing:** the existing keystore must sign every release. Users on android-v2.0.6 may need to reinstall once if that build used a different key.

## 2. Home revamp
- **Animated hero:** layered SVG waves that drift slowly, a time-of-day gradient (dawn, day, dusk, night), the greeting, the date, and the avatar.
- **Recent pages:** a horizontal snap carousel of big glass cards. Each card shows the icon, the title, a 3-line preview and the time. Pinned pages come first, with at most 8 cards and a "See all" card at the end.
- **Tags and Collections:**
  - tag chips, where tapping one opens the Pages tab filtered by that tag;
  - top-level pages that have subpages are shown as "folders", and tapping one shows its subpages.
- **Due soon:** kept, restyled as glass.
- **Motion:** staggered entrance, spring press on cards, and `prefers-reduced-motion` turns it all off.

## 3. Search tab
- Full-text search over titles and content, using the existing search the desktop app uses.
- Recent searches, with up to 8 kept, and highlighted snippets in the results.

## 4. Calendar tab
- A month grid with dots on the days that have due pages. Swipe to change the month.
- Tapping a day lists that day's pages below the grid.

## 5. Page properties (Date, Status, Tags)
- A row of chips under the title. Tapping a chip opens a bottom sheet: a native date picker, a status list, or a tag picker that can also create tags.

## 6. .ocean import and export
- **Export:** write to the cache, then open the Android share sheet.
- **Import:** a file picker, plus an intent filter so .ocean files open in Oceanic from other apps.
- This replaces the "Coming soon" buttons in Settings.

## Open risks
- The GitHub API allows 60 requests per hour without a token. That is fine at one check a day.
- Opening a page bumps its `updatedAt`, which skews the "Recent pages" order. Fix this in phase 2.

## 2b. Splash screen (after phase 2)
- Same look as the desktop splash: reuse its design and assets from the desktop splash code in `src-tauri` and the frontend.
- Shown for a fixed ~1.5 s, only on a cold start (not when the app comes back from the background). A tap can't skip it.
- Opens on the desktop scene's final pose: the logo has already risen, the wordmark shows and there's a short shimmer. The desktop status line and loading bar are dropped.
- Exit: waves rise up and reveal Home.
- Android's native splash (API 31+ and the theme) uses the same background colour, so there's no white flash before it.
