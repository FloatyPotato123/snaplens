const fs = require('fs');

const bmp = fs.readFileSync('/tmp/sample1_test.bmp');
const W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22));
const rowSize = Math.floor((24 * W + 31) / 32) * 4;
const offset = bmp.readUInt32LE(10);

function inspectSlot(slotName, x1, x2, y1, y2) {
    console.log(`\n--- Slot Letters in Screenshot for ${slotName} (${x2-x1}x${y2-y1}) ---`);
    for (let y = y1; y < y2; y += 3) {
        let line = '';
        for (let x = x1; x < x2; x += 3) {
            const idx = offset + y * rowSize + x * 3;
            const b = bmp[idx], g = bmp[idx+1], r = bmp[idx+2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const diff = Math.max(r, g, b) - Math.min(r, g, b);
            const isLetter = (lum > 125 || diff > 38);
            line += isLetter ? '#' : ' ';
        }
        console.log(line);
    }
}

// Slot 2: Kitty Pryde (x: 180 to 320, y: 190 to 242)
inspectSlot('Slot 2 (Kitty Pryde)', 180, 320, 190, 242);

// Slot 3: Agony (x: 345 to 485, y: 175 to 242)
inspectSlot('Slot 3 (Agony)', 345, 485, 175, 242);
