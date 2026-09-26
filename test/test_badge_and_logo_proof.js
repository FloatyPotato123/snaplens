const fs = require('fs');
const path = require('path');

// Step 1: Accurate BMP loader
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
            const b = buf[idx], g = buf[idx+1], r = buf[idx+2];
            const a = bytesPerPix === 4 ? buf[idx+3] : 255;
            return [r, g, b, a];
        }
    };
}

// Step 2: Blue Badge Grid Detector
function detectBadgeGrid(img) {
    const W = img.W, H = img.H;
    // Find saturated blue pixels
    const blueBlobs = [];
    const visited = new Uint8Array(W * H);

    for (let y = 15; y < H - 30; y += 2) {
        for (let x = 10; x < W - 10; x += 2) {
            const [r, g, b] = img.getPixel(x, y);
            if (b > 150 && (b - r) > 55 && (b - g) > 35 && !visited[y * W + x]) {
                // BFS
                let count = 0, sumX = 0, sumY = 0;
                let minX = x, maxX = x, minY = y, maxY = y;
                const queue = [x, y];
                visited[y * W + x] = 1;
                let qHead = 0;

                while (qHead < queue.length) {
                    const cx = queue[qHead++], cy = queue[qHead++];
                    count++;
                    sumX += cx; sumY += cy;
                    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;

                    const neighbors = [[cx+2, cy], [cx-2, cy], [cx, cy+2], [cx, cy-2]];
                    for (const [nx, ny] of neighbors) {
                        if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                            const nIdx = ny * W + nx;
                            if (!visited[nIdx]) {
                                visited[nIdx] = 1;
                                const [nr, ng, nb] = img.getPixel(nx, ny);
                                if (nb > 140 && (nb - nr) > 45 && (nb - ng) > 30) {
                                    queue.push(nx, ny);
                                }
                            }
                        }
                    }
                }

                const bw = maxX - minX + 1, bh = maxY - minY + 1;
                if (count >= 20 && bw >= 10 && bh >= 10 && (bw/bh) > 0.4 && (bw/bh) < 2.2) {
                    blueBlobs.push({
                        cx: Math.round(sumX / count),
                        cy: Math.round(sumY / count),
                        bw, bh, count
                    });
                }
            }
        }
    }

    return blueBlobs;
}

console.log('Testing Grid Detection on Sample 1 and Sample 2...');
const s1 = loadBmp('/tmp/sample1_test.bmp');
const b1 = detectBadgeGrid(s1);
console.log('Sample 1 detected blue badge count:', b1.length);

const s2 = loadBmp('/tmp/sample2_test.bmp');
const b2 = detectBadgeGrid(s2);
console.log('Sample 2 detected blue badge count:', b2.length);


function cluster6x2Grid(blobs, W, H) {
    // Sort by Y to find two main rows
    const sortedY = blobs.slice().sort((a, b) => a.cy - b.cy);
    
    // Find Y clusters
    // We expect two rows separated by at least 0.25 * H
    const midY = H * 0.5;
    const topRowCandidates = blobs.filter(b => b.cy < midY && b.cy > 0.04 * H);
    const bottomRowCandidates = blobs.filter(b => b.cy >= midY && b.cy < 0.90 * H);

    function getRowX(candidates) {
        // Find 6 distinct X centers separated by approx W/6
        const sortedX = candidates.slice().sort((a, b) => a.cx - b.cx);
        // Cluster by X proximity (< W / 10)
        const clusters = [];
        for (const b of sortedX) {
            const existing = clusters.find(c => Math.abs(c.cx - b.cx) < W / 10);
            if (existing) {
                if (b.count > existing.count) {
                    existing.cx = b.cx; existing.cy = b.cy; existing.count = b.count;
                }
            } else {
                clusters.push({ ...b });
            }
        }
        return clusters.sort((a, b) => a.cx - b.cx);
    }

    const row1 = getRowX(topRowCandidates);
    const row2 = getRowX(bottomRowCandidates);

    return { row1, row2 };
}

const g1 = cluster6x2Grid(b1, s1.W, s1.H);
console.log('\nSample 1 Grid:');
console.log('Row 1 (' + g1.row1.length + ' badges):', g1.row1.map(b => `(${b.cx}, ${b.cy})`).join(', '));
console.log('Row 2 (' + g1.row2.length + ' badges):', g1.row2.map(b => `(${b.cx}, ${b.cy})`).join(', '));

const g2 = cluster6x2Grid(b2, s2.W, s2.H);
console.log('\nSample 2 Grid:');
console.log('Row 1 (' + g2.row1.length + ' badges):', g2.row1.map(b => `(${b.cx}, ${b.cy})`).join(', '));
console.log('Row 2 (' + g2.row2.length + ' badges):', g2.row2.map(b => `(${b.cx}, ${b.cy})`).join(', '));

