# Round 2 visual QA

Captured against the real Express/Postgres API on port 4100, with Next development on port 3101. All `QA ` fixtures were removed afterward; the original Welcome content was preserved. Emoji boxes are expected on this host.

- Desktop, 1440×900: [light](desktop-light.png), [dark](desktop-dark.png), [detail light](desktop-detail-light.png), [detail dark](desktop-detail-dark.png), [login](desktop-login-light.png).
- iPhone SE, 375×667: [home light](mobile-home-light.png), [home dark](mobile-home-dark.png), [list light](mobile-list-light.png), [list dark](mobile-list-dark.png), [image detail light](mobile-detail-light.png), [image detail dark](mobile-detail-dark.png).
- iPhone 14 Pro Max, 430×932: [home light](iphone-14-pro-max-home-light.png), [home dark](iphone-14-pro-max-home-dark.png), [list light](iphone-14-pro-max-list-light.png), [list dark](iphone-14-pro-max-list-dark.png), [image detail light](iphone-14-pro-max-detail-light.png), [image detail dark](iphone-14-pro-max-detail-dark.png).
- iPad, 820×1180: [list light](ipad-list-light.png), [list dark](ipad-list-dark.png), [detail light](ipad-detail-light.png), [detail dark](ipad-detail-dark.png).
- German's “From Maxim” segment, 430×932: [light](german-mobile-light.png), [dark](german-mobile-dark.png).

Recreate the captures with real API and web servers running:

```sh
WEB_URL=http://localhost:3101 REAL_SCREENSHOTS=1 REAL_VISUAL_ONLY=1 node scripts/real-smoke.mjs
```

Run from `apps/web`. Omit `REAL_VISUAL_ONLY=1` to also exercise settings, both users, handoff, polling/deletion, and swipe handlers. The smoke reads credentials externally at runtime and cleans up its own fixtures in `finally`. Native Chromium touch dispatch was separately checked for vertical scrolling, spring reveal, Delete/cancel, and completion.
