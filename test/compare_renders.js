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
global.document = { createElement: (type) => (type === 'canvas' ? createMockCanvas(200, 300) : {}) };

// Load sample1
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

// Let's inspect Slot 3 (Agony) in sample1 vs Agony.bmp
const slot3 = sliced.cards[2].canvas;
console.log('Sample 1 Slot 3 dimensions:', slot3.width, 'x', slot3.height);

const agonyBmp = fs.readFileSync('/tmp/snap_cards/Agony.bmp');
const aW = agonyBmp.readInt32LE(18), aH = Math.abs(agonyBmp.readInt32LE(22));
const aRowSize = Math.floor((32 * aW + 31) / 32) * 4;
console.log('Agony.bmp dimensions:', aW, 'x', aH);

