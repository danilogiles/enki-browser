# Enki brand — the shield robot

**Mark:** a friendly white robot whose head is a security shield: dark visor, two sky-blue eyes. No plate behind it, so it sits on light and dark taskbars alike; a faint dark outline keeps it visible on white. Original artwork (inspired by friendly-robot assistant icons, copying none).

## Colors
| Token | Hex | Use |
|---|---|---|
| `enki-sky-400` | `#38bdf8` | Primary accent / send / links |
| `enki-sky-200` | `#bae6fd` | Soft glow |
| `enki-cyan-300` | `#7dd3fc` | Shield stroke / secondary text |
| `enki-face` | `#e0f2fe` → `#7dd3fc` | Buddy face fill |
| `enki-blush` | `#fb7185` @ ~55% | Cheeks |
| `enki-navy-900` | `#0c4a6e` | App chrome / icon plate |
| `enki-navy-800` | `#075985` | Panels / shield fill |
| `enki-ink` | `#0c4a6e` | Face features on light face |

## Files
- `src/assets/logo.svg` — 128 master (extension / in-app)
- `public/icons/icon{16,32,48,128}.png`
- Regenerated via `npm run icons` (`scripts/icons.mjs`)

## Panel and Enki Home
Default theme is **System**: neutral light or dark greys following the OS, like the browser around them, with sky (`#38bdf8` dark / `#0284c7` light) as the only accent. The original navy look is the optional **Enki Navy** theme.

## Panel chrome (Enki Navy)
Default dark theme maps `--enki-*` accents to sky and `--ink-*` surfaces to navy (`#0c4a6e` / `#075985`).

License: original work for Enki — MIT with the product.
