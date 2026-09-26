const fs = require('fs');
const { LayoutDetector } = require('../src/layout_detector.js');

function createMockCanvas(width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    return {
        width, height, data,
        getContext: () => ({
            getImageData: (sx, sy, sw, sh) => {
                const sub = new Uint8ClampedArray(sw * sh * 4);
                for (let y = 0; y < sh; y++) {
                    for (let x = 0; x < sw; x++) {
                        const sIdx = ((sy + y) * width + (sx + x)) * 4;
                        const dIdx = (y * sw + x) * 4;
                        sub[dIdx] = data[sIdx]; sub[dIdx+1] = data[sIdx+1]; sub[dIdx+2] = data[sIdx+2]; sub[dIdx+3] = data[sIdx+3];
                    }
                }
                return { data: sub, width: sw, height: sh };
            },
            drawImage: (src, sx, sy, sw, sh, dx, dy, dw, dh) => {
                for (let y = 0; y < dh; y++) {
                    const srcY = Math.floor(sy + (y / dh) * sh);
                    for (let x = 0; x < dw; x++) {
                        const srcX = Math.floor(sx + (x / dw) * sw);
                        const sIdx = (srcY * src.width + srcX) * 4;
                        const dIdx = ((dy + y) * width + (dx + x)) * 4;
                        data[dIdx] = src.data[sIdx]; data[dIdx+1] = src.data[sIdx+1]; data[dIdx+2] = src.data[sIdx+2]; data[dIdx+3] = src.data[sIdx+3];
                    }
                }
            }
        })
    };
}
global.document = { createElement: (type) => (type === 'canvas' ? createMockCanvas(200, 280) : {}) };

function loadBmpToCanvas(filePath) {
    const buf = fs.readFileSync(filePath);
    const W = buf.readInt32LE(18), rawH = buf.readInt32LE(22), H = Math.abs(rawH);
    const isTopDown = rawH < 0;
    const bpp = buf.readUInt16LE(28);
    const rowSize = Math.floor((bpp * W + 31) / 32) * 4;
    const offset = buf.readUInt32LE(10);
    const bytesPerPix = bpp / 8;
    const canvas = createMockCanvas(W, H);
    for (let y = 0; y < H; y++) {
        const fileY = isTopDown ? y : (H - 1 - y);
        for (let x = 0; x < W; x++) {
            const idx = offset + fileY * rowSize + x * bytesPerPix;
            const rgbaIdx = (y * W + x) * 4;
            canvas.data[rgbaIdx] = buf[idx+2];
            canvas.data[rgbaIdx+1] = buf[idx+1];
            canvas.data[rgbaIdx+2] = buf[idx];
            canvas.data[rgbaIdx+3] = bytesPerPix === 4 ? buf[idx+3] : 255;
        }
    }
    return canvas;
}

const c1 = loadBmpToCanvas('/tmp/sample1_test.bmp');
const r1 = LayoutDetector.sliceDeck(c1);

console.log('Sample 1 Badge Region check (top left of each 200x280 card):');
const expectedCosts1 = [1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5];
r1.cards.forEach((card, idx) => {
    const ctx = card.canvas.getContext('2d');
    // Find exact center of blue circle inside x: 10..70, y: 10..70
    const imgData = ctx.getImageData(10, 10, 60, 60).data;
    let sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < 60; y++) {
        for (let x = 0; x < 60; x++) {
            const i = (y * 60 + x) * 4;
            const r = imgData[i], g = imgData[i+1], b = imgData[i+2];
            if (b > 150 && (b - r) > 45 && (b - g) > 30) {
                sumX += x; sumY += y; count++;
            }
        }
    }
    const badgeCx = count > 0 ? Math.round(sumX / count) + 10 : 35;
    const badgeCy = count > 0 ? Math.round(sumY / count) + 10 : 35;

    // Inside this badge center, extract the digit (16x16)
    const digitData = ctx.getImageData(badgeCx - 8, badgeCy - 8, 16, 16).data;
    let ascii = '';
    for (let dy = 0; dy < 16; dy++) {
        let row = '';
        for (let dx = 0; dx < 16; dx++) {
            const di = (dy * 16 + dx) * 4;
            const dr = digitData[di], dg = digitData[di+1], db = digitData[di+2];
            const isDigit = (dr > 150 && dg > 150 && db > 170) || (dr > 180 && dg > 180);
            row += isDigit ? '#' : ' ';
        }
        ascii += row + '\n';
    }
    console.log(`Slot ${idx+1} (Exp Cost: ${expectedCosts1[idx]}) at badge center (${badgeCx}, ${badgeCy}):\n${ascii}`);
});

console.log('\n=============================================================');
console.log('Sample 2 Badge Region check (Mobile Foil):');
const c2 = loadBmpToCanvas('/tmp/sample2_test.bmp');
const r2 = LayoutDetector.sliceDeck(c2);
const expectedCosts2 = [1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 6];

r2.cards.forEach((card, idx) => {
    const ctx = card.canvas.getContext('2d');
    const imgData = ctx.getImageData(10, 10, 60, 60).data;
    let sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < 60; y++) {
        for (let x = 0; x < 60; x++) {
            const i = (y * 60 + x) * 4;
            const r = imgData[i], g = imgData[i+1], b = imgData[i+2];
            if (b > 150 && (b - r) > 45 && (b - g) > 30) {
                sumX += x; sumY += y; count++;
            }
        }
    }
    const badgeCx = count > 0 ? Math.round(sumX / count) + 10 : 35;
    const badgeCy = count > 0 ? Math.round(sumY / count) + 10 : 35;

    const digitData = ctx.getImageData(badgeCx - 8, badgeCy - 8, 16, 16).data;
    let ascii = '';
    for (let dy = 0; dy < 16; dy++) {
        let row = '';
        for (let dx = 0; dx < 16; dx++) {
            const di = (dy * 16 + dx) * 4;
            const dr = digitData[di], dg = digitData[di+1], db = digitData[di+2];
            const isDigit = (dr > 140 && dg > 140 && db > 160) || (dr > 170 && dg > 170);
            row += isDigit ? '#' : ' ';
        }
        ascii += row + '\n';
    }
    console.log(`Slot ${idx+1} (Exp Cost: ${expectedCosts2[idx]}) at badge center (${badgeCx}, ${badgeCy}):\n${ascii}`);
});
