const fs = require('fs');

// Load sample1
const sBmp = fs.readFileSync('/tmp/sample1_test.bmp');
const sW = sBmp.readInt32LE(18), sH = Math.abs(sBmp.readInt32LE(22));
const sRowSize = Math.floor((24 * sW + 31) / 32) * 4;
const sOffset = sBmp.readUInt32LE(10);

// Load 4 reference cards from /tmp/snap_cards: Agony, KittyPryde, Magik, GrandMaster
const refNames = ['Agony', 'KittyPryde', 'Magik', 'GrandMaster', 'ScarletWitch', 'HopeSummers', 'Psylocke', 'MotherAskani', 'MajesticWingbeat'];

// Helper to get grayscale pixel from sample1
function getSampleGray(x, y) {
    if (x < 0 || x >= sW || y < 0 || y >= sH) return 0;
    const idx = sOffset + y * sRowSize + x * 3;
    return 0.299 * sBmp[idx+2] + 0.587 * sBmp[idx+1] + 0.114 * sBmp[idx];
}

// Helper to get grayscale pixel from a reference render
function loadRefGray(cardName) {
    const bmp = fs.readFileSync('/tmp/snap_cards/' + cardName + '.bmp');
    const W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22));
    const bpp = bmp.readUInt16LE(28);
    const rowSize = Math.floor((bpp * W + 31) / 32) * 4;
    const offset = bmp.readUInt32LE(10);
    const bytesPerPix = bpp / 8;

    const gray = new Float32Array(W * H);
    const alpha = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const idx = offset + y * rowSize + x * bytesPerPix;
            const a = bytesPerPix === 4 ? bmp[idx+3] : 255;
            alpha[y * W + x] = a;
            const b = bmp[idx], g = bmp[idx+1], r = bmp[idx+2];
            gray[y * W + x] = 0.299 * r + 0.587 * g + 0.114 * b;
        }
    }
    return { W, H, gray, alpha };
}

const refs = {};
refNames.forEach(n => refs[n] = loadRefGray(n));

console.log('Loaded', Object.keys(refs).length, 'reference cards at full 1024x1024 resolution.');

// In sample1, Slot 3 is Agony:
// Card 3 bounds: x in [335, 490] (width ~155px), y in [0, 240] (height ~240px)
// Scale factor between 1024x1024 render and ~155x240 card in sample1:
// In official render, card frame is ~720 wide x ~980 high.
// So scale is approx 155 / 720 = 0.215!
console.log('Testing scale correlation on Slot 3 (Agony)...');


// Let's extract Slot 3 bottom strip from sample 1 (y: 175 to 240, x: 340 to 485)
const qX = 340, qY = 175, qW = 145, qH = 65;
const query = new Float32Array(qW * qH);
let qMean = 0;
for (let y = 0; y < qH; y++) {
    for (let x = 0; x < qW; x++) {
        const val = getSampleGray(qX + x, qY + y);
        query[y * qW + x] = val;
        qMean += val;
    }
}
qMean /= (qW * qH);
let qStd = 0;
for (let i = 0; i < qW * qH; i++) {
    query[i] -= qMean;
    qStd += query[i] * query[i];
}
qStd = Math.sqrt(qStd);

console.log('Query strip extracted (145x65), matching against all 9 reference card renders...');

// For each reference card, downscale its bottom region (y: 0.70*H to 0.98*H, x: 0.15*W to 0.85*W)
// to match the query scale, and compute sliding NCC!
refNames.forEach(name => {
    const ref = refs[name];
    // In reference render, card frame is approximately x: 0.15*W to 0.85*W (width: 0.70*W)
    // and bottom region is y: 0.72*H to 0.98*H
    const refCropX = Math.round(ref.W * 0.15);
    const refCropW = Math.round(ref.W * 0.70);
    const refCropY = Math.round(ref.H * 0.70);
    const refCropH = Math.round(ref.H * 0.28);

    // Rescale this ref crop to width = qW (145px) and height = round(refCropH * (qW / refCropW))
    const tW = qW;
    const tH = Math.round(refCropH * (qW / refCropW)); // ~58px
    const templ = new Float32Array(tW * tH);

    for (let dy = 0; dy < tH; dy++) {
        for (let dx = 0; dx < tW; dx++) {
            const sx = refCropX + Math.min(refCropW - 1, Math.floor((dx / tW) * refCropW));
            const sy = refCropY + Math.min(refCropH - 1, Math.floor((dy / tH) * refCropH));
            templ[dy * tW + dx] = ref.gray[sy * ref.W + sx];
        }
    }

    // Compute NCC between query and template across small vertical/horizontal shifts
    let maxNcc = -1;
    for (let sy = -10; sy <= 10; sy++) {
        for (let sx = -8; sx <= 8; sx++) {
            let dot = 0, tSumSq = 0;
            let count = 0;
            for (let y = 0; y < tH; y++) {
                const qy = y + sy;
                if (qy < 0 || qy >= qH) continue;
                for (let x = 0; x < tW; x++) {
                    const qx = x + sx;
                    if (qx < 0 || qx >= qW) continue;
                    const qVal = query[qy * qW + qx];
                    const tVal = templ[y * tW + x];
                    dot += qVal * tVal;
                    tSumSq += tVal * tVal;
                    count++;
                }
            }
            if (count > 0.6 * tW * tH && tSumSq > 0) {
                const ncc = dot / (qStd * Math.sqrt(tSumSq));
                if (ncc > maxNcc) maxNcc = ncc;
            }
        }
    }

    console.log(`  Candidate: ${name.padEnd(20)} | NCC Score: ${maxNcc.toFixed(4)} ${name === 'Agony' ? '<--- [TRUE TARGET]' : ''}`);
});

