# Vrata application icons

`vrata.svg` is copied byte-for-byte from `vrata-bb-plugin/media/vrata.svg`.
The original paths, viewBox, gray fill, transparent background, and proportions are preserved.

Regenerate with `python3 apps/desktop/assets/generate-icons.py` from the repository root.
The converter uses system librsvg and Cairo through Python's standard-library ctypes; it installs nothing.
The checked-in output was generated with librsvg 2.54.7 and Cairo 1.16.0.
Two consecutive runs produced identical bytes.

PNG and the development Dock icon are 1024 × 1024. ICNS contains 16, 32, 64, 128, 256, 512, and 1024 pixel PNG representations.
ICO contains 16, 24, 32, 48, 64, 128, and 256 pixel PNG representations.
The six runtime favicons in `apps/app/public` use the same 16 and 32 pixel PNGs for the default, dark, and development variants.
Each size is rendered directly from the original SVG.

| File | SHA-256 |
| --- | --- |
| vrata.svg | bbe5ff2c8a722fb3697ef98adbc117aaa65138c78caba9ec1558205c3d581921 |
| icon.png / icon-dev.png | 07b7e20d8891cdb464280d2155fdba7c702c14bda630547b0467034835ff3d6a |
| icon.icns | 612738f0da7b8fa06b7e94eb041cb2468481827949fef03c9aa5b5c8e90f5eb0 |
| icon.ico | d8deae9ca7e92fb6a3f5046e47a8bf84b107080c373e8a10e1a3807d043362d9 |
| favicon-16x16{,-dark,-dev}.png | d97b5e25592d1d1726b48bd20ad187e436023fae779da5dae705e3913241aa2f |
| favicon-32x32{,-dark,-dev}.png | 565fe11f2cfb7c0574f31ed5d93d965f6d65829961b9a0ef4bf9a6c11263ae2d |
