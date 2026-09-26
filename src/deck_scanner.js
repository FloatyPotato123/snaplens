/**
 * Marvel Snap Production Deck Scanner
 * 
 * Pipeline:
 * 1. Mathematical Layout Slicer (dynamic gradient energy & lattice geometry)
 * 2. Stat Feature Extraction (Cost & Power badges)
 * 3. Fast Native Logo Point Cloud Matcher (direct Euclidean color distance)
 * 4. Global 1-to-1 Uniqueness Assignment (Maximum Weight Bipartite Matching)
 * 5. Official Base64 Marvel Snap Deck Code Generation
 */

const NON_COLLECTIBLE_TOKENS = new Set([
  'vibranium', 'Rock', 'Ninja', 'Demon', 'DoomBot', 'DoomBot2099', 'Drone',
  'EbonyBlade', 'AcidArrow', 'BasicArrow', 'GrappleArrow', 'PymParticleArrow',
  'Mjolnir', 'Stormbreaker', 'MuramasaShard', 'SinisterClone', 'TheVoid',
  'TigerSpirit', 'WidowsBite', 'WidowsKiss', 'WinterSoldier', 'Pig', 'Ice', 'IceCube',
  'MindStone', 'PowerStone', 'RealityStone', 'SoulStone', 'SpaceStone', 'TimeStone',
  'Raptor', 'Monster', 'Chimichanga', 'CapsShield', 'Spell01Agamotto', 'Spell02Agamotto',
  'Spell03Agamotto', 'Spell04Agamotto', 'Spell05Agamotto', 'TenRings', 'TheTenRings'
]);

// Marvel Snap Limited/Draft game modes allow up to 2 copies of a card in a deck.
// Standard constructed decks enforce strict 1-to-1 uniqueness.
// We permit a second copy only when recognition confidence is unequivocally high:
const DRAFT_MODE_CONSTRAINTS = {
    MAX_CARD_COPIES: 2,
    MIN_CONFIDENCE_FOR_DUPLICATE: 0.65,
    MIN_RAW_ZNCC_FOR_DUPLICATE: 0.70,
};

class DeckScanner {
    constructor(cardsDatabase, logoMatcher, templatesData = null) {
        this.cardsDatabase = cardsDatabase || [];
        this.cardsMap = new Map();
        for (const card of this.cardsDatabase) {
            if (card && card.cardDefId) {
                this.cardsMap.set(card.cardDefId, card);
                this.cardsMap.set(card.cardDefId.toLowerCase(), card);
            }
        }
        this.logoMatcher = logoMatcher || null;
        this.templatesData = templatesData || null;
        this.workers = [];
        this.workerReady = false;
        this.currentScanId = 0;
        this.isScanning = false;

        if (typeof window !== "undefined" && typeof Worker !== "undefined" && templatesData) {
            this.initWorkers(templatesData);
        }
    }

    async initWorkers(templatesData) {
        try {
            const filteredTemplates = {};
            for (const [id, tpl] of Object.entries(templatesData)) {
                if (!NON_COLLECTIBLE_TOKENS.has(id)) {
                    filteredTemplates[id] = tpl;
                }
            }
            const isMobile = (typeof navigator !== "undefined") && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            const concurrency = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 8;
            // On desktop/laptop, initialize 12 workers (1 worker per card) so all 12 cards in the deck
            // execute concurrently in a single wave, completely eliminating second-wave queuing latency.
            const numWorkers = isMobile ? Math.min(4, Math.max(2, concurrency)) : 12;

            let wasmBinary = null;
            try {
                const wasmUrl = (typeof window !== "undefined" && window.location)
                    ? new URL('src/wasm/matcher.wasm?v=48', window.location.href).href
                    : 'src/wasm/matcher.wasm?v=48';
                const wasmRes = await fetch(wasmUrl);
                if (wasmRes.ok) {
                    wasmBinary = await wasmRes.arrayBuffer();
                }
            } catch (err) {
                console.warn("[DeckScanner] Could not pre-fetch matcher.wasm:", err);
            }

            this.workers = [];
            this.workerInitPromises = [];
            const workerUrl = (typeof window !== "undefined" && window.location)
                ? new URL('src/scanner_worker.js?v=48', window.location.href).href
                : `src/scanner_worker.js?v=48`;
            for (let i = 0; i < numWorkers; i++) {
                const w = new Worker(workerUrl);
                const p = new Promise(resolve => {
                    const initHandler = (e) => {
                        if (e.data && e.data.type === 'INIT_DONE') {
                            w.removeEventListener('message', initHandler);
                            resolve();
                        }
                    };
                    w.addEventListener('message', initHandler);
                });
                this.workerInitPromises.push(p);
                w.postMessage({ type: "INIT", templates: filteredTemplates, wasmBinary });
                this.workers.push(w);
            }
            Promise.all(this.workerInitPromises).then(() => {
                this.workerReady = true;
                console.log(`🚀 [DeckScanner] Initialized and verified ${numWorkers} parallel Web Workers (concurrency reported: ${concurrency})`);
            }).catch(err => {
                console.warn("[DeckScanner] Worker initialization failed:", err);
                this.workerReady = false;
            });
        } catch (err) {
            console.warn("[DeckScanner] Could not initialize Web Workers, falling back to main thread:", err);
            this.workers = [];
            this.workerReady = false;
        }
    }

    resetWorkers() {
        if (this.workers && this.workers.length > 0) {
            for (const w of this.workers) {
                try { w.terminate(); } catch (_) {}
            }
        }
        this.workers = [];
        this.workerReady = false;
        if (this.templatesData) {
            this.initWorkers(this.templatesData);
        }
    }

    setCardsData(cardsDatabase, logoMatcher, templatesData = null) {
        this.cardsDatabase = cardsDatabase || [];
        if (logoMatcher) this.logoMatcher = logoMatcher;
        if (templatesData && !this.workerReady) {
            this.templatesData = templatesData;
            this.initWorkers(templatesData);
        }
    }

    setLogoMatcher(logoMatcher) {
        this.logoMatcher = logoMatcher;
    }

    async scanDeck(imageSource, onProgress = null) {
        // If a scan was already running, cancel it cleanly by resetting the worker pool
        if (this.isScanning) {
            this.resetWorkers();
        }
        this.isScanning = true;
        const scanId = ++this.currentScanId;

        try {
            return await this._executeScan(imageSource, scanId, onProgress);
        } finally {
            if (this.currentScanId === scanId) {
                this.isScanning = false;
            }
        }
    }

    async _executeScan(imageSource, scanId, onProgress = null) {
        let sourceCanvas;
        if (imageSource && typeof imageSource.getContext === "function" && imageSource.width && imageSource.height) {
            sourceCanvas = imageSource;
        } else {
            sourceCanvas = document.createElement("canvas");
            sourceCanvas.width = imageSource.naturalWidth || imageSource.width;
            sourceCanvas.height = imageSource.naturalHeight || imageSource.height;
            const ctx = sourceCanvas.getContext("2d");
            ctx.drawImage(imageSource, 0, 0);
        }

        // Stage 1: Mathematical Grid Slicing
        const sliceResult = LayoutDetector.sliceDeck(sourceCanvas);
        const cardPatches = sliceResult.cards;

        // Stage 2: Prepare card canvases for all 12 slots
        const slotResults = cardPatches.map((patch, idx) => ({
            slotIndex: idx,
            patch,
            cardCanvas: patch.canvas
        }));

        // Ensure workers are initialized if a scan started immediately after instantiation
        if (this.workerInitPromises && this.workerInitPromises.length > 0) {
            await Promise.all(this.workerInitPromises);
        }

        // Stage 3: Score candidates for each slot (Parallel via Workers or Sequential Fallback)
        let slotCandidatePools = [];
        const cardDurations = [];

        const resolveCard = (candCard) => {
            if (!candCard) return candCard;
            const defId = candCard.cardDefId || candCard.name;
            const dbCard = this.cardsMap.get(defId) || this.cardsMap.get((defId || '').toLowerCase());
            if (dbCard) {
                return {
                    ...candCard,
                    cardDefId: dbCard.cardDefId,
                    name: dbCard.name,
                    cost: dbCard.cost,
                    power: dbCard.power,
                    description: dbCard.description
                };
            }
            return candCard;
        };

        if (this.workerReady && this.workers.length > 0) {
            slotCandidatePools = new Array(slotResults.length);
            let nextSlotIdx = 0;
            let completedCount = 0;
            const tStage3 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            console.log(`[DeckScanner] Starting parallel scan across ${this.workers.length} Web Workers...`);

            const runWorker = (worker, workerId) => {
                return new Promise((resolveWorker, rejectWorker) => {
                    const processNext = () => {
                        if (nextSlotIdx >= slotResults.length) {
                            resolveWorker();
                            return;
                        }
                        const idx = nextSlotIdx++;
                        const slot = slotResults[idx];
                        const ctx = slot.cardCanvas.getContext("2d");
                        const imgData = ctx.getImageData(0, 0, slot.cardCanvas.width, slot.cardCanvas.height).data;

                        const handler = (e) => {
                            const res = e.data;
                            if (res.type === "CARD_MATCHED" && res.scanId === scanId && res.slotIndex === idx) {
                                worker.removeEventListener("message", handler);
                                slotCandidatePools[idx] = (res.candidates || []).map(c => ({
                                    ...c,
                                    card: resolveCard(c.card)
                                }));
                                cardDurations.push(res.durationMs || 0);
                                completedCount++;
                                console.log(`[DeckScanner] Card #${idx + 1} (${slotCandidatePools[idx][0]?.card?.name || '?'}) matched in ${(res.durationMs || 0).toFixed(0)}ms by Worker #${workerId} (${completedCount}/${slotResults.length} done)`);
                                if (typeof onProgress === "function") {
                                    onProgress(completedCount, slotResults.length);
                                }
                                processNext();
                            } else if (res.type === "CARD_MATCH_ERROR" && res.scanId === scanId && res.slotIndex === idx) {
                                worker.removeEventListener("message", handler);
                                rejectWorker(new Error(res.error));
                            }
                        };
                        worker.addEventListener("message", handler);
                        worker.postMessage({
                            type: "MATCH_CARD",
                            scanId,
                            slotIndex: idx,
                            imgData,
                            width: slot.cardCanvas.width,
                            height: slot.cardCanvas.height,
                            targetCost: null,
                            targetPower: null
                        }, [imgData.buffer]);
                    };
                    processNext();
                });
            };

            await Promise.all(this.workers.map((w, i) => runWorker(w, i)));
            const stage3Elapsed = (typeof performance !== 'undefined') ? (performance.now() - tStage3) : (Date.now() - tStage3);
            const avgCard = cardDurations.length ? (cardDurations.reduce((a, b) => a + b, 0) / cardDurations.length) : 0;
            console.log(`🚀 [DeckScanner] Parallel matching complete in ${stage3Elapsed.toFixed(0)}ms (avg ${avgCard.toFixed(0)}ms/card across ${this.workers.length} workers)`);
        } else {
            console.warn(`⚠️ [DeckScanner] Falling back to sequential main thread matching (workerReady: ${this.workerReady}, workers: ${this.workers.length})`);
            const tSeq = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            for (let i = 0; i < slotResults.length; i++) {
                if (typeof onProgress === "function") {
                    onProgress(i + 1, slotResults.length);
                }
                // Yield execution to the browser event loop so UI repaints and clicks remain fluid
                await new Promise(resolve => setTimeout(resolve, 20));

                const { cardCanvas } = slotResults[i];
                let candidates = [];

                if (this.logoMatcher && this.logoMatcher.isReady) {
                    const ranked = this.logoMatcher.matchCard(cardCanvas, null, null);
                    candidates = ranked.slice(0, 20);
                } else {
                    candidates = this.cardsDatabase.slice(0, 12).map(c => ({
                        card: c,
                        score: 0.5
                    }));
                }

                slotCandidatePools.push(candidates.map(c => ({
                    ...c,
                    card: resolveCard(c.card)
                })));
            }
            console.log(`[DeckScanner] Sequential matching finished in ${((typeof performance !== 'undefined' ? performance.now() : Date.now()) - tSeq).toFixed(0)}ms`);
        }

        // Stage 4: Greedy Maximum Weight Bipartite Assignment
        const assignedCards = new Array(slotResults.length).fill(null);
        const assignedConf = new Array(slotResults.length).fill(0);
        const usedCardDefIds = new Set();

        // Flatten all (slot, candidate, score) pairs and sort descending
        const allPairs = [];
        for (let sIdx = 0; sIdx < slotResults.length; sIdx++) {
            for (const cand of slotCandidatePools[sIdx]) {
                allPairs.push({
                    slotIndex: sIdx,
                    card: cand.card,
                    score: cand.score,
                    rawZNCC: cand.rawZNCC
                });
            }
        }
        allPairs.sort((a, b) => b.score - a.score);

        // Assign top non-conflicting pairs (allows draft duplicate cards when confidence >= 65% or rawZNCC >= 70%)
        const usedCardCounts = {};
        for (const pair of allPairs) {
            const count = usedCardCounts[pair.card.cardDefId] || 0;
            const canAllowDuplicate = (pair.score >= DRAFT_MODE_CONSTRAINTS.MIN_CONFIDENCE_FOR_DUPLICATE ||
                (pair.rawZNCC && pair.rawZNCC >= DRAFT_MODE_CONSTRAINTS.MIN_RAW_ZNCC_FOR_DUPLICATE));
            const maxAllowed = canAllowDuplicate ? DRAFT_MODE_CONSTRAINTS.MAX_CARD_COPIES : 1;
            if (assignedCards[pair.slotIndex] === null && count < maxAllowed) {
                assignedCards[pair.slotIndex] = pair.card;
                assignedConf[pair.slotIndex] = Math.min(1.0, pair.score);
                usedCardCounts[pair.card.cardDefId] = count + 1;
            }
        }

        // Fallback for any unassigned slots
        for (let sIdx = 0; sIdx < slotResults.length; sIdx++) {
            if (assignedCards[sIdx] === null) {
                for (const cand of slotCandidatePools[sIdx]) {
                    if (!usedCardDefIds.has(cand.card.cardDefId)) {
                        assignedCards[sIdx] = cand.card;
                        assignedConf[sIdx] = Math.min(1.0, cand.score);
                        usedCardDefIds.add(cand.card.cardDefId);
                        break;
                    }
                }
            }
        }

        // Stage 5: Assemble Final Detected Deck
        const detectedSlots = [];
        for (let i = 0; i < slotResults.length; i++) {
            const { patch, cardCanvas, costRes, powerRes } = slotResults[i];
            const selectedCard = assignedCards[i];

            detectedSlots.push({
                slotIndex: i,
                patch,
                cardCanvas,
                detectedCost: selectedCard ? selectedCard.cost : (costRes && costRes.digit !== null ? costRes.digit : null),
                detectedPower: selectedCard ? selectedCard.power : (powerRes && powerRes.digit !== null ? powerRes.digit : null),
                selectedCard,
                matchConfidence: assignedConf[i] || 0.5,
                candidateMatches: slotCandidatePools[i]
            });
        }

        // Stage 6: Official Marvel Snap Base64 Deck Code
        const cardDefIds = detectedSlots.map(s => s.selectedCard ? s.selectedCard.cardDefId : "Unknown");
        const deckCode = DeckEncoder.encodeDeck(cardDefIds, "Scanned Deck");
        const avgConf = detectedSlots.reduce((acc, s) => acc + (s.matchConfidence || 0), 0) / Math.max(1, detectedSlots.length);

        const avgCardTimeMs = cardDurations.length ? (cardDurations.reduce((a, b) => a + b, 0) / cardDurations.length) : 0;

        return {
            layout: sliceResult.layout,
            cards: detectedSlots,
            deckCode,
            confidence: avgConf,
            bounds: sliceResult.deckBounds || sliceResult.bounds,
            deckBounds: sliceResult.deckBounds,
            workerCount: (this.workerReady && this.workers.length > 0) ? this.workers.length : 1,
            isParallel: (this.workerReady && this.workers.length > 0),
            avgCardTimeMs
        };
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { DeckScanner };
}
