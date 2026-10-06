# Enki Browser brand

Enki Browser's own icon and logo. The build reads these instead of the Enki extension's toolbar
icons, so the browser's look is reviewed here, in this repository.

The mark is the shield robot: a silver shield with a dark visor and two sky-blue (`#38bdf8`) eyes.
It replaced the earlier face mark on 2026-10-05. The same artwork is in the Enki extension
(`danilogiles/enkibrowser`, `src/assets/logo.svg`).

| File | What | Used by |
|---|---|---|
| `icons/enki-browser-{16,20,24,32,40,48,64,96,128,256,512}.png` | App icon: the shield on a dark rounded plate (`#1e1e1e`) | Windows: `enki.ico` (16, 20, 24, 32, 40, 48, 64, 256) → chrome.exe, chrome.dll, EnkiBrowser.exe, EnkiBrowserLauncher.exe, EnkiBrowserSetup.exe. Linux: hicolor 16–512 and Chromium's `product_logo_48.png` |
| `enki-browser.svg` | The app icon as a vector | Linux `hicolor/scalable/apps` |
| `logo-master.png` | The shield alone, no plate, 512 px | Chromium's product logos in the paks (About page, profile menu), resized to each one |
| `logo.svg` | The shield alone as a vector (256 viewBox) | Source of `logo-master.png`; matches the New Tab page and side panel |

The plate is for the operating system (taskbar, Start menu, dock), where the icon sits next to
other apps. Inside the browser the mark has no plate, like the New Tab page.

The 16, 20 and 24 px icons were hand-hinted by Ink, pixel by pixel. They are not downscaled from
the vector, so don't regenerate them from the SVG. If the artwork changes, ask for new ones.

Licensed with the rest of Enki Browser under the MIT License (`LICENSE`, © 2026 Enki contributors).
