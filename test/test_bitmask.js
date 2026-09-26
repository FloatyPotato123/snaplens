const fs = require('fs');
const bmp = fs.readFileSync('/tmp/sample1.bmp');
const offset = bmp.readUInt32LE(10);
const W = bmp.readInt32LE(18);
const H = Math.abs(bmp.readInt32LE(22));
const rowSize = Math.floor((24 * W + 31) / 32) * 4;

function getPixel(x, y) {
    if (x < 0 || x >= W || y < 0 || y >= H) return { r:0, g:0, b:0 };
    const idx = offset + Math.floor(y) * rowSize + Math.floor(x) * 3;
    return { r: bmp[idx + 2], g: bmp[idx + 1], b: bmp[idx] };
}

const cols = 6, rows = 2;
const cardW = W / cols;
const cardH = H / rows;

const DIGIT_MASKS = {
    0: ["01111100","11000110","11000110","11000110","11000110","11000110","11000110","11000110","11000110","11000110","11000110","01111100"],
    1: ["00011000","00111000","01111000","00011000","00011000","00011000","00011000","00011000","00011000","00011000","00011000","00111100"],
    2: ["01111100","11000110","00000110","00000110","00001100","00011000","00110000","01100000","11000000","11000010","11111110","11111110"],
    3: ["01111100","11000110","00000110","00000110","00111100","00000110","00000110","00000110","00000110","11000110","11000110","01111100"],
    4: ["00001100","00011100","00111100","01101100","11001100","11001100","11111110","11111110","00001100","00001100","00001100","00001100"],
    5: ["11111110","11000000","11000000","11111100","11000110","00000110","00000110","00000110","00000110","11000110","11000110","01111100"],
    6: ["00111100","01100000","11000000","11000000","11111100","11000110","11000110","11000110","11000110","11000110","11000110","01111100"],
    7: ["11111110","11111110","00000110","00001100","00001100","00011000","00011000","00110000","00110000","01100000","01100000","01100000"],
    8: ["01111100","11000110","11000110","11000110","01111100","11000110","11000110","11000110","11000110","11000110","11000110","01111100"],
    9: ["01111100","11000110","11000110","11000110","11000110","01111110","00000110","00000110","00000110","00000110","01100110","00111100"]
};

function classifyBadge(slotX, slotY) {
    let sumX = 0, sumY = 0, count = 0;
    for (let dy = 5; dy < 50; dy++) {
        for (let dx = 5; dx < 50; dx++) {
            const p = getPixel(slotX + dx, slotY + dy);
            if (p.b > 120 && p.b > p.r + 30 && p.b > p.g + 10) {
                sumX += (slotX + dx); sumY += (slotY + dy); count++;
            }
        }
    }
    if (count < 15) return null;
    const cx = Math.round(sumX / count);
    const cy = Math.round(sumY / count);

    let minX = W, maxX = 0, minY = H, maxY = 0;
    const points = [];
    for (let dy = -13; dy <= 13; dy++) {
        for (let dx = -11; dx <= 11; dx++) {
            const p = getPixel(cx + dx, cy + dy);
            const lum = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
            const diff = Math.max(Math.abs(p.r - p.g), Math.abs(p.g - p.b), Math.abs(p.r - p.b));
            if (lum > 175 && diff < 38) {
                const px = cx + dx, py = cy + dy;
                points.push({ x: px, y: py });
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
            }
        }
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (points.length < 15 || bw < 3 || bh < 7) return null;

    if (bw / bh < 0.52 || bw <= 8) return { digit: 1, confidence: 0.95 };

    const norm = [];
    for (let y = 0; y < 12; y++) {
        norm[y] = new Uint8Array(8);
    }
    for (const pt of points) {
        const nx = Math.min(7, Math.max(0, Math.floor(((pt.x - minX) / bw) * 8)));
        const ny = Math.min(11, Math.max(0, Math.floor(((pt.y - minY) / bh) * 12)));
        norm[ny][nx] = 1;
    }

    let bestD = null, bestScore = -1;
    for (const [d, mask] of Object.entries(DIGIT_MASKS)) {
        let match = 0;
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < 8; x++) {
                const bit = mask[y][x] === "1" ? 1 : 0;
                if (norm[y][x] === bit) match++;
            }
        }
        const score = match / 96;
        if (score > bestScore) {
            bestScore = score;
            bestD = parseInt(d);
        }
    }

    return { digit: bestD, confidence: bestScore };
}

const expectedCosts = [1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5];
console.log("Testing Bitmask Classifier on Sample 1 Cost Badges:");
for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const res = classifyBadge(c * cardW, r * cardH);
        const exp = expectedCosts[idx];
        const det = res ? res.digit : -1;
        const ok = det === exp;
        console.log(`Slot #${(idx+1).toString().padStart(2, ' ')}: Expected=${exp} | Detected=${det >= 0 ? det : 'none'} (conf=${res ? res.confidence.toFixed(2) : '0.00'}) | ${ok ? 'OK' : 'MISMATCH'}`);
    }
}
