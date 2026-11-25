# Poltergeist Kit

Poltergeist Kit is a skeleton for Chrome extensions that "haunt" websites to help break bad browsing habits. Nothing is blocked instantly: effects grow with the time you spend, and every effect can be undone, so a haunt never leaves a page permanently broken.

The shared code lives in `skeleton/`. Each app (`app1-doomscroll/`, `app2-tab-graveyard/`) is a `manifest.json`, a `rules.json` and its site matchers on top of that skeleton.

## Effects

- `fog`: Page blurs and loses colour; both scale with intensity.
- `flicker`: Page brightness stutters. With prefers-reduced-motion it becomes a static dim instead.
- `rot`: Characters in visible text decay into glyphs of dust; more of them as intensity grows.
- `block`: A full-page overlay that darkens with intensity and blocks interaction once intensity reaches blockAt.
- `tombstone`: A full-page tombstone naming the page and how long it was left, with one action button; blocks interaction once intensity reaches blockAt.
- `ritual`: A full-page candle puzzle: draw one path through every square, passing the numbered candles in order. Finishing it reports the "exorcised" action; blocks interaction once intensity reaches blockAt.
