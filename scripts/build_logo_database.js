const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../data/cards_database.json');
const edgesPath = path.join(__dirname, '../data/cards_edges.json');
const outPath = path.join(__dirname, '../data/cards_logos.json');

const cards = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
let legacyEdges = {};
if (fs.existsSync(edgesPath)) {
    try { legacyEdges = JSON.parse(fs.readFileSync(edgesPath, 'utf8')); } catch (_) {}
}

function extractRefSignalsFromBmp(bmpPath) {
    const bmp = fs.readFileSync(bmpPath);
    const W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22));
    const bpp = bmp.readUInt16LE(28);
    const rowSize = Math.floor((bpp * W + 31) / 32) * 4;
    const offset = bmp.readUInt32LE(10);
    const bytesPerPix = bpp / 8;

    function getRefPix(x, y) {
        if (x < 0 || x >= W || y < 0 || y >= H) return [0,0,0,0];
        const idx = offset + y * rowSize + x * bytesPerPix;
        const b = bmp[idx], g = bmp[idx+1], r = bmp[idx+2];
        const a = bytesPerPix === 4 ? bmp[idx+3] : 255;
        return [r, g, b, a];
    }

    const cX1 = 150, cX2 = 870, cY1 = 20, cY2 = 1000;
    const cardW = cX2 - cX1, cardH = cY2 - cY1;

    const cropX = Math.round(cX1 + 0.06 * cardW);
    const cropY = Math.round(cY1 + 0.86 * cardH);
    const cropW = Math.round(0.88 * cardW);
    const cropH = Math.round(0.11 * cardH);

    const gray = new Float32Array(64 * 16);
    let rSum = 0, gSum = 0, bSum = 0, satCount = 0;

    for (let dy = 0; dy < 16; dy++) {
        for (let dx = 0; dx < 64; dx++) {
            const px = cropX + Math.floor((dx / 64) * cropW);
            const py = cropY + Math.floor((dy / 16) * cropH);
            const [r, g, b, a] = getRefPix(px, py);
            gray[dy * 64 + dx] = a > 50 ? (0.299 * r + 0.587 * g + 0.114 * b) : 0;

            const diff = Math.max(r, g, b) - Math.min(r, g, b);
            if (a > 50 && diff > 35) {
                rSum += r; gSum += g; bSum += b; satCount++;
            }
        }
    }

    const edges = new Uint8Array(64 * 16);
    let maxMag = 0;
    const mag = new Float32Array(64 * 16);
    for (let y = 1; y < 15; y++) {
        for (let x = 1; x < 63; x++) {
            const tl = gray[(y-1)*64 + (x-1)], tc = gray[(y-1)*64 + x], tr = gray[(y-1)*64 + (x+1)];
            const ml = gray[y*64 + (x-1)], mr = gray[y*64 + (x+1)];
            const bl = gray[(y+1)*64 + (x-1)], bc = gray[(y+1)*64 + x], br = gray[(y+1)*64 + (x+1)];
            const gx = -tl + tr - 2*ml + 2*mr - bl + br;
            const gy = -tl - 2*tc - tr + bl + 2*bc + br;
            const m = Math.sqrt(gx*gx + gy*gy);
            mag[y * 64 + x] = m;
            if (m > maxMag) maxMag = m;
        }
    }
    const th = Math.max(30, maxMag * 0.25);
    let edgeStr = '';
    for (let i = 0; i < 1024; i++) edgeStr += mag[i] > th ? '1' : '0';

    const avgColor = satCount > 10 ? [rSum/satCount, gSum/satCount, bSum/satCount] : [128,128,128];
    const tot = avgColor[0] + avgColor[1] + avgColor[2] + 1e-5;
    const chrom = [Math.round((avgColor[0]/tot)*1000)/1000, Math.round((avgColor[1]/tot)*1000)/1000, Math.round((avgColor[2]/tot)*1000)/1000];

    return { edges: edgeStr, chrom, satCount };
}

const logoDb = {};
let upgradedCount = 0;

cards.forEach(c => {
    const defId = c.cardDefId;
    const localBmp = path.join('/tmp/snap_cards', `${defId}.bmp`);
    if (fs.existsSync(localBmp)) {
        logoDb[defId] = extractRefSignalsFromBmp(localBmp);
        upgradedCount++;
    } else if (legacyEdges[defId]) {
        logoDb[defId] = {
            edges: legacyEdges[defId],
            chrom: [0.333, 0.333, 0.333],
            satCount: 0
        };
    }
});

console.log(`Compiled logo database: ${Object.keys(logoDb).length} cards (${upgradedCount} high-precision upgraded logos)`);
fs.writeFileSync(outPath, JSON.stringify(logoDb, null, 2));
console.log(`Saved to ${outPath}`);
