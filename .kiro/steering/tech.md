# Tech rules
- Chrome Manifest V3, plain JavaScript (ES modules), no frameworks.
- Effects work on the whole page (filters, overlays), never site-specific DOM selectors.
- Every effect must have an undo; a haunt must never leave a page permanently broken.
- Respect prefers-reduced-motion: swap flicker for static effects.
- Rules are JSON, validated against skeleton/rule-schema.json.
- Unit tests with Vitest for engine and meters.