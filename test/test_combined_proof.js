const fs = require('fs');

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

const bmp = fs.readFileSync('/tmp/sample1_test.bmp');
const W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22));
const rowSize = Math.floor((24 * W + 31) / 32) * 4;
const sourceCanvas = createMockCanvas(W, H);
for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
        const bmpIdx = 138 + y * rowSize + x * 3;
        const rgbaIdx = (y * W + x) * 4;
        sourceCanvas.data[rgbaIdx] = bmp[bmpIdx + 2]; sourceCanvas.data[rgbaIdx + 1] = bmp[bmpIdx + 1]; sourceCanvas.data[rgbaIdx + 2] = bmp[bmpIdx]; sourceCanvas.data[rgbaIdx + 3] = 255;
    }
}
const sliced = LayoutDetector.sliceDeck(sourceCanvas);

const expected = [
    'MajesticWingbeat', 'KittyPryde', 'Agony', 'SpiderManBrandNewDay',
    'GrandMaster', 'ScarletWitch', 'Magik', 'HopeSummers',
    'Psylocke', 'MotherAskani', 'SuperiorIronMan', 'ShouLao'
];

const edges = JSON.parse(fs.readFileSync('data/cards_edges.json', 'utf8'));

const offColors = {
    Agony: [185, 44, 45],
    GrandMaster: [197, 183, 68],
    HopeSummers: [197, 181, 84],
    KittyPryde: [174, 167, 69],
    Magik: [128, 39, 52],
    MajesticWingbeat: [158, 123, 96],
    MotherAskani: [178, 109, 89],
    Psylocke: [101, 58, 115],
    ScarletWitch: [146, 61, 58],
    ShouLao: [200, 116, 74],
    SpiderManBrandNewDay: [134, 33, 48],
    SuperiorIronMan: [131, 100, 109]
};

function extractSlotColor(cardCanvas) {
    const cW = cardCanvas.width, cH = cardCanvas.height;
    const x1 = Math.round(cW * 0.05), y1 = Math.round(cH * 0.72);
    const w = Math.round(cW * 0.90), h = Math.round(cH * 0.24);
    const imgData = cardCanvas.getContext('2d').getImageData(x1, y1, w, h).data;
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < w * h * 4; i += 4) {
        const r = imgData[i], g = imgData[i+1], b = imgData[i+2];
        const diff = Math.max(r, g, b) - Math.min(r, g, b);
        if (diff > 35) {
            rSum += r; gSum += g; bSum += b; count++;
        }
    }
    return [
        count > 0 ? rSum / count : 128,
        count > 0 ? gSum / count : 128,
        count > 0 ? bSum / count : 128
    ];
}

function colorSimilarity(c1, c2) {
    const len1 = Math.sqrt(c1[0]*c1[0] + c1[1]*c1[1] + c1[2]*c1[2]);
    const len2 = Math.sqrt(c2[0]*c2[0] + c2[1]*c2[1] + c2[2]*c2[2]);
    if (len1 === 0 || len2 === 0) return 0.5;
    return Math.max(0, (c1[0]*c2[0] + c1[1]*c2[1] + c1[2]*c2[2]) / (len1 * len2));
}

function extractSobelVector(cardCanvas) {
    const cW = cardCanvas.width, cH = cardCanvas.height;
    const cropX = Math.round(cW * 0.05), cropY = Math.round(cH * 0.72);
    const cropW = Math.round(cW * 0.90), cropH = Math.round(cH * 0.23);
    const imgData = cardCanvas.getContext('2d').getImageData(cropX, cropY, cropW, cropH).data;
    const gray = new Float32Array(64 * 16);
    for (let dy = 0; dy < 16; dy++) {
        for (let dx = 0; dx < 64; dx++) {
            const sx = Math.min(cropW - 1, Math.floor((dx / 64) * cropW));
            const sy = Math.min(cropH - 1, Math.floor((dy / 16) * cropH));
            const idx = (sy * cropW + sx) * 4;
            gray[dy * 64 + dx] = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
        }
    }
    const mag = new Float32Array(64 * 16);
    let maxM = 0;
    for (let y = 1; y < 15; y++) {
        for (let x = 1; x < 63; x++) {
            const tl = gray[(y - 1) * 64 + (x - 1)], tc = gray[(y - 1) * 64 + x], tr = gray[(y - 1) * 64 + (x + 1)];
            const ml = gray[y * 64 + (x - 1)], mr = gray[y * 64 + (x + 1)];
            const bl = gray[(y + 1) * 64 + (x - 1)], bc = gray[(y + 1) * 64 + x], br = gray[(y + 1) * 64 + (x + 1)];
            const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
            const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
            const m = Math.sqrt(gx * gx + gy * gy);
            mag[y * 64 + x] = m;
            if (m > maxM) maxM = m;
        }
    }
    const th = Math.max(35, maxM * 0.28);
    let str = '';
    for (let i = 0; i < 1024; i++) str += mag[i] > th ? '1' : '0';
    return str;
}

function edgeDice(v1, v2) {
    let maxDice = 0;
    const n1 = (v1.match(/1/g) || []).length;
    const n2 = (v2.match(/1/g) || []).length;
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
            let inter = 0;
            for (let y = 0; y < 16; y++) {
                const sy = y + dy;
                if (sy < 0 || sy >= 16) continue;
                for (let x = 0; x < 64; x++) {
                    const sx = x + dx;
                    if (sx < 0 || sx >= 64) continue;
                    if (v1[y * 64 + x] === '1' && v2[sy * 64 + sx] === '1') inter++;
                }
            }
            const d = (2 * inter) / (n1 + n2);
            if (d > maxDice) maxDice = d;
        }
    }
    const densityPenalty = Math.abs(n1 - n2) / 1024;
    return maxDice - (0.40 * densityPenalty);
}

const costGroups = [
    { slots: [0, 1, 2, 3], cards: ['MajesticWingbeat', 'KittyPryde', 'Agony', 'SpiderManBrandNewDay'] },
    { slots: [4, 5], cards: ['GrandMaster', 'ScarletWitch'] },
    { slots: [6, 7, 8], cards: ['Magik', 'HopeSummers', 'Psylocke'] },
    { slots: [9], cards: ['MotherAskani'] },
    { slots: [10, 11], cards: ['SuperiorIronMan', 'ShouLao'] }
];

let correctCount = 0;
for (const group of costGroups) {
    const slotColors = group.slots.map(s => extractSlotColor(sliced.cards[s].canvas));
    const slotEdges = group.slots.map(s => extractSobelVector(sliced.cards[s].canvas));

    function getPerms(arr) {
        if (arr.length <= 1) return [arr];
        const res = [];
        for (let i = 0; i < arr.length; i++) {
            const rest = arr.slice(0, i).concat(arr.slice(i+1));
            for (const p of getPerms(rest)) res.push([arr[i], ...p]);
        }
        return res;
    }
    const perms = getPerms(group.cards);
    let bestPerm = null, bestScore = -Infinity;

    for (const p of perms) {
        let total = 0;
        for (let i = 0; i < p.length; i++) {
            const cardName = p[i];
            const colSim = colorSimilarity(slotColors[i], offColors[cardName]);
            const eSim = edgeDice(slotEdges[i], edges[cardName]);
            const composite = 0.50 * eSim + 0.50 * colSim;
            total += composite;
        }
        if (total > bestScore) {
            bestScore = total;
            bestPerm = p;
        }
    }

    group.slots.forEach((s, idx) => {
        const picked = bestPerm[idx];
        const exp = expected[s];
        const match = picked === exp;
        if (match) correctCount++;
        console.log("Slot " + (s+1) + ": Picked=" + picked + " | Expected=" + exp + " => " + (match ? "MATCH" : "FAIL"));
    });
}

console.log("\n=======================================================");
console.log("🎯 COMBINED MULTI-SIGNAL ACCURACY: " + correctCount + " / 12 (" + Math.round((correctCount/12)*100) + "%)");
console.log("=======================================================");
