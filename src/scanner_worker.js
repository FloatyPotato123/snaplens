/**
 * Marvel Snap Deck Scanner - Dedicated Parallel Web Worker
 * 
 * Offloads compute-heavy ZNCC template matching off the main browser UI thread.
 */

importScripts('logo_matcher.js?v=48');

let matcher = null;

self.onmessage = function(e) {
    const msg = e.data;
    if (!msg) return;

    if (msg.type === 'INIT') {
        matcher = new LogoMatcher(msg.templates, msg.wasmBinary);
        self.postMessage({ type: 'INIT_DONE' });
    } else if (msg.type === 'MATCH_CARD') {
        if (!matcher) {
            self.postMessage({ type: 'CARD_MATCH_ERROR', slotIndex: msg.slotIndex, error: 'Matcher not initialized' });
            return;
        }

        const { scanId, slotIndex, imgData, width, height, targetCost, targetPower } = msg;

        // Mock minimal canvas interface expected by LogoMatcher
        const cardCanvas = {
            width,
            height,
            getContext: (type) => ({
                getImageData: (sx, sy, sw, sh) => ({
                    data: imgData,
                    width,
                    height
                })
            })
        };

        try {
            const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            const ranked = matcher.matchCard(cardCanvas, targetCost, targetPower);
            const durationMs = (typeof performance !== 'undefined') ? (performance.now() - t0) : (Date.now() - t0);
            self.postMessage({
                type: 'CARD_MATCHED',
                scanId,
                slotIndex,
                durationMs,
                candidates: ranked.slice(0, 20)
            });
        } catch (err) {
            self.postMessage({
                type: 'CARD_MATCH_ERROR',
                scanId,
                slotIndex,
                error: err.message || String(err)
            });
        }
    }
};
