# Pixel treasures

Transparent 256 × 256 PNG achievement medallions, one per achievement (`<id>.png`).
Hidden achievements live in `s/` under hash names (see `artName` in
`apps/api/src/lib/achievements.js`) so the file name never reveals the secret. Render
with `image-rendering: pixelated`; preserve the transparent padding and aspect
ratio. Locked badges use grayscale and 45% opacity in the dashboard CSS.

Art uses stepped circular rims, dark plum outlines, jewel colors and a single
central motif. No lettering or animal imagery. The eight approved originals
were retained and all assets downscaled with nearest-neighbor sampling.
