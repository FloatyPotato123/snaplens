const fs = require('fs');
const path = require('path');
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

const cardsDb = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards_database.json'), 'utf8'));
const edges = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards_edges.json'), 'utf8'));

// Feature extraction from card patch
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
        for (let dx = -6; dx <= 6; dx++) {
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
            const d = (2 * inter) / (n1 + n2 + 1e-5);
            if (d > maxDice) maxDice = d;
        }
    }
    const densityPenalty = Math.abs(n1 - n2) / 1024;
    return maxDice - (0.35 * densityPenalty);
}

function runPipeline(sampleName, bmpPath, expCards) {
    console.log(`\n======================================================`);
    console.log(`    EVALUATING PIPELINE ON ${sampleName}`);
    console.log(`======================================================`);

    const canvas = loadBmpToCanvas(bmpPath);
    const sliced = LayoutDetector.sliceDeck(canvas);
    const pruner = new StatPruner(cardsDb);

    // 1. Detect stats
    const rawStats = sliced.cards.map(c => ({
        cost: pruner.extractCost(c.canvas).cost,
        costConf: pruner.extractCost(c.canvas).confidence,
        power: pruner.extractPower(c.canvas).power
    }));

    // 2. Monotonic DP smoothing
    const smoothedCosts = pruner.smoothMonotonicCosts(rawStats);
    console.log('Smoothed Costs:', smoothedCosts);

    // 3. Multi-crop sliding edge match
    const yRatios = [0.68, 0.72, 0.76, 0.80];
    const hr = 0.22;

    const candidateLists = [];
    for (let i = 0; i < 12; i++) {
        const cCanvas = sliced.cards[i].canvas;
        const vectors = yRatios.map(yr => extractSobelVector(cCanvas, yr, hr));
        const cost = smoothedCosts[i];
        const pwr = rawStats[i].power;

        // Candidate pool from smoothed cost (with +-1 if pool is small)
        let candidates = cardsDb.filter(c => c.cost === cost);
        if (candidates.length < 10) {
            candidates = cardsDb.filter(c => Math.abs(c.cost - cost) <= 1);
        }

        const scored = candidates.map(card => {
            const tmpl = edges[card.cardDefId];
            if (!tmpl) return { card, score: -1 };

            let bestSim = 0;
            for (const v of vectors) {
                const sim = matchVector(v, tmpl);
                if (sim > bestSim) bestSim = sim;
            }

            // Power agreement
            let pwrScore = 1.0;
            if (pwr !== null && pwr >= -8 && pwr <= 25) {
                if (card.power === pwr) pwrScore = 1.25;
                else if (Math.abs(card.power - pwr) === 1) pwrScore = 1.0;
                else pwrScore = 0.80;
            }

            return { card, score: bestSim * pwrScore, sim: bestSim };
        }).sort((a, b) => b.score - a.score);

        candidateLists.push(scored);
    }

    // 4. Global Greedy / Hungarian Assignment to prevent duplicate cards
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
        console.log(`Slot ${(i+1).toString().padStart(2)}: Picked=${pick.padEnd(24)} Exp=${exp.padEnd(24)} (Score: ${assigned[i] ? assigned[i].score.toFixed(3) : 0}) => ${isMatch ? 'MATCH' : 'FAIL'}`);
    }
    console.log(`\nAccuracy: ${matches} / 12 (${Math.round((matches/12)*100)}%)`);
}

const exp1 = [
    'MajesticWingbeat', 'KittyPryde', 'Agony', 'SpiderManBrandNewDay',
    'GrandMaster', 'ScarletWitch', 'Magik', 'HopeSummers',
    'Psylocke', 'MotherAskani', 'SuperiorIronMan', 'ShouLao'
];

runPipeline('Sample 1 (PC 6x2)', '/tmp/sample1_test.bmp', exp1);

