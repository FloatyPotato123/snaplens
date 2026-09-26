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
const { LogoMatcher } = require('../src/logo_matcher.js');
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
const matcher = new LogoMatcher(edges);

const expected = [
    'MajesticWingbeat', 'KittyPryde', 'Agony', 'SpiderManBrandNewDay',
    'GrandMaster', 'ScarletWitch', 'Magik', 'HopeSummers',
    'Psylocke', 'MotherAskani', 'SuperiorIronMan', 'ShouLao'
];

const trueCosts = [1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5];

let totalMatches = 0;

for (let i = 0; i < 12; i++) {
    const cardCanvas = sliced.cards[i].canvas;
    const exp = expected[i];
    const trueCost = trueCosts[i];

    // Detect stats
    const pruner = new StatPruner();
    const costRes = pruner.extractCost(cardCanvas);
    const powerRes = pruner.extractPower(cardCanvas);
    

    // Crop nameplate at yr = 0.82, hr = 0.18
    const cW = cardCanvas.width, cH = cardCanvas.height;
    const cropX = Math.round(cW * 0.05);
    const cropY = Math.round(cH * 0.82);
    const cropW = Math.round(cW * 0.90);
    const cropH = Math.round(cH * 0.18);
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
    const v = matcher.sobelBinarize(gray, 64, 16);

    // Filter candidates by Cost
    const candidates = cardsDb.filter(c => c.cost === trueCost);

    const scored = candidates.map(card => {
        const tmpl = edges[card.cardDefId];
        if (!tmpl) return { card, score: -1 };
        let minDist = 1024, maxDice = 0;
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -8; dx <= 8; dx++) {
                const s = matcher.shift2D(v, dx, dy);
                let d = 0, inter = 0, n1 = 0, n2 = 0;
                for (let k = 0; k < 1024; k++) {
                    const b1 = s[k] === '1';
                    const b2 = tmpl[k] === '1';
                    if (b1 !== b2) d++;
                    if (b1 && b2) inter++;
                    if (b1) n1++;
                    if (b2) n2++;
                }
                if (d < minDist) minDist = d;
                const dice = (2 * inter) / (n1 + n2);
                if (dice > maxDice) maxDice = dice;
            }
        }

        // Power bonus if power detected
        let pwrBonus = 1.0;
        if (powerRes.power !== null) {
            if (card.power === powerRes.power) pwrBonus = 1.25;
            else if (Math.abs(card.power - powerRes.power) === 1) pwrBonus = 1.0;
            else pwrBonus = 0.75;
        }

        const score = maxDice * pwrBonus;
        return { card, score, maxDice, minDist };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const isMatch = top.card.cardDefId.toLowerCase() === exp.toLowerCase();
    if (isMatch) totalMatches++;

    console.log(`Slot ${(i+1)}: Top=${top.card.cardDefId.padEnd(22)} Exp=${exp.padEnd(22)} ` +
        `cost=${trueCost} pwrDet=${powerRes.power} (cardPwr=${top.card.power}) => ${isMatch ? '✓ MATCH' : '✗ FAIL'}`);
}

console.log('\nTotal Accuracy: ' + totalMatches + ' / 12 (' + Math.round((totalMatches / 12) * 100) + '%)');
