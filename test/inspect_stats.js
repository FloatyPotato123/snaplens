const fs = require('fs');
const { LayoutDetector } = require('../src/layout_detector.js');
const { StatPruner } = require('../src/stat_pruner.js');

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
global.document = { createElement: (type) => (type === 'canvas' ? createMockCanvas(200, 300) : {}) };

const bmp = fs.readFileSync('/tmp/sample1_test.bmp');
const W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22));
const rowSize = Math.floor((24 * W + 31) / 32) * 4;
const canvas = createMockCanvas(W, H);
for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
        const bmpIdx = 138 + y * rowSize + x * 3;
        const rgbaIdx = (y * W + x) * 4;
        canvas.data[rgbaIdx] = bmp[bmpIdx + 2]; canvas.data[rgbaIdx + 1] = bmp[bmpIdx + 1]; canvas.data[rgbaIdx + 2] = bmp[bmpIdx]; canvas.data[rgbaIdx + 3] = 255;
    }
}
const sliced = LayoutDetector.sliceDeck(canvas);
const pruner = new StatPruner();

const expectedCosts = [1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5];
const expectedPowers = [2, 1, 2, 2, 2, 3, 2, 4, 4, 4, 7, 8];

for (let i = 0; i < 12; i++) {
    const card = sliced.cards[i].canvas;
    const cost = pruner.extractCost(card);
    const pwr = pruner.extractPower(card);
    console.log(`Slot ${(i+1).toString().padStart(2)}: Cost=${cost.cost} (Exp: ${expectedCosts[i]}) conf=${cost.confidence.toFixed(2)} | Power=${pwr.power} (Exp: ${expectedPowers[i]}) conf=${pwr.confidence.toFixed(2)}`);
}
