const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

global.HTMLCanvasElement = class HTMLCanvasElement {};

function createMockCanvas(width, height) {
    const canvas = new global.HTMLCanvasElement();
    canvas.width = width;
    canvas.height = height;
    const data = new Uint8ClampedArray(width * height * 4);
    canvas.data = data;

    canvas.getContext = () => ({
        imageSmoothingEnabled: true,
        fillStyle: '#000000',
        fillRect: () => {},
        fillText: () => {},
        measureText: () => ({ width: 10 }),
        putImageData: (imgData, dx, dy) => {
            for (let i = 0; i < imgData.data.length; i++) {
                data[i] = imgData.data[i];
            }
        },
        drawImage: (src, sx, sy, sw, sh, dx, dy, dw, dh) => {
            if (dx === undefined) {
                dx = sx; dy = sy; dw = width; dh = height;
                sx = 0; sy = 0; sw = src.width; sh = src.height;
            }
            for (let y = 0; y < dh; y++) {
                for (let x = 0; x < dw; x++) {
                    const srcX = Math.min(src.width - 1, Math.max(0, Math.floor(sx + (x / dw) * sw)));
                    const srcY = Math.min(src.height - 1, Math.max(0, Math.floor(sy + (y / dh) * sh)));
                    const srcIdx = (srcY * src.width + srcX) * 4;
                    const dstIdx = ((dy + y) * width + (dx + x)) * 4;
                    data[dstIdx] = src.data[srcIdx];
                    data[dstIdx + 1] = src.data[srcIdx + 1];
                    data[dstIdx + 2] = src.data[srcIdx + 2];
                    data[dstIdx + 3] = src.data[srcIdx + 3];
                }
            }
        },
        getImageData: (x, y, w, h) => {
            const sub = new Uint8ClampedArray(w * h * 4);
            for (let py = 0; py < h; py++) {
                for (let px = 0; px < w; px++) {
                    const sIdx = ((y + py) * width + (x + px)) * 4;
                    const dIdx = (py * w + px) * 4;
                    sub[dIdx] = data[sIdx];
                    sub[dIdx + 1] = data[sIdx + 1];
                    sub[dIdx + 2] = data[sIdx + 2];
                    sub[dIdx + 3] = data[sIdx + 3];
                }
            }
            return { data: sub, width: w, height: h };
        }
    });

    return canvas;
}

global.document = {
    createElement: (tag) => {
        if (tag === 'canvas') return createMockCanvas(200, 300);
        return {};
    }
};

// Load modules with globals configured
const { LayoutDetector } = require('../src/layout_detector.js');
const { DeckEncoder } = require('../src/deck_encoder.js');
const { StatPruner } = require('../src/stat_pruner.js');
const { LogoMatcher } = require('../src/logo_matcher.js');

global.LayoutDetector = LayoutDetector;
global.DeckEncoder = DeckEncoder;
global.StatPruner = StatPruner;
global.LogoMatcher = LogoMatcher;

const { DeckScanner } = require('../src/deck_scanner.js');

const cardsDb = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards_database.json'), 'utf8'));
const cardsLogos = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards_logos.json'), 'utf8'));

// Convert sample1 to raw BMP
execSync("sips -s format bmp test/samples/sample1_pc_6x2.jpg --out /tmp/sample1_test.bmp 2>/dev/null");
const bmp = fs.readFileSync("/tmp/sample1_test.bmp");
const offset = bmp.readUInt32LE(10);
const W = bmp.readInt32LE(18);
const H = Math.abs(bmp.readInt32LE(22));
const rowSize = Math.floor((24 * W + 31) / 32) * 4;

const sourceCanvas = createMockCanvas(W, H);
for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
        const bmpIdx = offset + y * rowSize + x * 3;
        const rgbaIdx = (y * W + x) * 4;
        sourceCanvas.data[rgbaIdx] = bmp[bmpIdx + 2];     // R
        sourceCanvas.data[rgbaIdx + 1] = bmp[bmpIdx + 1]; // G
        sourceCanvas.data[rgbaIdx + 2] = bmp[bmpIdx];     // B
        sourceCanvas.data[rgbaIdx + 3] = 255;             // A
    }
}

async function test() {
    console.log("======================================================================");
    console.log("    RUNNING EXACT BROWSER MATCHING LOGIC IN NODE (UNASSISTED SCAN)    ");
    console.log("======================================================================\n");

    const scanner = new DeckScanner(cardsDb, cardsLogos);
    const result = await scanner.scanDeck(sourceCanvas);

    console.log(`Detected Layout: ${result.layout} | Confidence: ${Math.round(result.confidence * 100)}%`);
    console.log(`Generated Deck Code: ${result.deckCode}\n`);

    const expected = ['MajesticWingbeat', 'KittyPryde', 'Agony', 'SpiderManBrandNewDay', 'GrandMaster', 'ScarletWitch', 'Magik', 'HopeSummers', 'Psylocke', 'MotherAskani', 'SuperiorIronMan', 'ShouLao'];

    console.log("----------------------------------------------------------------------------------");
    console.log("Slot | Cost/Pwr | Detected Card Name      | Detected DefId      | Match Status");
    console.log("----------------------------------------------------------------------------------");
    
    let matchCount = 0;
    result.cards.forEach((slot, i) => {
        const c = slot.selectedCard;
        const name = c ? c.name : 'Unknown';
        const defId = c ? c.cardDefId : 'Unknown';
        const cost = slot.detectedCost;
        const pwr = slot.detectedPower ?? '?';
        const expDefId = expected[i];
        const isMatch = defId.toLowerCase() === expDefId.toLowerCase();
        if (isMatch) matchCount++;

        console.log(` #${(i+1).toString().padStart(2, ' ')} |   ${cost}/${pwr.toString().padEnd(2, ' ')}   | ${name.padEnd(23, ' ')} | ${defId.padEnd(19, ' ')} | ${isMatch ? '✓ EXACT MATCH' : '✗ ' + expDefId}`);
    });

    console.log("----------------------------------------------------------------------------------");
    console.log(`🎯 Exact Accuracy: ${matchCount}/12 (${Math.round((matchCount / 12) * 100)}%)\n`);
}

test().catch(console.error);
