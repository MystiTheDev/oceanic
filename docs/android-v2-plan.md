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

## Phase 3 addition: rework the Tags & status menu
- Today the phone shows the desktop two-pane "Tags & status" modal. The right pane is squeezed so narrow that its title wraps to "Tags / & / status".
- Rework it as a single-column phone screen or bottom sheet:
  - status and tag chips with counts;
  - selecting chips shows the matching pages below, in the same list;
  - "+ New tag" stays.

## Phase 7: LAN sync (no account, no server)
This affects the desktop app too, so it's planned with its own questions and sessions once phases 3 to 6 are done.

**Scope**
- Two devices only, for now: one phone and one laptop.
- They sync directly over a shared network: home Wi-Fi, the phone's hotspot, or USB/Bluetooth tethering.
- No internet and no account needed.

**Pairing and security**
- **Pairing:**
  - In Settings → Sync → Pair a device, the desktop app shows a QR code and a 6-digit code side by side. The phone either scans the QR code with its camera or types the code.
  - The QR code carries the laptop's address and a random secret key.
  - The 6-digit code works through a PAKE handshake, which turns the short code into the same strong key, so a guess can't be checked offline. The code expires after 2 minutes.
  - Either way you pair once, and both devices remember each other.
- **Encryption:** all traffic is encrypted and authenticated with that key. Any device without the key is rejected.
- **Unpairing:** either device can unpair the other, which rotates the key. A lost or stolen device can no longer sync.

**Data model**
- **Note content:** stored as Yjs updates (BlockNote supports Yjs), so offline edits on both sides merge at the text level.
- **Page metadata** (title, tags, status, dates, pin, trash): last edit wins per field, using hybrid logical clocks.
- **Change queue:** each device keeps a queue of unsent changes, and a sync swaps both queues.

**Transport**
- **Discovery:** mDNS, but only on trusted networks. Fallbacks: the peer's last known IP, and the hotspot gateway (the phone, usually `192.168.43.1`).
- **Fallbacks without a shared network:**
  - USB tethering or Bluetooth tethering (PAN). Each creates a small network between the two devices, so the same sync code runs unchanged.
  - The app gives a short how-to for both.
- **Resumable transfers:** changes go in numbered chunks, each acknowledged. A drop resumes from the last acknowledged chunk.
- **No half-written notes:** each change is applied in one database transaction, or not at all.
- **Attachments:** text syncs first; attachments (images, PDFs, sketches) follow in the background. There's an option to hold files over N MB while on a hotspot.

**When it syncs**
- **Laptop:** Oceanic keeps listening while closed to the tray, and there's a "Start in tray with Windows" option. On wake from sleep, it offers its pending changes immediately.
- **Phone:**
  - When the phone joins a trusted network, Android wakes Oceanic. A short foreground job shows a "Syncing notes…" notification, syncs, and stops.
  - Optionally, a small listener runs on trusted networks so the laptop can pull from the phone. Android requires a persistent notification for this.
- **Manual:** a "Sync now" button on both devices.
- **Battery savers:** the app prompts the user to set battery use to "Unrestricted" on phones that kill background apps (Xiaomi, Oppo, Vivo, Samsung).

**Trusted networks**
- **On a new network**, the app asks "Sync notes on '<name>'?" with Always, Just this time and Never.
- **On networks that aren't trusted**, the app doesn't announce itself or sync.
- **Settings → Sync networks:** a list to review or remove networks.
- **Network names:** Android needs the location permission to read Wi-Fi names, and the app explains why when it asks. If permission is denied, it falls back to the router's address (BSSID), or asks every time.

**Safety net**
- **Version history:** before a synced change is applied to a note, the previous version is saved. Settings shows a "Version history" for each page with a restore button, keeping the last N versions or 30 days.
- **Sync log and status:**
  - a status dot showing synced, syncing, pending or error;
  - Settings → Sync shows the last sync time, the paired device, the network, and what changed (pages added, edited or deleted);
  - errors in plain language.

**Open questions for later**
- The listening port, and whether the Windows Firewall prompt needs an installer rule.
- Whether to keep version history on both devices or only on the laptop.
- How sync interacts with Trash: a page deleted on one device while it was edited on the other.
