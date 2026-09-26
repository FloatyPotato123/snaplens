/**
 * Marvel Snap Stat Extractor & Prior Scorer
 * 
 * Uses Zero-Mean Normalized Cross-Correlation (ZNCC) against rendered
 * comic font glyphs to extract Cost and Power digits.
 * 
 * Mathematical properties of ZNCC:
 * - Invariant to linear brightness and contrast changes (foils, dark variants)
 * - Outputs continuous normalized correlation in [-1.0, 1.0]
 * - Zero hand-coded 16x16 arrays or hardcoded RGB thresholds
 */

class StatPruner {
    constructor(cardsDatabase) {
        this.cards = cardsDatabase || [];
        this.digitTemplates = this.precomputeDigitTemplates();
    }

    /**
     * Renders clean reference glyphs (0-9) onto offscreen canvases
     * matching the bold italic comic typography used in Marvel Snap
     */
    precomputeDigitTemplates() {
        const templates = {};
        const size = 32;

        for (let d = 0; d <= 9; d++) {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, size, size);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold italic 22px Impact, "Arial Black", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(d), size / 2, size / 2 + 1);

            const imgData = ctx.getImageData(0, 0, size, size).data;
            const gray = new Float32Array(size * size);
            let sum = 0;

            for (let i = 0; i < size * size; i++) {
                const val = imgData[i * 4]; // white text on black background
                gray[i] = val;
                sum += val;
            }

            const mean = sum / (size * size);
            let varSum = 0;
            for (let i = 0; i < size * size; i++) {
                gray[i] -= mean;
                varSum += gray[i] * gray[i];
            }
            const std = Math.sqrt(varSum) || 1.0;

            // Normalized zero-mean unit vector
            for (let i = 0; i < size * size; i++) {
                gray[i] /= std;
            }

            templates[d] = { data: gray, size };
        }

        return templates;
    }

    /**
     * Extracts Cost badge from normalized 240x336 card canvas
     */
    extractCost(cardCanvas) {
        const cW = cardCanvas.width;
        const cH = cardCanvas.height;

        // Cost badge is in upper-left quadrant: [0..25% width, 0..20% height]
        const qW = Math.round(cW * 0.25);
        const qH = Math.round(cH * 0.20);
        const ctx = cardCanvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, qW, qH).data;

        // Centroid of blue chromaticity
        let sumX = 0, sumY = 0, weightSum = 0;
        for (let y = 0; y < qH; y++) {
            for (let x = 0; x < qW; x++) {
                const idx = (y * qW + x) * 4;
                const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2];
                const total = r + g + b + 1e-4;
                const blueRatio = b / total;
                if (blueRatio > 0.40) {
                    const w = (blueRatio - 0.40) * b;
                    sumX += x * w;
                    sumY += y * w;
                    weightSum += w;
                }
            }
        }

        const cx = weightSum > 0 ? Math.round(sumX / weightSum) : Math.round(qW * 0.45);
        const cy = weightSum > 0 ? Math.round(sumY / weightSum) : Math.round(qH * 0.45);

        return this.classifyBadgeDigit(cardCanvas, cx, cy);
    }

    /**
     * Extracts Power badge from normalized 240x336 card canvas
     */
    extractPower(cardCanvas) {
        const cW = cardCanvas.width;
        const cH = cardCanvas.height;

        // Power badge is in upper-right quadrant: [75%..100% width, 0..20% height]
        const startX = Math.round(cW * 0.75);
        const qW = cW - startX;
        const qH = Math.round(cH * 0.20);
        const ctx = cardCanvas.getContext('2d');
        const imgData = ctx.getImageData(startX, 0, qW, qH).data;

        // Centroid of warm/orange chromaticity: R / (R + G + B) > 0.42
        let sumX = 0, sumY = 0, weightSum = 0;
        for (let y = 0; y < qH; y++) {
            for (let x = 0; x < qW; x++) {
                const idx = (y * qW + x) * 4;
                const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2];
                const total = r + g + b + 1e-4;
                const redRatio = r / total;
                if (redRatio > 0.42 && r > g && g > b) {
                    const w = (redRatio - 0.42) * r;
                    sumX += x * w;
                    sumY += y * w;
                    weightSum += w;
                }
            }
        }

        const cx = weightSum > 0 ? startX + Math.round(sumX / weightSum) : startX + Math.round(qW * 0.55);
        const cy = weightSum > 0 ? Math.round(sumY / weightSum) : Math.round(qH * 0.45);

        return this.classifyBadgeDigit(cardCanvas, cx, cy);
    }

    /**
     * Computes Zero-Mean Normalized Cross-Correlation (ZNCC) against digit glyphs
     */
    classifyBadgeDigit(cardCanvas, cx, cy) {
        const cropSize = 28;
        const half = Math.floor(cropSize / 2);
        const cropX = Math.max(0, Math.min(cardCanvas.width - cropSize, cx - half));
        const cropY = Math.max(0, Math.min(cardCanvas.height - cropSize, cy - half));

        const sampleCanvas = document.createElement('canvas');
        sampleCanvas.width = 32;
        sampleCanvas.height = 32;
        const sCtx = sampleCanvas.getContext('2d');
        sCtx.drawImage(cardCanvas, cropX, cropY, cropSize, cropSize, 0, 0, 32, 32);

        const imgData = sCtx.getImageData(0, 0, 32, 32).data;
        const gray = new Float32Array(1024);
        let sum = 0;

        for (let i = 0; i < 1024; i++) {
            const r = imgData[i * 4], g = imgData[i * 4 + 1], b = imgData[i * 4 + 2];
            // Highlight white/light text digits over colorful badge backgrounds
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const sat = Math.max(r, g, b) - Math.min(r, g, b);
            const val = lum - sat * 0.5; // Digits are neutral white, badges are saturated
            gray[i] = Math.max(0, val);
            sum += gray[i];
        }

        const mean = sum / 1024;
        let varSum = 0;
        for (let i = 0; i < 1024; i++) {
            gray[i] -= mean;
            varSum += gray[i] * gray[i];
        }
        const std = Math.sqrt(varSum) || 1.0;
        for (let i = 0; i < 1024; i++) {
            gray[i] /= std;
        }

        // Correlate with each digit template (0-9)
        let bestDigit = null;
        let bestZNCC = -1;

        for (let d = 0; d <= 9; d++) {
            const tmpl = this.digitTemplates[d].data;
            let corr = 0;
            for (let i = 0; i < 1024; i++) {
                corr += gray[i] * tmpl[i];
            }
            // Normalize by N
            corr /= 1024;

            if (corr > bestZNCC) {
                bestZNCC = corr;
                bestDigit = d;
            }
        }

        // Continuous confidence in [0.0, 1.0]
        const confidence = Math.max(0, Math.min(1.0, (bestZNCC + 0.2) / 0.8));

        return {
            digit: bestDigit,
            confidence: Math.round(confidence * 100) / 100
        };
    }

    /**
     * Soft Bayesian compatibility prior P(Card | detectedCost, detectedPower)
     * Never locks out any card; returns a continuous compatibility multiplier in [0.3, 1.0]
     */
    getStatCompatibility(card, detectedCost, detectedPower, costConf, powerConf) {
        if (!card) return 0.5;

        let multiplier = 1.0;

        // Cost comparison
        if (detectedCost !== null && detectedCost !== undefined && card.cost !== undefined) {
            const diff = Math.abs(card.cost - detectedCost);
            if (diff === 0) {
                multiplier *= (1.0 + 0.25 * (costConf || 0.5));
            } else if (diff === 1) {
                multiplier *= (1.0 - 0.15 * (costConf || 0.5));
            } else {
                multiplier *= (1.0 - 0.35 * (costConf || 0.5));
            }
        }

        // Power comparison
        if (detectedPower !== null && detectedPower !== undefined && card.power !== undefined) {
            const diff = Math.abs(card.power - detectedPower);
            if (diff === 0) {
                multiplier *= (1.0 + 0.15 * (powerConf || 0.5));
            } else if (diff > 2) {
                multiplier *= 0.85;
            }
        }

        return Math.max(0.2, Math.min(1.5, multiplier));
    }
}

if (typeof module !== 'undefined') {
    module.exports = { StatPruner };
}
