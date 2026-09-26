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

function loadBmpToCanvas(bmpPath) {
    const bmp = fs.readFileSync(bmpPath);
    const offset = bmp.readUInt32LE(10);
    const W = bmp.readInt32LE(18);
    const H = Math.abs(bmp.readInt32LE(22));
    const bpp = bmp.readUInt16LE(28);
    const bytesPerPix = bpp / 8;
    const rowSize = Math.floor((bpp * W + 31) / 32) * 4;
    const canvas = createMockCanvas(W, H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const bmpIdx = offset + y * rowSize + x * bytesPerPix;
            const rgbaIdx = (y * W + x) * 4;
            canvas.data[rgbaIdx] = bmp[bmpIdx + 2];
            canvas.data[rgbaIdx + 1] = bmp[bmpIdx + 1];
            canvas.data[rgbaIdx + 2] = bmp[bmpIdx];
            canvas.data[rgbaIdx + 3] = 255;
        }
    }
    return canvas;
}

function extractSobelVector(cardCanvas, yr, hr) {
    const cW = cardCanvas.width, cH = cardCanvas.height;
    const cropX = Math.round(cW * 0.05);
    const cropY = Math.round(cH * yr);
    const cropW = Math.round(cW * 0.90);
    const cropH = Math.round(cH * hr);
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

function matchVector(v1, v2) {
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
    return maxDice - (0.45 * densityPenalty);
}

function runBenchmark(sampleName, expCards, trueCosts) {
    console.log(`\n======================================================`);
    console.log(`    BENCHMARKING ${sampleName}                        `);
    console.log(`======================================================`);

    const canvas = loadBmpToCanvas('/tmp/sample1_test.bmp');
    const sliced = LayoutDetector.sliceDeck(canvas);
    const pruner = new StatPruner();

    const yRatios = [0.71, 0.73, 0.75];
    const hr = 0.23;

    const candidateLists = [];
    for (let i = 0; i < 12; i++) {
        const cCanvas = sliced.cards[i].canvas;
        const vectors = yRatios.map(yr => extractSobelVector(cCanvas, yr, hr));
        const pwrRes = pruner.extractPower(cCanvas);
        const cost = trueCosts[i];

        // Filter cards by Cost
        const candidates = cardsDb.filter(c => c.cost === cost);
        const scored = candidates.map(card => {
            const tmpl = edges[card.cardDefId];
            if (!tmpl) return { card, score: -1 };
            let bestSim = 0;
            for (const v of vectors) {
                const sim = matchVector(v, tmpl);
                if (sim > bestSim) bestSim = sim;
            }

            let pwrScore = 1.0;
            if (pwrRes.power !== null) {
                if (card.power === pwrRes.power) pwrScore = 1.30;
                else if (Math.abs(card.power - pwrRes.power) === 1) pwrScore = 1.0;
                else pwrScore = 0.70;
            }

            return { card, score: bestSim * pwrScore, sim: bestSim };
        }).sort((a, b) => b.score - a.score);

        candidateLists.push(scored);
    }

    // Assign globally
    const used = new Set();
    const assigned = new Array(12);

    const slotOrder = candidateLists.map((list, i) => ({
        i,
        gap: list.length > 1 ? (list[0].score - list[1].score) : 1
    })).sort((a, b) => b.gap - a.gap).map(x => x.i);

    for (const s of slotOrder) {
        for (const item of candidateLists[s]) {
            if (!used.has(item.card.cardDefId)) {
                used.add(item.card.cardDefId);
                assigned[s] = item;
                break;
            }
        }
    }

    let matches = 0;
    for (let i = 0; i < 12; i++) {
        const pick = assigned[i] ? assigned[i].card.cardDefId : 'None';
        const exp = expCards[i];
        const isMatch = pick.toLowerCase() === exp.toLowerCase();
        if (isMatch) matches++;
        console.log(`Slot ${(i+1).toString().padStart(2)}: Picked=${pick.padEnd(22)} Exp=${exp.padEnd(22)} (Score: ${assigned[i] ? assigned[i].score.toFixed(3) : 0}) => ${isMatch ? '✓ MATCH' : '✗ FAIL'}`);
    }
    console.log(`🎯 Accuracy: ${matches} / 12 (${Math.round((matches/12)*100)}%)`);
}

const exp1 = [
    'MajesticWingbeat', 'KittyPryde', 'Agony', 'SpiderManBrandNewDay',
    'GrandMaster', 'ScarletWitch', 'Magik', 'HopeSummers',
    'Psylocke', 'MotherAskani', 'SuperiorIronMan', 'ShouLao'
];
const costs1 = [1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5];

runBenchmark('Sample 1 (PC 6x2)', exp1, costs1);
