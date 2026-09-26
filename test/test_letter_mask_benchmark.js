const fs = require('fs');

// Load sample1
const sBmp = fs.readFileSync('/tmp/sample1_test.bmp');
const sW = sBmp.readInt32LE(18), sH = Math.abs(sBmp.readInt32LE(22));
const sRowSize = Math.floor((24 * sW + 31) / 32) * 4;
const sOffset = sBmp.readUInt32LE(10);

// Sliced card coordinates from our lattice detector:
// Slot 1: at (5, 16) 156x220
// Slot 2: at (167, 16) 156x220
// Slot 3: at (329, 16) 156x220
// Slot 5: at (653, 16) 156x220
// Slot 7: at (5, 240) 156x220
// Slot 8: at (167, 240) 156x220
// Slot 9: at (329, 240) 156x220
// Slot 10: at (491, 240) 156x220

const slots = [
    { name: 'KittyPryde', x: 167, y: 16, w: 156, h: 220 },
    { name: 'Agony', x: 329, y: 16, w: 156, h: 220 },
    { name: 'GrandMaster', x: 653, y: 16, w: 156, h: 220 },
    { name: 'Magik', x: 5, y: 240, w: 156, h: 220 },
    { name: 'HopeSummers', x: 167, y: 240, w: 156, h: 220 },
    { name: 'Psylocke', x: 329, y: 240, w: 156, h: 220 },
    { name: 'MotherAskani', x: 491, y: 240, w: 156, h: 220 }
];

// Extract letter profile: 32 horizontal columns across the bottom 30% of card
// Each column stores:
// 1. Column vertical fill ratio (how much of that column has letter pixels)
// 2. Average saturated text color (R/G, B/G)
function extractLetterProfile(getPix, x1, y1, w, h) {
    const startY = Math.round(y1 + 0.68 * h);
    const endY = Math.round(y1 + 0.98 * h);
    const letterH = endY - startY;

    const colFill = new Float32Array(32);
    let rSum = 0, gSum = 0, bSum = 0, satCount = 0;

    for (let c = 0; c < 32; c++) {
        const colStartX = Math.round(x1 + (c / 32) * w);
        const colEndX = Math.round(x1 + ((c + 1) / 32) * w);
        let filledRows = 0;

        for (let y = startY; y < endY; y++) {
            let rowHasLetter = false;
            for (let x = colStartX; x < colEndX; x++) {
                const [r, g, b] = getPix(x, y);
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                const diff = Math.max(r, g, b) - Math.min(r, g, b);
                if (lum > 130 || diff > 38) {
                    rowHasLetter = true;
                    if (diff > 35) {
                        rSum += r; gSum += g; bSum += b; satCount++;
                    }
                }
            }
            if (rowHasLetter) filledRows++;
        }
        colFill[c] = filledRows / letterH;
    }

    const avgColor = [
        satCount > 0 ? rSum / satCount : 128,
        satCount > 0 ? gSum / satCount : 128,
        satCount > 0 ? bSum / satCount : 128
    ];

    return { colFill, avgColor };
}

function getSamplePix(x, y) {
    if (x < 0 || x >= sW || y < 0 || y >= sH) return [0,0,0];
    const i = sOffset + y * sRowSize + x * 3;
    return [sBmp[i+2], sBmp[i+1], sBmp[i]];
}

// Load official reference profiles
const refs = {};
slots.forEach(s => {
    const buf = fs.readFileSync('/tmp/snap_cards/' + s.name + '.bmp');
    const rW = buf.readInt32LE(18), rH = Math.abs(buf.readInt32LE(22));
    const rBpp = buf.readUInt16LE(28);
    const rRow = Math.floor((rBpp * rW + 31) / 32) * 4;
    const rOff = buf.readUInt32LE(10);
    const rBppByte = rBpp / 8;

    const getRefPix = (x, y) => {
        if (x < 0 || x >= rW || y < 0 || y >= rH) return [0,0,0];
        const idx = rOff + y * rRow + x * rBppByte;
        return [buf[idx+2], buf[idx+1], buf[idx]];
    };

    // In official 1024x1024 render, card frame is approx x: 0.15*rW to 0.85*rW, y: 0.02*rH to 0.98*rH
    const cardW = Math.round(rW * 0.70);
    const cardH = Math.round(rH * 0.96);
    refs[s.name] = extractLetterProfile(getRefPix, Math.round(rW * 0.15), Math.round(rH * 0.02), cardW, cardH);
});

console.log('Testing Profile Correlation across all 7 test slots:');
let totalMatches = 0;

slots.forEach(slot => {
    const slotProf = extractLetterProfile(getSamplePix, slot.x, slot.y, slot.w, slot.h);

    const scored = Object.keys(refs).map(candidateName => {
        const candProf = refs[candidateName];

        // 1. 1D Correlation of column density with shift +- 2 cols
        let maxCorr = -1;
        for (let shift = -2; shift <= 2; shift++) {
            let dot = 0, sumA = 0, sumB = 0;
            for (let i = 0; i < 32; i++) {
                const ci = i + shift;
                if (ci < 0 || ci >= 32) continue;
                const a = slotProf.colFill[i];
                const b = candProf.colFill[ci];
                dot += a * b;
                sumA += a * a;
                sumB += b * b;
            }
            const corr = dot / (Math.sqrt(sumA * sumB) + 1e-5);
            if (corr > maxCorr) maxCorr = corr;
        }

        // 2. Color similarity (cosine of saturated text color)
        const c1 = slotProf.avgColor, c2 = candProf.avgColor;
        const len1 = Math.sqrt(c1[0]*c1[0] + c1[1]*c1[1] + c1[2]*c1[2]);
        const len2 = Math.sqrt(c2[0]*c2[0] + c2[1]*c2[1] + c2[2]*c2[2]);
        const colSim = (c1[0]*c2[0] + c1[1]*c2[1] + c1[2]*c2[2]) / (len1 * len2);

        const composite = 0.50 * maxCorr + 0.50 * colSim;
        return { candidateName, composite, maxCorr, colSim };
    }).sort((a, b) => b.composite - a.composite);

    const top = scored[0];
    const isMatch = top.candidateName === slot.name;
    if (isMatch) totalMatches++;

    console.log(`Slot ${slot.name.padEnd(16)}: Top=${top.candidateName.padEnd(16)} (Score: ${top.composite.toFixed(3)}, shape: ${top.maxCorr.toFixed(3)}, col: ${top.colSim.toFixed(3)}) => ${isMatch ? 'MATCH' : 'FAIL'}`);
});

console.log(`\nAccuracy: ${totalMatches} / ${slots.length} (${Math.round((totalMatches/slots.length)*100)}%)`);

