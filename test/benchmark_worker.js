const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { LayoutDetector } = require('../src/layout_detector.js');
const { LogoMatcher } = require('../src/logo_matcher.js');

// Load templates once per worker
const rawTemplates = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards_templates.json'), 'utf8'));
const NON_COLLECTIBLE_TOKENS = new Set([
  'vibranium', 'Rock', 'Ninja', 'Demon', 'DoomBot', 'DoomBot2099', 'Drone',
  'EbonyBlade', 'AcidArrow', 'BasicArrow', 'GrappleArrow', 'PymParticleArrow',
  'Mjolnir', 'Stormbreaker', 'MuramasaShard', 'SinisterClone', 'TheVoid',
  'TigerSpirit', 'WidowsBite', 'WidowsKiss', 'WinterSoldier', 'Pig', 'Ice', 'IceCube',
  'MindStone', 'PowerStone', 'RealityStone', 'SoulStone', 'SpaceStone', 'TimeStone',
  'Raptor', 'Monster', 'Chimichanga', 'CapsShield', 'Spell01Agamotto', 'Spell02Agamotto',
  'Spell03Agamotto', 'Spell04Agamotto', 'Spell05Agamotto', 'TenRings', 'TheTenRings'
]);
const templates = {};
for (const [id, tpl] of Object.entries(rawTemplates)) {
    if (!NON_COLLECTIBLE_TOKENS.has(id)) {
        templates[id] = tpl;
    }
}
const matcher = new LogoMatcher(templates);

function loadRgba(imgPath) {
    const tmpDir = path.join(__dirname, 'temp_bmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpBmp = path.join(tmpDir, `snap_bench_${path.basename(imgPath)}_${process.pid}.bmp`);
    execSync(`sips -s format bmp "${imgPath}" --out "${tmpBmp}" 2>/dev/null`);
    const buf = fs.readFileSync(tmpBmp);
    try { fs.unlinkSync(tmpBmp); } catch (_) {}

    const offset = buf.readUInt32LE(10);
    const W = buf.readInt32LE(18);
    const rawH = buf.readInt32LE(22);
    const H = Math.abs(rawH);
    const bitCount = buf.readUInt16LE(28);
    const bpp = Math.floor(bitCount / 8);
    const rowSize = Math.floor((bitCount * W + 31) / 32) * 4;

    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        const srcY = rawH > 0 ? (H - 1 - y) : y;
        for (let x = 0; x < W; x++) {
            const idx = offset + srcY * rowSize + x * bpp;
            const dIdx = (y * W + x) * 4;
            data[dIdx] = buf[idx + 2];     // R
            data[dIdx + 1] = buf[idx + 1]; // G
            data[dIdx + 2] = buf[idx];     // B
            data[dIdx + 3] = 255;
        }
    }
    return { width: W, height: H, data };
}

function makeCardCanvas(sourceCanvas, bounds) {
    const cardData = new Uint8ClampedArray(240 * 336 * 4);
    const W = sourceCanvas.width, H = sourceCanvas.height, sData = sourceCanvas.data;
    const scaleX = bounds.width / 240;
    const scaleY = bounds.height / 336;
    for (let cy = 0; cy < 336; cy++) {
        const srcY = bounds.y + (cy / 336) * bounds.height;
        const y0 = Math.max(0, Math.min(H - 1, Math.floor(srcY)));
        const y1 = Math.max(0, Math.min(H - 1, y0 + 1));
        const wy = Math.max(0, Math.min(1, srcY - y0));
        const wy0 = 1 - wy;

        for (let cx = 0; cx < 240; cx++) {
            const srcX = bounds.x + (cx / 240) * bounds.width;
            const x0 = Math.max(0, Math.min(W - 1, Math.floor(srcX)));
            const x1 = Math.max(0, Math.min(W - 1, x0 + 1));
            const wx = Math.max(0, Math.min(1, srcX - x0));
            const wx0 = 1 - wx;

            const i00 = (y0 * W + x0) * 4;
            const i01 = (y0 * W + x1) * 4;
            const i10 = (y1 * W + x0) * 4;
            const i11 = (y1 * W + x1) * 4;

            const dIdx = (cy * 240 + cx) * 4;
            for (let c = 0; c < 3; c++) {
                const val = (sData[i00 + c] * wx0 + sData[i01 + c] * wx) * wy0 +
                            (sData[i10 + c] * wx0 + sData[i11 + c] * wx) * wy;
                cardData[dIdx + c] = Math.round(val);
            }
            cardData[dIdx + 3] = 255;
        }
    }
    return {
        width: 240, height: 336,
        getContext: () => ({
            getImageData: () => ({ data: cardData })
        })
    };
}

parentPort.on('message', (suite) => {
    const t0 = Date.now();
    try {
        const imgPath = path.join(__dirname, 'samples', suite.file);
        const img = loadRgba(imgPath);
        const slice = LayoutDetector.detectOptimalLattice(img);

        if (!slice || !slice.cards || slice.cards.length < 12) {
            parentPort.postMessage({
                id: suite.id,
                name: suite.name,
                error: 'Grid detection failed',
                correct: 0,
                total: 12,
                elapsed: Date.now() - t0,
                cards: []
            });
            return;
        }

        // 1. Score candidates for all 12 slots
        const slotPools = [];
        for (let i = 0; i < 12; i++) {
            const cardCanvas = makeCardCanvas(img, slice.cards[i].bounds);
            const ranked = matcher.matchCard(cardCanvas);
            slotPools.push(ranked.slice(0, 20));
        }

        // 2. Greedy Maximum Weight Bipartite Assignment (same as DeckScanner)
        const assigned = new Array(12).fill(null);
        const used = new Set();
        const allPairs = [];
        for (let sIdx = 0; sIdx < 12; sIdx++) {
            for (const cand of slotPools[sIdx]) {
                allPairs.push({ slotIndex: sIdx, card: cand.card, score: cand.score, rawZNCC: cand.rawZNCC });
            }
        }
        allPairs.sort((a, b) => b.score - a.score);
        const usedCount = {};
        for (const pair of allPairs) {
            const count = usedCount[pair.card.cardDefId] || 0;
            const maxAllowed = (pair.score >= 0.65 || (pair.rawZNCC && pair.rawZNCC >= 0.70)) ? 2 : 1;
            if (!assigned[pair.slotIndex] && count < maxAllowed) {
                assigned[pair.slotIndex] = pair;
                usedCount[pair.card.cardDefId] = count + 1;
            }
        }

        // 3. Compare with Ground Truth
        let correct = 0;
        const cardResults = [];
        for (let i = 0; i < 12; i++) {
            const expDefId = suite.expected[i];
            const gotDefId = assigned[i] ? assigned[i].card.cardDefId : 'None';
            const score = assigned[i] ? Math.round(assigned[i].score * 100) : 0;
            const expClean = expDefId.toLowerCase().replace(/[^a-z0-9]/g, '');
            const gotClean = gotDefId.toLowerCase().replace(/[^a-z0-9]/g, '');
            const isMatch = expClean === gotClean ||
                            (expClean.length >= 5 && gotClean.startsWith(expClean)) ||
                            (gotClean.length >= 5 && expClean.startsWith(gotClean));
            if (isMatch) correct++;
            cardResults.push({
                slot: i + 1,
                expected: expDefId,
                detected: gotDefId,
                score,
                isMatch
            });
        }

        const elapsed = Date.now() - t0;
        parentPort.postMessage({
            id: suite.id,
            name: suite.name,
            layout: slice.layout,
            correct,
            total: 12,
            pct: Math.round((correct / 12) * 100),
            elapsed,
            cards: cardResults
        });
    } catch (err) {
        parentPort.postMessage({
            id: suite.id,
            name: suite.name,
            error: err.message,
            correct: 0,
            total: 12,
            elapsed: Date.now() - t0,
            cards: []
        });
    }
});
