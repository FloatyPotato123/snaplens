const fs = require('fs');

function findBlueBadges(bmpPath) {
    const bmp = fs.readFileSync(bmpPath);
    const W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22));
    const bpp = bmp.readUInt16LE(28);
    const rowSize = Math.floor((bpp * W + 31) / 32) * 4;
    const bytesPerPix = bpp / 8;
    const offset = bmp.readUInt32LE(10);

    // Binarize blue badge pixels
    const blueMap = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const idx = offset + y * rowSize + x * bytesPerPix;
            const b = bmp[idx], g = bmp[idx+1], r = bmp[idx+2];
            // Blue circle badge has strong blue saturation
            if (b > 150 && (b - r) > 60 && (b - g) > 40) {
                blueMap[y * W + x] = 1;
            }
        }
    }

    // Connected components / Blob detection
    const visited = new Uint8Array(W * H);
    const blobs = [];
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (blueMap[y * W + x] === 1 && !visited[y * W + x]) {
                let count = 0;
                let sumX = 0, sumY = 0;
                let minBx = x, maxBx = x, minBy = y, maxBy = y;
                const queue = [x, y];
                visited[y * W + x] = 1;
                let qHead = 0;

                while (qHead < queue.length) {
                    const cx = queue[qHead++];
                    const cy = queue[qHead++];
                    count++;
                    sumX += cx;
                    sumY += cy;
                    if (cx < minBx) minBx = cx;
                    if (cx > maxBx) maxBx = cx;
                    if (cy < minBy) minBy = cy;
                    if (cy > maxBy) maxBy = cy;

                    const neighbors = [
                        [cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]
                    ];
                    for (const [nx, ny] of neighbors) {
                        if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                            const nIdx = ny * W + nx;
                            if (blueMap[nIdx] === 1 && !visited[nIdx]) {
                                visited[nIdx] = 1;
                                queue.push(nx, ny);
                            }
                        }
                    }
                }

                const bw = maxBx - minBx + 1;
                const bh = maxBy - minBy + 1;
                // Badge is roughly circular/square (aspect ratio between 0.6 and 1.6)
                // and has sufficient area (at least 50 pixels)
                if (count > 40 && bw >= 8 && bh >= 8 && (bw / bh) > 0.5 && (bw / bh) < 2.0) {
                    blobs.push({
                        cx: Math.round(sumX / count),
                        cy: Math.round(sumY / count),
                        count,
                        bw, bh,
                        minBx, maxBx, minBy, maxBy
                    });
                }
            }
        }
    }

    return { W, H, blobs };
}

console.log('Sample 1:');
const s1 = findBlueBadges('/tmp/sample1_test.bmp');
console.log('Found', s1.blobs.length, 'blue badge blobs:');
s1.blobs.sort((a, b) => a.cy - b.cy).forEach(b => console.log(`  at (${b.cx}, ${b.cy}) size ${b.bw}x${b.bh} count=${b.count}`));

console.log('\nSample 2:');
const s2 = findBlueBadges('/tmp/sample2_test.bmp');
console.log('Found', s2.blobs.length, 'blue badge blobs:');
s2.blobs.sort((a, b) => a.cy - b.cy).forEach(b => console.log(`  at (${b.cx}, ${b.cy}) size ${b.bw}x${b.bh} count=${b.count}`));

console.log('\nSample 4:');
const s4 = findBlueBadges('/tmp/sample4_test.bmp');
console.log('Found', s4.blobs.length, 'blue badge blobs:');
s4.blobs.sort((a, b) => a.cy - b.cy).forEach(b => console.log(`  at (${b.cx}, ${b.cy}) size ${b.bw}x${b.bh} count=${b.count}`));
