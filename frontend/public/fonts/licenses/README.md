# Script fallback font notices

The application uses Next.js `next/font/google` to download and self-host these
Google Fonts at build time. Browser font requests stay on the application's own
origin; no Google font CDN request is required at runtime.

- **Noto Sans Bengali**: official license copied unchanged from
  https://raw.githubusercontent.com/google/fonts/main/ofl/notosansbengali/OFL.txt
  on 2026-10-30. SHA-256:
  `754f0e221aa7d5a915489f3bf1f20fe53ddc35ab2834a4d91656d78f9622de70`.
- **Noto Sans JP**: official license copied unchanged from
  https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt
  on 2026-10-30. SHA-256:
  `1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9`.

Original copyright and SIL Open Font License text are preserved in the adjacent
files. These families supplement Inter, not replace it. The JP fallback uses
Japanese glyph forms; it is not a claim of correct regional typography for all
Chinese, Korean or other languages. No language is inferred from a person's name.
Other scripts still depend on browser/system fallback and are not certified by
this targeted Bengali/Japanese fixture correction.
