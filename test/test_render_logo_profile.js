const fs = require('fs');

function analyzeRender(cardName) {
    const bmp = fs.readFileSync('/tmp/snap_cards/' + cardName + '.bmp');
    const W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22));
    const bpp = bmp.readUInt16LE(28);
    const rowSize = Math.floor((bpp * W + 31) / 32) * 4;
    const offset = bmp.readUInt32LE(10);
    const bytesPerPix = bpp / 8;

    console.log(`\nOfficial Render Profile for ${cardName} (H=${H})`);

    // Scan bottom 30% of card (y: 0.70 to 0.98)
    for (let yr = 0.70; yr <= 0.98; yr += 0.02) {
        const y = Math.floor(H * yr);
        let edgeCount = 0;
        let lumSum = 0;
        let satCount = 0;
        const x1 = Math.floor(W * 0.20), x2 = Math.floor(W * 0.80);
        const count = x2 - x1;

        for (let x = x1; x < x2; x++) {
            const idx = offset + y * rowSize + x * bytesPerPix;
            const idxR = offset + y * rowSize + (x + 1) * bytesPerPix;
            const a = bytesPerPix === 4 ? bmp[idx + 3] : 255;
            if (a < 50) continue;

            const b = bmp[idx], g = bmp[idx+1], r = bmp[idx+2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            lumSum += lum;

            const diff = Math.max(r, g, b) - Math.min(r, g, b);
            if (diff > 40) satCount++;

            const bR = bmp[idxR], gR = bmp[idxR+1], rR = bmp[idxR+2];
            const lumR = 0.299 * rR + 0.587 * gR + 0.114 * bR;
            if (Math.abs(lumR - lum) > 40) edgeCount++;
        }

        console.log(`y/H=${yr.toFixed(2)} (y=${y}): edgeDensity=${(edgeCount/count).toFixed(2)} | sat=${(satCount/count).toFixed(2)} | avgLum=${Math.round(lumSum/count)}`);
    }
}

analyzeRender('KittyPryde');
analyzeRender('Agony');
analyzeRender('Magik');
