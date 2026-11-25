import * as fog from './fog.js';
import * as flicker from './flicker.js';
import * as rot from './rot.js';
import * as block from './block.js';
import * as tombstone from './tombstone.js';
import * as ritual from './ritual.js';

/** Built-in effect registry. Add new effects here and to rule-schema.json / validator.js. */
export const builtinEffects = { fog, flicker, rot, block, tombstone, ritual };
