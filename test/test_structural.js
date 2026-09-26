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

function extractDigitGrid(slotX, slotY) {
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

    const grid = [];
    for (let y = 0; y < 12; y++) grid[y] = new Uint8Array(8);
    for (const pt of points) {
        const nx = Math.min(7, Math.max(0, Math.floor(((pt.x - minX) / bw) * 8)));
        const ny = Math.min(11, Math.max(0, Math.floor(((pt.y - minY) / bh) * 12)));
        grid[ny][nx] = 1;
    }
    return { grid, bw, bh, aspect: bw / bh };
}

function classifyStructural(dObj) {
    if (!dObj) return null;
    const { grid, bw, bh, aspect } = dObj;

    if (aspect < 0.58 || bw <= 8) return 1;

    let tl = 0, tr = 0, ml = 0, mr = 0, bl = 0, br = 0;
    for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 8; x++) {
            if (grid[y][x]) {
                if (y < 4) { if (x < 4) tl++; else tr++; }
                else if (y < 8) { if (x < 4) ml++; else mr++; }
                else { if (x < 4) bl++; else br++; }
            }
        }
    }

    let bottomRowSolid = (grid[10][1] + grid[10][2] + grid[10][3] + grid[10][4] + grid[10][5] + grid[10][6]) >= 4;
    let crossbar4 = (grid[6][0] + grid[6][1] + grid[6][2] + grid[6][3] + grid[6][4] + grid[6][5]) >= 4;

    if (crossbar4 && tl >= 2 && bl < 3) return 4;
    if (bottomRowSolid && ml < 2) return 2;
    if (tl < 3 && bl < 3 && mr >= 2) return 3;
    if (tl >= 2 && ml >= 2 && br >= 2 && bl < 3) return 5;

    if (bottomRowSolid) return 2;
    if (mr > ml && tr >= tl) return 3;
    if (tl > tr) return 5;

    return 1;
}

const expectedCosts = [1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5];
console.log("Testing Structural Rule Classifier on Sample 1:");
for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const dObj = extractDigitGrid(c * cardW, r * cardH);
        const det = classifyStructural(dObj);
        const exp = expectedCosts[idx];
        const ok = det === exp;
        console.log(`Slot #${(idx+1).toString().padStart(2, ' ')}: Expected=${exp} | Detected=${det} | ${ok ? '✓ MATCH' : 'MISMATCH'}`);
    }
}
