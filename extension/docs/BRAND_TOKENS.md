# Enki brand lock — Trust Buddy (C)

**Mark:** Happy robot face (soft fill + blush) inside a security shield. App plate `#0c4a6e`.

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

## Panel chrome
Default dark theme maps `--enki-*` accents to sky and `--ink-*` surfaces to navy (`#0c4a6e` / `#075985`).

License: original work for Enki — MIT with the product.
