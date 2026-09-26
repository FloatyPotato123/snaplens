const fs = require('fs');

const bmp = fs.readFileSync('/tmp/sample1_test.bmp');
const W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22));
const rowSize = Math.floor((24 * W + 31) / 32) * 4;
const offset = bmp.readUInt32LE(10);

// Let's inspect 4 very different cards in Row 1:
// Col 1 (Majestic Wingbeat): x in [0, 165], y in [0, 250]
// Col 2 (Kitty Pryde): x in [165, 330], y in [0, 250]
// Col 3 (Agony): x in [330, 495], y in [0, 250]
// Col 4 (Spider-Man BND): x in [495, 660], y in [0, 250]

const cards = [
    { name: 'MajesticWingbeat', x1: 5, x2: 160 },
    { name: 'KittyPryde', x1: 170, x2: 325 },
    { name: 'Agony', x1: 335, x2: 490 },
    { name: 'SpiderManBND', x1: 500, x2: 655 }
];

cards.forEach(c => {
    console.log(`\n========================================`);
    console.log(`Analyzing Logo Profile for ${c.name}`);
    console.log(`========================================`);

    // In Row 1, bottom of card is around y = 225 to 250
    // Let's scan y from 160 to 245
    for (let y = 165; y <= 245; y += 5) {
        let edgeSum = 0;
        let highContrast = 0;
        let lumSum = 0;
        const width = c.x2 - c.x1;

        for (let x = c.x1 + 10; x < c.x2 - 10; x++) {
            const idx = offset + y * rowSize + x * 3;
            const idxNext = offset + y * rowSize + (x + 1) * 3;
            const idxBelow = offset + (y + 1) * rowSize + x * 3;

            const b = bmp[idx], g = bmp[idx+1], r = bmp[idx+2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            lumSum += lum;

            const bR = bmp[idxNext], gR = bmp[idxNext+1], rR = bmp[idxNext+2];
            const lumR = 0.299 * rR + 0.587 * gR + 0.114 * bR;

            const bD = bmp[idxBelow], gD = bmp[idxBelow+1], rD = bmp[idxBelow+2];
            const lumD = 0.299 * rD + 0.587 * gD + 0.114 * bD;

            const dx = Math.abs(lumR - lum);
            const dy = Math.abs(lumD - lum);
            const grad = dx + dy;
            if (grad > 40) edgeSum++;
            if (lum > 150) highContrast++;
        }

        const count = (c.x2 - 10) - (c.x1 + 10);
        console.log(`y=${y}: edgeDensity=${(edgeSum/count).toFixed(2)} | brightPixels=${(highContrast/count).toFixed(2)} | avgLum=${Math.round(lumSum/count)}`);
    }
});
