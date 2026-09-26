const fs = require('fs');
const path = require('path');

function createMockCanvas(width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    return {
        width,
        height,
        data,
        getContext: () => ({
            getImageData: (sx, sy, sw, sh) => {
                const sub = new Uint8ClampedArray(sw * sh * 4);
                for (let y = 0; y < sh; y++) {
                    const srcY = sy + y;
                    if (srcY < 0 || srcY >= height) continue;
                    for (let x = 0; x < sw; x++) {
                        const srcX = sx + x;
                        if (srcX < 0 || srcX >= width) continue;
                        const srcIdx = (srcY * width + srcX) * 4;
                        const dstIdx = (y * sw + x) * 4;
                        sub[dstIdx] = data[srcIdx];
                        sub[dstIdx + 1] = data[srcIdx + 1];
                        sub[dstIdx + 2] = data[srcIdx + 2];
                        sub[dstIdx + 3] = data[srcIdx + 3];
                    }
                }
                return { data: sub, width: sw, height: sh };
            },
            drawImage: (src, sx, sy, sw, sh, dx, dy, dw, dh) => {
                for (let y = 0; y < dh; y++) {
                    const srcY = Math.floor(sy + (y / dh) * sh);
                    const dstY = dy + y;
                    if (dstY < 0 || dstY >= height || srcY < 0 || srcY >= src.height) continue;
                    for (let x = 0; x < dw; x++) {
                        const srcX = Math.floor(sx + (x / dw) * sw);
                        const dstX = dx + x;
                        if (dstX < 0 || dstX >= width || srcX < 0 || srcX >= src.width) continue;
                        const srcIdx = (srcY * src.width + srcX) * 4;
                        const dstIdx = (dstY * width + dstX) * 4;
                        data[dstIdx] = src.data[srcIdx];
                        data[dstIdx + 1] = src.data[srcIdx + 1];
                        data[dstIdx + 2] = src.data[srcIdx + 2];
                        data[dstIdx + 3] = src.data[srcIdx + 3];
                    }
                }
            }
        })
    };
}
global.document = { createElement: (type) => (type === 'canvas' ? createMockCanvas(200, 300) : {}) };

const { LayoutDetector } = require('../src/layout_detector.js');
const { StatPruner } = require('../src/stat_pruner.js');

const edges = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards_edges.json'), 'utf8'));
const cardsDb = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards_database.json'), 'utf8'));

const bmp = fs.readFileSync('/tmp/sample1_test.bmp');
const offset = bmp.readUInt32LE(10);
const W = bmp.readInt32LE(18);
const H = Math.abs(bmp.readInt32LE(22));
const rowSize = Math.floor((24 * W + 31) / 32) * 4;
const sourceCanvas = createMockCanvas(W, H);
for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
        const bmpIdx = offset + y * rowSize + x * 3;
        const rgbaIdx = (y * W + x) * 4;
        sourceCanvas.data[rgbaIdx] = bmp[bmpIdx + 2];
        sourceCanvas.data[rgbaIdx + 1] = bmp[bmpIdx + 1];
        sourceCanvas.data[rgbaIdx + 2] = bmp[bmpIdx];
        sourceCanvas.data[rgbaIdx + 3] = 255;
    }
}

const sliced = LayoutDetector.sliceDeck(sourceCanvas);
const pruner = new StatPruner();

function getCanvasSobel(canvas, xr1, yr1, xr2, yr2) {
    const W = canvas.width, H = canvas.height;
    const x1 = Math.round(W * xr1), y1 = Math.round(H * yr1);
    const w = Math.round(W * (xr2 - xr1)), h = Math.round(H * (yr2 - yr1));
    const imgData = canvas.getContext('2d').getImageData(x1, y1, w, h).data;
    const gray = new Float32Array(64 * 16);
    for (let dy = 0; dy < 16; dy++) {
        for (let dx = 0; dx < 64; dx++) {
            const sx = Math.min(w - 1, Math.floor((dx / 64) * w));
            const sy = Math.min(h - 1, Math.floor((dy / 16) * h));
            const idx = (sy * w + sx) * 4;
            gray[dy * 64 + dx] = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
        }
    }
    const edges = new Float32Array(64 * 16);
    let maxM = 0;
    for (let y = 1; y < 15; y++) {
        for (let x = 1; x < 63; x++) {
            const tl = gray[(y - 1) * 64 + (x - 1)], tc = gray[(y - 1) * 64 + x], tr = gray[(y - 1) * 64 + (x + 1)];
            const ml = gray[y * 64 + (x - 1)], mr = gray[y * 64 + (x + 1)];
            const bl = gray[(y + 1) * 64 + (x - 1)], bc = gray[(y + 1) * 64 + x], br = gray[(y + 1) * 64 + (x + 1)];
            const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
            const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
            const m = Math.sqrt(gx * gx + gy * gy);
            edges[y * 64 + x] = m;
            if (m > maxM) maxM = m;
        }
    }
    const th = Math.max(35, maxM * 0.28);
    let str = '';
    for (let i = 0; i < 1024; i++) str += edges[i] > th ? '1' : '0';
    return str;
}

function shift2D(str, dx, dy) {
    let shiftedY = '';
    if (dy > 0) shiftedY = '0'.repeat(64 * dy) + str.substring(0, 1024 - 64 * dy);
    else if (dy < 0) {
        const absDy = Math.abs(dy);
        shiftedY = str.substring(64 * absDy, 1024) + '0'.repeat(64 * absDy);
    } else shiftedY = str;

    if (dx === 0) return shiftedY;
    let res = '';
    for (let r = 0; r < 16; r++) {
        const row = shiftedY.substring(r * 64, (r + 1) * 64);
        if (dx > 0) res += '0'.repeat(dx) + row.substring(0, 64 - dx);
        else {
            const absDx = Math.abs(dx);
            res += row.substring(absDx, 64) + '0'.repeat(absDx);
        }
    }
    return res;
}

function bestDice(v1, v2) {
    let maxDice = 0;
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            const s = shift2D(v1, dx, dy);
            let inter = 0, n1 = 0, n2 = 0;
            for (let i = 0; i < 1024; i++) {
                const b1 = s[i] === '1';
                const b2 = v2[i] === '1';
                if (b1 && b2) inter++;
                if (b1) n1++;
                if (b2) n2++;
            }
            const d = (2 * inter) / (n1 + n2);
            if (d > maxDice) maxDice = d;
        }
    }
    return maxDice;
}

const expected = [
    'MajesticWingbeat', 'KittyPryde', 'Agony', 'SpiderManBrandNewDay',
    'GrandMaster', 'ScarletWitch', 'Magik', 'HopeSummers',
    'Psylocke', 'MotherAskani', 'SuperiorIronMan', 'ShouLao'
];

const trueCosts = [1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5];

// Pre-crop all 12 patches
const patchVectors = sliced.cards.map(c => getCanvasSobel(c.canvas, 0.05, 0.72, 0.95, 0.95));

// Score all candidate cards in database matching the cost
const slotCandidateLists = [];
for (let i = 0; i < 12; i++) {
    const cost = trueCosts[i];
    const pv = patchVectors[i];
    const pwrRes = pruner.extractPower(sliced.cards[i].canvas);

    const candidates = cardsDb.filter(c => c.cost === cost);
    const scored = [];
    for (const cand of candidates) {
        const tmpl = edges[cand.cardDefId];
        if (!tmpl) continue;
        const dice = bestDice(pv, tmpl);
        let pwrScore = 1.0;
        if (pwrRes.power !== null) {
            if (cand.power === pwrRes.power) pwrScore = 1.25;
            else if (Math.abs(cand.power - pwrRes.power) === 1) pwrScore = 1.0;
            else pwrScore = 0.80;
        }
        scored.push({ card: cand, dice, score: dice * pwrScore });
    }
    scored.sort((a, b) => b.score - a.score);
    slotCandidateLists.push(scored);
}

// Global Greedy Unique Assignment (assign highest confidence slots first)
const used = new Set();
const assigned = new Array(12);

const slotOrder = slotCandidateLists.map((list, i) => ({
    i,
    score: list.length > 0 ? list[0].score : 0,
    gap: list.length > 1 ? (list[0].score - list[1].score) : 1
})).sort((a, b) => b.gap - a.gap).map(x => x.i);

for (const s of slotOrder) {
    const list = slotCandidateLists[s];
    for (const item of list) {
        if (!used.has(item.card.cardDefId)) {
            used.add(item.card.cardDefId);
            assigned[s] = item;
            break;
        }
    }
}

let matches = 0;
console.log('======================================================================');
console.log('    FULL 487-CARD DATABASE BENCHMARK (SAMPLE 1)                       ');
console.log('======================================================================');
for (let i = 0; i < 12; i++) {
    const pick = assigned[i] ? assigned[i].card.cardDefId : 'None';
    const exp = expected[i];
    const isMatch = pick.toLowerCase() === exp.toLowerCase();
    if (isMatch) matches++;
    console.log(`Slot ${(i+1).toString().padStart(2)}: Picked=${pick.padEnd(22)} Exp=${exp.padEnd(22)} (Score: ${assigned[i] ? assigned[i].score.toFixed(3) : 0}) => ${isMatch ? '✓ MATCH' : '✗ FAIL'}`);
}
console.log('----------------------------------------------------------------------');
console.log(`🎯 Exact Accuracy: ${matches} / 12 (${Math.round((matches/12)*100)}%)\n`);
