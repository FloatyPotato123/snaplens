const fs = require('fs');

// Load sample1
const sBmp = fs.readFileSync('/tmp/sample1_test.bmp');
const sW = sBmp.readInt32LE(18), sH = Math.abs(sBmp.readInt32LE(22));
const sRowSize = Math.floor((24 * sW + 31) / 32) * 4;
const sOffset = sBmp.readUInt32LE(10);

// Load an official render (e.g. Agony.bmp)
const aBmp = fs.readFileSync('/tmp/snap_cards/Agony.bmp');
const aW = aBmp.readInt32LE(18), aH = Math.abs(aBmp.readInt32LE(22));
const aRowSize = Math.floor((32 * aW + 31) / 32) * 4;
const aOffset = aBmp.readUInt32LE(10);

console.log('Testing high-res sliding match between Slot 3 (Agony) and Agony.bmp');

// Slot 3 card in sample 1:
// X range: ~340 to ~500 (col 3)
// Y range: ~0 to ~250 (row 1)
// Let's extract the bottom region of Slot 3 (y: 180 to 245, x: 345 to 495)
const slot3W = 495 - 345, slot3H = 245 - 180;
console.log('Slot 3 bottom dimensions:', slot3W, 'x', slot3H);

