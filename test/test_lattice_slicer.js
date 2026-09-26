const fs = require('fs');

function loadBmp(filePath) {
    const buf = fs.readFileSync(filePath);
    const W = buf.readInt32LE(18);
    const rawH = buf.readInt32LE(22);
    const H = Math.abs(rawH);
    const isTopDown = rawH < 0;
    const bpp = buf.readUInt16LE(28);
    const rowSize = Math.floor((bpp * W + 31) / 32) * 4;
    const offset = buf.readUInt32LE(10);
    const bytesPerPix = bpp / 8;
    return {
        W, H,
        getPixel: (x, y) => {
            if (x < 0 || x >= W || y < 0 || y >= H) return [0, 0, 0, 0];
            const fileY = isTopDown ? y : (H - 1 - y);
            const idx = offset + fileY * rowSize + x * bytesPerPix;
            return [buf[idx+2], buf[idx+1], buf[idx], bytesPerPix === 4 ? buf[idx+3] : 255];
        }
    };
}

function detectBadgeGrid(img) {
    const W = img.W, H = img.H;
    const blueBlobs = [];
    const visited = new Uint8Array(W * H);
    for (let y = 15; y < H - 30; y += 2) {
        for (let x = 10; x < W - 10; x += 2) {
            const [r, g, b] = img.getPixel(x, y);
            if (b > 150 && (b - r) > 55 && (b - g) > 35 && !visited[y * W + x]) {
                let count = 0, sumX = 0, sumY = 0;
                let minX = x, maxX = x, minY = y, maxY = y;
                const queue = [x, y];
                visited[y * W + x] = 1;
                let qHead = 0;
                while (qHead < queue.length) {
                    const cx = queue[qHead++], cy = queue[qHead++];
                    count++; sumX += cx; sumY += cy;
                    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
                    const neighbors = [[cx+2, cy], [cx-2, cy], [cx, cy+2], [cx, cy-2]];
                    for (const [nx, ny] of neighbors) {
                        if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                            const nIdx = ny * W + nx;
                            if (!visited[nIdx]) {
                                visited[nIdx] = 1;
                                const [nr, ng, nb] = img.getPixel(nx, ny);
                                if (nb > 140 && (nb - nr) > 45 && (nb - ng) > 30) queue.push(nx, ny);
                            }
                        }
                    }
                }
                const bw = maxX - minX + 1, bh = maxY - minY + 1;
                if (count >= 20 && bw >= 10 && bh >= 10 && (bw/bh) > 0.4 && (bw/bh) < 2.2) {
                    blueBlobs.push({ cx: Math.round(sumX / count), cy: Math.round(sumY / count), bw, bh, count });
                }
            }
        }
    }
    return blueBlobs;
}

function sliceCardsFromLattice(img) {
    const W = img.W, H = img.H;
    const blobs = detectBadgeGrid(img);
    const binSize = 8;
    const bins = new Int32Array(Math.ceil(H / binSize));
    blobs.forEach(b => {
        const bin = Math.floor(b.cy / binSize);
        if (bin >= 0 && bin < bins.length) bins[bin] += b.count;
    });

    let p1 = -1, p2 = -1, max1 = 0, max2 = 0;
    for (let i = 0; i < bins.length; i++) {
        if (bins[i] > max1) { max1 = bins[i]; p1 = i; }
    }
    const minSepBins = Math.floor((0.20 * H) / binSize);
    for (let i = 0; i < bins.length; i++) {
        if (Math.abs(i - p1) >= minSepBins && bins[i] > max2) { max2 = bins[i]; p2 = i; }
    }

    const y1 = (Math.min(p1, p2) + 0.5) * binSize;
    const y2 = (Math.max(p1, p2) + 0.5) * binSize;
    const rowPitch = y2 - y1;

    const row1Blobs = blobs.filter(b => Math.abs(b.cy - y1) <= 15).sort((a,b) => a.cx - b.cx);
    const row2Blobs = blobs.filter(b => Math.abs(b.cy - y2) <= 15).sort((a,b) => a.cx - b.cx);

    const pitches = [];
    [row1Blobs, row2Blobs].forEach(row => {
        for (let i = 1; i < row.length; i++) {
            const dx = row[i].cx - row[i-1].cx;
            if (dx > W / 8 && dx < W / 4) pitches.push(dx);
        }
    });
    pitches.sort((a, b) => a - b);
    const colPitch = pitches[Math.floor(pitches.length / 2)] || (W / 6);
    const minX = Math.min(...row1Blobs.map(b => b.cx), ...row2Blobs.map(b => b.cx));

    const cardBoxes = [];
    for (let r = 0; r < 2; r++) {
        const badgeY = r === 0 ? y1 : y2;
        const cardY = Math.max(0, Math.round(badgeY - 0.16 * rowPitch));
        const cardH = Math.round(rowPitch * 0.98);

        for (let c = 0; c < 6; c++) {
            const badgeX = Math.round(minX + c * colPitch);
            const cardX = Math.max(0, Math.round(badgeX - 0.25 * colPitch));
            const cardW = Math.round(colPitch * 0.96);

            cardBoxes.push({
                slot: r * 6 + c + 1,
                x: cardX, y: cardY, w: cardW, h: cardH
            });
        }
    }

    return { rowPitch, colPitch, cardBoxes };
}

console.log('Testing Slicer on Sample 1 (PC):');
const s1 = loadBmp('/tmp/sample1_test.bmp');
const res1 = sliceCardsFromLattice(s1);
console.log(`Pitch: ${res1.colPitch.toFixed(1)} x ${res1.rowPitch.toFixed(1)}`);
res1.cardBoxes.slice(0, 3).forEach(b => console.log(` Slot ${b.slot}: at (${b.x}, ${b.y}) ${b.w}x${b.h}`));

console.log('\nTesting Slicer on Sample 2 (Mobile Foil):');
const s2 = loadBmp('/tmp/sample2_test.bmp');
const res2 = sliceCardsFromLattice(s2);
console.log(`Pitch: ${res2.colPitch.toFixed(1)} x ${res2.rowPitch.toFixed(1)}`);
res2.cardBoxes.slice(0, 3).forEach(b => console.log(` Slot ${b.slot}: at (${b.x}, ${b.y}) ${b.w}x${b.h}`));
