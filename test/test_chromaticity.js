const fs = require('fs');

// Test chromaticity vectors on reference cards
const refNames = ['Agony', 'KittyPryde', 'GrandMaster', 'Magik', 'HopeSummers', 'Psylocke', 'MotherAskani'];

refNames.forEach(name => {
    const buf = fs.readFileSync('/tmp/snap_cards/' + name + '.bmp');
    const rW = buf.readInt32LE(18), rH = Math.abs(buf.readInt32LE(22));
    const rBpp = buf.readUInt16LE(28);
    const rRow = Math.floor((rBpp * rW + 31) / 32) * 4;
    const rOff = buf.readUInt32LE(10);
    const rBppByte = rBpp / 8;

    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    const yStart = Math.floor(rH * 0.75), yEnd = Math.floor(rH * 0.95);
    const xStart = Math.floor(rW * 0.20), xEnd = Math.floor(rW * 0.80);

    for (let y = yStart; y < yEnd; y += 4) {
        for (let x = xStart; x < xEnd; x += 4) {
            const idx = rOff + y * rRow + x * rBppByte;
            const b = buf[idx], g = buf[idx+1], r = buf[idx+2];
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            if (max - min > 35) { // saturated
                rSum += r; gSum += g; bSum += b; count++;
            }
        }
    }

    if (count > 0) {
        const meanR = rSum / count, meanG = gSum / count, meanB = bSum / count;
        const total = meanR + meanG + meanB;
        const normR = meanR / total, normG = meanG / total, normB = meanB / total;
        console.log(`${name.padEnd(16)}: RGB=(${Math.round(meanR)}, ${Math.round(meanG)}, ${Math.round(meanB)}) | Normalized Chromaticity: (${normR.toFixed(3)}, ${normG.toFixed(3)}, ${normB.toFixed(3)})`);
    }
});
