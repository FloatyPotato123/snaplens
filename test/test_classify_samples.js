const fs = require('fs');
const { LayoutDetector } = require('../src/layout_detector.js');
const { classifyCostDigit } = require('./test_digit_classifier.js');

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

function extractCardDigitMask(cardCanvas) {
    const ctx = cardCanvas.getContext('2d');
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
    const mask = new Uint8Array(256);
    for (let dy = 0; dy < 16; dy++) {
        for (let dx = 0; dx < 16; dx++) {
            const di = (dy * 16 + dx) * 4;
            const dr = digitData[di], dg = digitData[di+1], db = digitData[di+2];
            const isDigit = (dr > 140 && dg > 140 && db > 160) || (dr > 170 && dg > 170);
            mask[dy * 16 + dx] = isDigit ? 1 : 0;
        }
    }
    return mask;
}

console.log('Testing Digit Classifier on Sample 1 (PC):');
const c1 = loadBmpToCanvas('/tmp/sample1_test.bmp');
const r1 = LayoutDetector.sliceDeck(c1);
const exp1 = [1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5];
let correct1 = 0;
r1.cards.forEach((card, idx) => {
    const mask = extractCardDigitMask(card.canvas);
    const res = classifyCostDigit(mask);
    const match = res.cost === exp1[idx];
    if (match) correct1++;
    console.log(` Slot ${(idx+1).toString().padStart(2)}: Cost=${res.cost} (Exp: ${exp1[idx]}) conf=${res.confidence.toFixed(3)} => ${match ? 'MATCH' : 'FAIL'}`);
});
console.log(`Sample 1 Cost Accuracy: ${correct1} / 12 (${Math.round((correct1/12)*100)}%)`);

console.log('\nTesting Digit Classifier on Sample 2 (Mobile Foil):');
const c2 = loadBmpToCanvas('/tmp/sample2_test.bmp');
const r2 = LayoutDetector.sliceDeck(c2);
const exp2 = [1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 6];
let correct2 = 0;
r2.cards.forEach((card, idx) => {
    const mask = extractCardDigitMask(card.canvas);
    const res = classifyCostDigit(mask);
    const match = res.cost === exp2[idx];
    if (match) correct2++;
    console.log(` Slot ${(idx+1).toString().padStart(2)}: Cost=${res.cost} (Exp: ${exp2[idx]}) conf=${res.confidence.toFixed(3)} => ${match ? 'MATCH' : 'FAIL'}`);
});
console.log(`Sample 2 Cost Accuracy: ${correct2} / 12 (${Math.round((correct2/12)*100)}%)`);

function smoothMonotonicCosts(slotDetections) {
    const K = 7; // costs 0 to 6
    const N = slotDetections.length;
    // DP table: dp[slot][cost] = min cost to achieve monotonic sequence up to slot with cost c
    const dp = Array.from({ length: N }, () => new Float32Array(K).fill(Infinity));
    const parent = Array.from({ length: N }, () => new Int32Array(K).fill(-1));

    for (let c = 0; c < K; c++) {
        // loss is negative confidence or distance to detected cost
        const detCost = slotDetections[0].cost;
        const conf = slotDetections[0].confidence;
        const loss = (c === detCost) ? (1 - conf) : (1.0 + Math.abs(c - detCost) * 0.5);
        dp[0][c] = loss;
    }

    for (let i = 1; i < N; i++) {
        const detCost = slotDetections[i].cost;
        const conf = slotDetections[i].confidence;

        for (let c = 0; c < K; c++) {
            const loss = (c === detCost) ? (1 - conf) : (1.0 + Math.abs(c - detCost) * 0.5);
            // find min dp[i-1][prevC] for prevC <= c
            let minPrev = Infinity, bestPrevC = -1;
            for (let prevC = 0; prevC <= c; prevC++) {
                if (dp[i-1][prevC] < minPrev) {
                    minPrev = dp[i-1][prevC];
                    bestPrevC = prevC;
                }
            }
            dp[i][c] = minPrev + loss;
            parent[i][c] = bestPrevC;
        }
    }

    let minFinal = Infinity, bestFinalC = -1;
    for (let c = 0; c < K; c++) {
        if (dp[N-1][c] < minFinal) {
            minFinal = dp[N-1][c];
            bestFinalC = c;
        }
    }

    const result = new Array(N);
    let currC = bestFinalC;
    for (let i = N - 1; i >= 0; i--) {
        result[i] = currC;
        currC = parent[i][currC];
    }
    return result;
}

const det1 = r1.cards.map(c => classifyCostDigit(extractCardDigitMask(c.canvas)));
const sCosts1 = smoothMonotonicCosts(det1);
console.log('\nSample 1 Smoothed Costs:', sCosts1);
console.log('Sample 1 Expected Costs:', exp1);

const det2 = r2.cards.map(c => classifyCostDigit(extractCardDigitMask(c.canvas)));
const sCosts2 = smoothMonotonicCosts(det2);
console.log('\nSample 2 Smoothed Costs:', sCosts2);
console.log('Sample 2 Expected Costs:', exp2);
