/**
 * Marvel Snap Deck Code Generator & Formatter
 * Formats 12 CardDefIds into the official Base64 JSON deck string recognized by Marvel Snap.
 */

class DeckEncoder {
    /**
     * Encodes 12 cards into the official Marvel Snap Base64 format
     * @param {Array<string>} cardDefIds 
     * @param {string} deckName 
     * @param {Array<object>} cardDatabase 
     * @returns {{ rawBase64: string, shareableText: string, json: object }}
     */
    static encode(cardDefIds, deckName = "Imported Deck", cardDatabase = []) {
        const cardsArray = cardDefIds.map(id => ({ CardDefId: id }));
        const jsonObj = {
            Name: deckName,
            Cards: cardsArray
        };

        const jsonString = JSON.stringify(jsonObj);
        
        let base64String = "";
        if (typeof btoa === 'function') {
            base64String = btoa(jsonString);
        } else if (typeof Buffer !== 'undefined') {
            base64String = Buffer.from(jsonString).toString('base64');
        }

        const dbMap = {};
        for (const c of cardDatabase) {
            dbMap[c.cardDefId] = c;
        }

        const sortedCards = [...cardDefIds].sort((a, b) => {
            const costA = dbMap[a]?.cost || 0;
            const costB = dbMap[b]?.cost || 0;
            if (costA !== costB) return costA - costB;
            return a.localeCompare(b);
        });

        const lines = [];
        for (const id of sortedCards) {
            const info = dbMap[id];
            const cost = info ? info.cost : 0;
            const name = info ? info.name : id;
            lines.push(`# (${cost}) ${name}`);
        }

        const shareableText = lines.join('\n') + `\n#\n${base64String}\n#\n# To use this deck, copy it to your clipboard and paste it from the deck editing menu in MARVEL SNAP.`;

        return {
            rawBase64: base64String,
            shareableText: shareableText,
            json: jsonObj
        };
    }

    static encodeDeck(cardDefIds, deckName = "Imported Deck", cardDatabase = []) {
        const res = this.encode(cardDefIds, deckName, cardDatabase);
        return res.rawBase64;
    }

    /**
     * Decodes a Marvel Snap Base64 deck string back into an array of CardDefIds
     * @param {string} deckCode 
     * @returns {Array<string>}
     */
    static decode(deckCode) {
        try {
            const clean = deckCode.trim().split('\n').filter(l => !l.startsWith('#')).join('').trim();
            let jsonStr = "";
            if (typeof atob === 'function') {
                jsonStr = atob(clean);
            } else if (typeof Buffer !== 'undefined') {
                jsonStr = Buffer.from(clean, 'base64').toString('utf8');
            }
            const data = JSON.parse(jsonStr);
            if (data.Cards && Array.isArray(data.Cards)) {
                return data.Cards.map(c => c.CardDefId);
            }
        } catch (e) {
            console.warn('Decode error:', e.message);
        }
        return [];
    }

    static decodeDeck(deckCode) {
        return this.decode(deckCode);
    }
}

if (typeof module !== 'undefined') {
    module.exports = { DeckEncoder };
}
