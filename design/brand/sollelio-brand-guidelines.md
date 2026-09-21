# Sollelio Brand Guidelines — Partner OS Working Set

## Brand architecture

- Masterbrand: **Sollelio**.
- Partner OS is a Sollelio product/sub-product lockup, not an independent brand.
- Use the unchanged Sollelio master symbol as the product mark.
- The product descriptor **Partner OS** is subordinate to the Sollelio wordmark.
- The Do Luxo à Mesa logo is tenant content only. Never derive the Partner OS visual language from it.

## Core palette

| Role | Colour | Hex |
| --- | --- | --- |
| Master | Mineral Indigo | `#3030A8` |
| Master accent | Cobalt | `#2457F5` |
| Primary neutral | Warm Graphite | `#25272B` |
| Light background | Warm Off-white | `#F7F4EE` |
| Dark background | Midnight Indigo | `#11152D` |
| Reverse | White | `#FFFFFF` |

The palette is a foundation, not a requirement to saturate the UI in brand colours. Partner-facing UX should remain calm, clear, lightweight and high-trust.

Contrast notes for UI use: Mineral Indigo on Warm Off-white is comfortable (≈8.5:1). Cobalt on Warm Off-white is ≈4.9:1 — fine for body text and actions, not for small or light-weight type, and never the only signal for state (`03_UX_SPEC.md §23`).

## Symbol rules

- The Sollelio symbol consists of four coordinated planes sharing one continuous negative-space route.
- Never redraw or reinterpret the symbol for Partner OS.
- Do not rotate, stretch, rearrange or independently recolour the planes.
- Do not add gradients, shadows, glow, decorative outlines or 3D effects.
- Use clear space around the logo equal to at least one quarter of the symbol width.
- Below approximately 140 px total lockup width, prefer the standalone Sollelio symbol.
- At approximately 32 px, use the symbol only.

## Typography / lockups

- Existing production Sollelio lockups use Rubik Regular and have outlined SVG production versions.
- **Production UI uses the official Sollelio SVG assets.** Never ship a generated PNG lockup into the application.
- `design/brand/partner-os/*.png` are **design references only** — they define the approved hierarchy and optical relationship between the wordmark and the Partner OS descriptor. They are not production masters.
- If implementation needs a production vector lockup, compose it from the official SVG assets and preserve that exact hierarchy rather than inventing a new product identity.

## Partner OS lockup usage

Reference images, and what each one is for:

- `sollelio-partner-os-primary.png`: the full lockup relationship — light backgrounds, login, portal headers, documentation.
- `sollelio-partner-os-reverse.png`: the same relationship on dark surfaces.
- `sollelio-partner-os-compact.png`: a tighter setting of the same two-line lockup.

In compact UI — app headers, sidebars, narrow mobile chrome — **the Sollelio symbol alone is acceptable and preferred**. Do not require or invent a separate compact wordmark; the symbol plus the surrounding product context is enough.

For favicons/app icons, use `sollelio-symbol-color.svg`; do not create a separate Partner OS symbol.

### Dark surfaces

The symbol's indigo planes sit at roughly 1.8:1 against Midnight Indigo, which is not enough to read. On dark backgrounds use the reverse treatment with a lighter plane or the mono symbol, and check the result rather than assuming the reverse asset handles it.

## Tenant branding

`partner-brands/do-luxo-a-mesa-logo-transparent.png` is the logo of the first Design Partner tenant. It may appear in organization context where useful, but:

- it must not alter the Sollelio platform palette;
- its gold/black/luxury aesthetic must not become the Partner OS visual system;
- it must never replace the Sollelio Partner OS identity in platform chrome.
