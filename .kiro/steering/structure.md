# Structure
- skeleton/ is the single source of truth; apps import it, never fork it.
- An app = manifest.json + rules.json + site matchers. App code beyond that should be minimal.
- New effects live in skeleton/effects/<name>.js and export {apply, undo, description}.