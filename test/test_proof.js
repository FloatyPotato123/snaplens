const fs = require('fs');
const path = require('path');

function createMockCanvas(width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    return {
        width, height, data,
        getContext: () => ({
            getImageData: (sx, sy, sw, sh) => {
                const sub = new Uint8ClampedArray(sw * sh * 4);
                for (let y = 0; y < sh; y++) {
                    for (let x = 0; x < sw; x++) {
                        const srcIdx = ((sy + y) * width + (sx + x)) * 4;
                        const dstIdx = (y * sw + x) * 4;
                        sub[dstIdx] = data[srcIdx]; sub[dstIdx+1] = data[srcIdx+1]; sub[dstIdx+2] = data[srcIdx+2]; sub[dstIdx+3] = data[srcIdx+3];
                    }
                }
                return { data: sub, width: sw, height: sh };
            },
            drawImage: (src, sx, sy, sw, sh, dx, dy, dw, dh) => {
                for (let y = 0; y < dh; y++) {
                    const srcY = Math.floor(sy + (y / dh) * sh);
                    for (let x = 0; x < dw; x++) {
                        const srcX = Math.floor(sx + (x / dw) * sw);
                        const srcIdx = (srcY * src.width + srcX) * 4;
                        const dstIdx = ((dy + y) * width + (dx + x)) * 4;
                        data[dstIdx] = src.data[srcIdx]; data[dstIdx+1] = src.data[srcIdx+1]; data[dstIdx+2] = src.data[srcIdx+2]; data[dstIdx+3] = src.data[srcIdx+3];
                    }
                }
            }
        })
    };
}
global.document = { createElement: (type) => (type === 'canvas' ? createMockCanvas(200, 300) : {}) };
const { LayoutDetector } = require('../src/layout_detector.js');

const cardsDb = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards_database.json'), 'utf8'));

// Convert sample1 to BMP
const bmp = fs.readFileSync('/tmp/sample1_test.bmp');
const W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22));
const rowSize = Math.floor((24 * W + 31) / 32) * 4;
const sourceCanvas = createMockCanvas(W, H);
for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
        const bmpIdx = 138 + y * rowSize + x * 3;
        const rgbaIdx = (y * W + x) * 4;
        sourceCanvas.data[rgbaIdx] = bmp[bmpIdx + 2];
        sourceCanvas.data[rgbaIdx + 1] = bmp[bmpIdx + 1];
        sourceCanvas.data[rgbaIdx + 2] = bmp[bmpIdx];
        sourceCanvas.data[rgbaIdx + 3] = 255;
    }
}
const sliced = LayoutDetector.sliceDeck(sourceCanvas);

const expected = [
    'MajesticWingbeat', 'KittyPryde', 'Agony', 'SpiderManBrandNewDay',
    'GrandMaster', 'ScarletWitch', 'Magik', 'HopeSummers',
    'Psylocke', 'MotherAskani', 'SuperiorIronMan', 'ShouLao'
];
const trueCosts = [1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5];

// For each slot, extract the nameplate feature vector:
// 1. Column projection profile (horizontal text density, 32 points)
// 2. Average saturated text color (R/G, B/G ratios)
// 3. Horizontal span width (active letter area ratio)
function extractFeatures(cardCanvas) {
    const cW = cardCanvas.width, cH = cardCanvas.height;
    // Nameplate area
    const x1 = Math.round(cW * 0.05), y1 = Math.round(cH * 0.72);
    const w = Math.round(cW * 0.90), h = Math.round(cH * 0.24);
    const imgData = cardCanvas.getContext('2d').getImageData(x1, y1, w, h).data;

    const colDensity = new Float32Array(32);
    let rSum = 0, gSum = 0, bSum = 0, satCount = 0;
    let minActiveX = 32, maxActiveX = 0;

    for (let x = 0; x < 32; x++) {
        const sx = Math.floor((x / 32) * w);
        let colSum = 0;
        for (let y = 0; y < h; y++) {
            const idx = (y * w + sx) * 4;
            const r = imgData[idx], g = imgData[idx+1], b = imgData[idx+2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const diff = Math.max(r, g, b) - Math.min(r, g, b);
            if (lum > 140 || diff > 40) colSum++;
            if (diff > 40) {
                rSum += r; gSum += g; bSum += b; satCount++;
            }
        }
        colDensity[x] = colSum / h;
        if (colSum > 3) {
            if (x < minActiveX) minActiveX = x;
            if (x > maxActiveX) maxActiveX = x;
        }
    }

    const span = Math.max(0, maxActiveX - minActiveX) / 32;
    const avgR = satCount > 0 ? rSum / satCount : 128;
    const avgG = satCount > 0 ? gSum / satCount : 128;
    const avgB = satCount > 0 ? bSum / satCount : 128;

    return { colDensity, span, avgR, avgG, avgB };
}

console.log('Sample 1 Slots Feature Extraction:');
for (let i = 0; i < 12; i++) {
    const feat = extractFeatures(sliced.cards[i].canvas);
    console.log(
        `Slot ${(i+1).toString().padStart(2)} (${expected[i].padEnd(20)}): ` +
        `Cost=${trueCosts[i]} | Span=${feat.span.toFixed(2)} | RGB=(${Math.round(feat.avgR)}, ${Math.round(feat.avgG)}, ${Math.round(feat.avgB)})`
    );
}
