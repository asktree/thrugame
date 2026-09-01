/* GIF encoder for the editor's Export GIF: `npm run bundle:gif` → lab/vendor/gifenc.js (window.GIFENC). */
import { GIFEncoder, quantize, applyPalette, nearestColorIndex } from 'gifenc';
window.GIFENC = { GIFEncoder, quantize, applyPalette, nearestColorIndex };
