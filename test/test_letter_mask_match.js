const fs = require('fs');

// Load sample1
const sBmp = fs.readFileSync('/tmp/sample1_test.bmp');
const sW = sBmp.readInt32LE(18), sH = Math.abs(sBmp.readInt32LE(22));
const sRowSize = Math.floor((24 * sW + 31) / 32) * 4;
const sOffset = sBmp.readUInt32LE(10);

function getSlotLetterMask(x1, x2, y1, y2) {
    const w = x2 - x1, h = y2 - y1;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = sOffset + (y1 + y) * sRowSize + (x1 + x) * 3;
            const b = sBmp[idx], g = sBmp[idx+1], r = sBmp[idx+2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const diff = Math.max(r, g, b) - Math.min(r, g, b);
            mask[y * w + x] = (lum > 125 || diff > 38) ? 1 : 0;
        }
    }
    return { w, h, mask };
}

function getRefLetterMask(cardName, targetW, targetH) {
    const bmp = fs.readFileSync('/tmp/snap_cards/' + cardName + '.bmp');
    const W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22));
    const bpp = bmp.readUInt16LE(28);
    const rowSize = Math.floor((bpp * W + 31) / 32) * 4;
    const offset = bmp.readUInt32LE(10);
    const bytesPerPix = bpp / 8;

    // Card frame in 1024x1024 render is approximately x: 0.15*W to 0.85*W
    // Bottom 30% is y: 0.70*H to 0.98*H
    const cX1 = Math.round(W * 0.15), cX2 = Math.round(W * 0.85);
    const cY1 = Math.round(H * 0.70), cY2 = Math.round(H * 0.98);
    const srcW = cX2 - cX1, srcH = cY2 - cY1;

    const mask = new Uint8Array(targetW * targetH);
    for (let dy = 0; dy < targetH; dy++) {
        for (let dx = 0; dx < targetW; dx++) {
            const sx = cX1 + Math.min(srcW - 1, Math.floor((dx / targetW) * srcW));
            const sy = cY1 + Math.min(srcH - 1, Math.floor((dy / targetH) * srcH));
            const idx = offset + sy * rowSize + sx * bytesPerPix;
            const a = bytesPerPix === 4 ? bmp[idx+3] : 255;
            const b = bmp[idx], g = bmp[idx+1], r = bmp[idx+2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const diff = Math.max(r, g, b) - Math.min(r, g, b);
            mask[dy * targetW + dx] = (a > 50 && (lum > 130 || diff > 45)) ? 1 : 0;
        }
    }
    return mask;
}

const slot3 = getSlotLetterMask(340, 485, 175, 245); // Slot 3: Agony (145x70)
const candidates = ['Agony', 'KittyPryde', 'Magik', 'GrandMaster', 'ScarletWitch', 'HopeSummers', 'Psylocke', 'MotherAskani', 'MajesticWingbeat'];

console.log('Testing letter mask Dice match on Slot 3 (Expected: Agony)...');
candidates.forEach(name => {
    const refMask = getRefLetterMask(name, slot3.w, slot3.h);
    // Find best shift Dice
    let maxDice = 0;
    let refOnes = 0;
    for (let i = 0; i < slot3.w * slot3.h; i++) if (refMask[i]) refOnes++;

    for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
            let inter = 0, qOnes = 0;
            for (let y = 0; y < slot3.h; y++) {
                const ry = y + dy;
                if (ry < 0 || ry >= slot3.h) continue;
                for (let x = 0; x < slot3.w; x++) {
                    const rx = x + dx;
                    if (rx < 0 || rx >= slot3.w) continue;
                    const qBit = slot3.mask[y * slot3.w + x];
                    const rBit = refMask[ry * slot3.w + rx];
                    if (qBit) qOnes++;
                    if (qBit && rBit) inter++;
                }
            }
            const dice = (2 * inter) / (qOnes + refOnes);
            if (dice > maxDice) maxDice = dice;
        }
    }
    console.log(`  Candidate: ${name.padEnd(20)} | Dice: ${maxDice.toFixed(4)} ${name === 'Agony' ? '<--- [TRUE TARGET]' : ''}`);
});

