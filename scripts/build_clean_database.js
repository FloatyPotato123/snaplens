const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dbPath = path.join(__dirname, '../data/cards_database.json');
const logosPath = path.join(__dirname, '../data/cards_logos.json');

const cards = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const tmpDir = path.join('/tmp', 'snap_art_batch_' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

console.log(`Starting batch download and logo signal extraction for ${cards.length} cards...`);

function downloadCard(defId) {
    return new Promise((resolve) => {
        const webpPath = path.join(tmpDir, `${defId}.webp`);
        const url = `https://static.marvelsnap.pro/cards/${defId}.webp`;
        
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return resolve({ defId, success: false, status: res.statusCode });
            }
            const file = fs.createWriteStream(webpPath);
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve({ defId, success: true, webpPath });
            });
        });

        req.on('error', (err) => resolve({ defId, success: false, error: err.message }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ defId, success: false, error: 'timeout' });
        });
    });
}

function processCardImage(webpPath) {
    const bmpPath = webpPath.replace('.webp', '.bmp');
    try {
        execSync(`sips -s format bmp "${webpPath}" --out "${bmpPath}" 2>/dev/null`);
        const bmp = fs.readFileSync(bmpPath);
        fs.unlinkSync(bmpPath); // delete BMP immediately to save disk

        const offset = bmp.readUInt32LE(10);
        const W = bmp.readInt32LE(18);
        const H = Math.abs(bmp.readInt32LE(22));
        const bpp = bmp.readUInt16LE(28);
        const bytesPerPixel = bpp / 8;
        const rowStride = Math.floor((bpp * W + 31) / 32) * 4;

        // Exact nameplate logo region inside card frame (x: 150..870, y: 20..1000):
        const cardW = 720, cardH = 980;
        const cropX = Math.round(150 + 0.06 * cardW);
        const cropY = Math.round(20 + 0.86 * cardH);
        const cropW = Math.round(0.88 * cardW);
        const cropH = Math.round(0.11 * cardH);

        const gray = new Float32Array(64 * 16);
        let rSum = 0, gSum = 0, bSum = 0, satCount = 0;

        for (let dy = 0; dy < 16; dy++) {
            for (let dx = 0; dx < 64; dx++) {
                const sx = cropX + Math.min(cropW - 1, Math.floor((dx / 64) * cropW));
                const sy = cropY + Math.min(cropH - 1, Math.floor((dy / 16) * cropH));
                const idx = offset + sy * rowStride + sx * bytesPerPixel;
                let b = bmp[idx], g = bmp[idx + 1], r = bmp[idx + 2];
                const a = bytesPerPixel === 4 ? bmp[idx + 3] : 255;

                if (a < 40) { r = 0; g = 0; b = 0; }
                gray[dy * 64 + dx] = 0.299 * r + 0.587 * g + 0.114 * b;

                const diff = Math.max(r, g, b) - Math.min(r, g, b);
                if (a > 40 && diff > 35) {
                    rSum += r; gSum += g; bSum += b; satCount++;
                }
            }
        }

        // 2D Sobel Filter
        const edges = new Float32Array(64 * 16);
        let maxMag = 0;
        for (let y = 1; y < 15; y++) {
            for (let x = 1; x < 63; x++) {
                const tl = gray[(y - 1) * 64 + (x - 1)], tc = gray[(y - 1) * 64 + x], tr = gray[(y - 1) * 64 + (x + 1)];
                const ml = gray[y * 64 + (x - 1)], mr = gray[y * 64 + (x + 1)];
                const bl = gray[(y + 1) * 64 + (x - 1)], bc = gray[(y + 1) * 64 + x], br = gray[(y + 1) * 64 + (x + 1)];

                const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
                const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
                const mag = Math.sqrt(gx * gx + gy * gy);
                edges[y * 64 + x] = mag;
                if (mag > maxMag) maxMag = mag;
            }
        }

        const threshold = Math.max(30, maxMag * 0.25);
        let edgeString = '';
        for (let i = 0; i < 64 * 16; i++) {
            edgeString += edges[i] > threshold ? '1' : '0';
        }

        const avgColor = satCount > 10 ? [rSum / satCount, gSum / satCount, bSum / satCount] : [128, 128, 128];
        const tot = avgColor[0] + avgColor[1] + avgColor[2] + 1e-5;
        const chrom = [Math.round((avgColor[0] / tot) * 1000) / 1000, Math.round((avgColor[1] / tot) * 1000) / 1000, Math.round((avgColor[2] / tot) * 1000) / 1000];

        return { edges: edgeString, chrom, satCount };
    } catch (e) {
        if (fs.existsSync(bmpPath)) fs.unlinkSync(bmpPath);
        return null;
    }
}

async function runBatch() {
    const CONCURRENCY = 15;
    let index = 0;
    const results = {};
    let successCount = 0;
    let failCount = 0;

    async function worker() {
        while (index < cards.length) {
            const card = cards[index++];
            const defId = card.cardDefId;
            const res = await downloadCard(defId);
            if (res.success) {
                const signalObj = processCardImage(res.webpPath);
                if (signalObj) {
                    results[defId] = signalObj;
                    successCount++;
                } else {
                    failCount++;
                }
                try { fs.unlinkSync(res.webpPath); } catch (_) {}
            } else {
                failCount++;
            }

            if ((successCount + failCount) % 100 === 0 || (successCount + failCount) === cards.length) {
                console.log(`Progress: ${successCount + failCount}/${cards.length} (Success: ${successCount}, Failed: ${failCount})`);
            }
        }
    }

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    console.log(`\nBatch complete: ${successCount} succeeded, ${failCount} failed.`);

    fs.writeFileSync(logosPath, JSON.stringify(results, null, 2));
    console.log(`Updated ${logosPath} (total: ${Object.keys(results).length} cards)`);

    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log(`Cleaned up temporary directory: ${tmpDir}`);
    } catch (_) {}
}

runBatch().catch(console.error);
