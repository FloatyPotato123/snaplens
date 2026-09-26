/**
 * Marvel Snap Adaptive OCR & Token String Matcher
 * 
 * Uses Tesseract.js WASM with:
 * - Multi-line block segmentation (PSM 6) for stacked comic titles
 * - Integral-image adaptive local thresholding (robust against foil/dark art)
 * - Token-sort Levenshtein & Bigram fuzzy matching against all cards in database
 */

class OcrMatcher {
    constructor(cardsDatabase) {
        this.cardsDatabase = cardsDatabase || [];
        this.worker = null;
        this.isReady = false;
        this.initPromise = this.initWorker();
    }

    async initWorker() {
        if (typeof Tesseract === 'undefined') {
            console.warn('Tesseract.js not loaded.');
            return;
        }
        try {
            this.worker = await Tesseract.createWorker('eng');
            await this.worker.setParameters({
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -.',
                // PSM 6 = Assume a single uniform block of text (handles 1-line and 2-line stacked titles)
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK
            });
            this.isReady = true;
            console.log('✅ Tesseract WASM Multi-Line OCR Engine Ready');
        } catch (e) {
            console.error('Failed to initialize Tesseract worker:', e);
        }
    }

    /**
     * Preprocesses logo banner with integral-image adaptive local binarization
     */
    preprocessLogo(cardCanvas) {
        const W = cardCanvas.width;
        const H = cardCanvas.height;

        // Bottom nameplate region (y: 75% to 97%, x: 3% to 97%)
        const logoY = Math.round(H * 0.75);
        const logoH = Math.round(H * 0.22);
        const logoX = Math.round(W * 0.03);
        const logoW = Math.round(W * 0.94);

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = logoW * 2;
        cropCanvas.height = logoH * 2;
        const ctx = cropCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw card logo strip scaled 2x
        ctx.drawImage(cardCanvas, logoX, logoY, logoW, logoH, 0, 0, cropCanvas.width, cropCanvas.height);

        const cW = cropCanvas.width;
        const cH = cropCanvas.height;
        const imgData = ctx.getImageData(0, 0, cW, cH);
        const data = imgData.data;
        const N = cW * cH;

        // Grayscale luminance
        const gray = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            const idx = i * 4;
            gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        }

        // Compute 2D Integral Image for fast local mean calculation
        const integral = new Float64Array((cW + 1) * (cH + 1));
        const stride = cW + 1;

        for (let y = 0; y < cH; y++) {
            let rowSum = 0;
            for (let x = 0; x < cW; x++) {
                rowSum += gray[y * cW + x];
                integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + rowSum;
            }
        }

        // Adaptive threshold with window radius R = 12
        const R = Math.max(6, Math.round(cW * 0.04));
        const k = 0.08; // Sauvola sensitivity factor

        let whiteCount = 0;
        for (let y = 0; y < cH; y++) {
            const y0 = Math.max(0, y - R);
            const y1 = Math.min(cH, y + R + 1);

            for (let x = 0; x < cW; x++) {
                const x0 = Math.max(0, x - R);
                const x1 = Math.min(cW, x + R + 1);
                const area = (y1 - y0) * (x1 - x0);

                const sum = integral[y1 * stride + x1]
                          - integral[y0 * stride + x1]
                          - integral[y1 * stride + x0]
                          + integral[y0 * stride + x0];
                const localMean = sum / area;

                const val = gray[y * cW + x];
                // Text stroke is darker than local comic outline or brighter than dark background
                const isBrightText = val > localMean * (1 + k);

                const out = isBrightText ? 0 : 255; // 0 = black text, 255 = white background
                if (out === 255) whiteCount++;

                const idx = (y * cW + x) * 4;
                data[idx] = out;
                data[idx + 1] = out;
                data[idx + 2] = out;
            }
        }

        // Invert if background ended up dark instead of white (Tesseract prefers dark text on white)
        if (whiteCount < N * 0.4) {
            for (let i = 0; i < N * 4; i += 4) {
                data[i] = 255 - data[i];
                data[i + 1] = 255 - data[i + 1];
                data[i + 2] = 255 - data[i + 2];
            }
        }

        ctx.putImageData(imgData, 0, 0);
        return cropCanvas;
    }

    /**
     * Recognizes card nameplate and fuzzy matches against cards database
     */
    async recognizeCard(cardCanvas) {
        await this.initPromise;
        const logoCanvas = this.preprocessLogo(cardCanvas);

        let detectedText = "";
        if (this.isReady && this.worker) {
            try {
                const ret = await this.worker.recognize(logoCanvas);
                detectedText = (ret.data.text || "").trim();
            } catch (err) {
                console.warn('OCR error on card:', err);
            }
        }

        // Normalize recognized text
        const cleanOcr = detectedText.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        const ocrTokens = cleanOcr.split(' ').filter(t => t.length > 0);

        if (cleanOcr.length < 2) {
            return { card: null, detectedText, confidence: 0, rankedCandidates: [], logoCanvas };
        }

        const candidates = [];

        for (const card of this.cardsDatabase) {
            const rawName = card.name || card.cardDefId;
            const cleanName = rawName.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
            const cleanDefId = card.cardDefId.toLowerCase();

            // 1. Levenshtein ratio on full strings
            const fullLeven = this.levenshteinSimilarity(cleanOcr.replace(/\s/g, ''), cleanName.replace(/\s/g, ''));

            // 2. Token-set overlap
            const nameTokens = cleanName.split(' ');
            let tokenMatches = 0;
            for (const ot of ocrTokens) {
                if (ot.length < 2) continue;
                for (const nt of nameTokens) {
                    if (nt.includes(ot) || ot.includes(nt) || this.levenshteinSimilarity(ot, nt) > 0.65) {
                        tokenMatches++;
                        break;
                    }
                }
            }
            const tokenScore = ocrTokens.length > 0 ? tokenMatches / Math.max(ocrTokens.length, nameTokens.length) : 0;

            // 3. DefId exact/sub-match
            const defIdLeven = this.levenshteinSimilarity(cleanOcr.replace(/\s/g, ''), cleanDefId);

            // Combined fuzzy score
            const score = Math.max(fullLeven, tokenScore * 0.9, defIdLeven * 0.95);

            if (score > 0.30) {
                candidates.push({ card, score: Math.min(1.0, score) });
            }
        }

        candidates.sort((a, b) => b.score - a.score);

        const best = candidates.length > 0 ? candidates[0] : null;

        return {
            card: best ? best.card : null,
            detectedText,
            confidence: best ? Math.round(best.score * 100) / 100 : 0,
            rankedCandidates: candidates.slice(0, 10),
            logoCanvas
        };
    }

    levenshteinSimilarity(s1, s2) {
        if (!s1 || !s2) return 0;
        if (s1 === s2) return 1.0;
        const maxLen = Math.max(s1.length, s2.length);
        if (maxLen === 0) return 1.0;

        const d = [];
        for (let i = 0; i <= s1.length; i++) {
            d[i] = [i];
        }
        for (let j = 0; j <= s2.length; j++) {
            d[0][j] = j;
        }

        for (let i = 1; i <= s1.length; i++) {
            for (let j = 1; j <= s2.length; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                d[i][j] = Math.min(
                    d[i - 1][j] + 1,
                    d[i][j - 1] + 1,
                    d[i - 1][j - 1] + cost
                );
            }
        }

        const dist = d[s1.length][s2.length];
        return Math.max(0, (maxLen - dist) / maxLen);
    }
}

if (typeof module !== 'undefined') {
    module.exports = { OcrMatcher };
}
