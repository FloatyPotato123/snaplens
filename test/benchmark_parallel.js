const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

const TEST_SUITES = [
    {
        id: 'sample1',
        name: 'Sample 1: Clean PC 6x2 (Bounce / Move)',
        file: 'sample1_pc_6x2.jpg',
        layout: '6x2',
        expected: ['MajesticWingbeat', 'KittyPryde', 'Agony', 'SpiderManBrandNewDay', 'GrandMaster', 'ScarletWitch', 'Magik', 'HopeSummers', 'Psylocke', 'MotherAskani', 'SuperiorIronMan', 'ShouLao']
    },
    {
        id: 'sample2',
        name: 'Sample 2: Mobile Foiled 6x2 (Evil Bounce)',
        file: 'sample2_mobile_foil_6x2.png',
        layout: '6x2',
        expected: ['SilverSable', 'Hawkeye', 'RocketRaccoon', 'AmericaChavez', 'NicoMinoru', 'Toxin', 'Falcon', 'JoaquinTorres', 'Frigga', 'Venom', 'Beast', 'SinisterSix']
    },
    {
        id: 'sample4',
        name: 'Sample 4: Tracker UI 6x2 (Draft/Constructed)',
        file: 'sample4_tracker_6x2.png',
        layout: '6x2',
        expected: ['SilverSable', 'Agony', 'Forge', 'Forge', 'Lasher', 'MrSinister', 'Starlord', 'Ironheart', 'Beast', 'BlackPanther', 'Stick', 'MotherAskani']
    },
    {
        id: 'sample10',
        name: 'Sample 10: High Quality In-Game 6x2 (HMMMM)',
        file: 'sample10_hmmmm_6x2.jpg',
        layout: '6x2',
        expected: ['Nova', 'Quinjet', 'Surge', 'GrandMaster', 'Starhawk', 'Bullseye', 'Venus', 'Frigga', 'Killmonger', 'Daken', 'MotherAskani', 'GambitHorseman']
    },
    {
        id: 'wiccan',
        name: 'Sample 6: Tablet Landscape 6x2 (Antipolar Wiccan)',
        file: 'sample_antipolar_wiccan_6x2.jpg',
        layout: '6x2',
        expected: ['Quicksilver', 'Domino', 'Cosmo', 'DraxAvatarOfLife', 'Venus', 'JaneFosterFracturedFrontier', 'StrongGuy', 'Isca', 'Juggernaut', 'Wiccan', 'ThanosFracturedFrontier', 'AntiPolarMagneto']
    },
    {
        id: 'sera',
        name: 'Sample 7: Mobile Portrait 4x3 (Sera Miracle)',
        file: 'sample_sera_miracle_4x3.jpg',
        layout: '4x3',
        expected: ['Magik', 'SilverSurfer', 'HitMonkey', 'Venus', 'JaneFosterFracturedFrontier', 'PsylockeFracturedFrontier', 'ShadowKing', 'StrongGuy', 'LunaSnow', 'Sera', 'Blink', 'Onslaught']
    },
    {
        id: 'biggest',
        name: 'Sample 8: Mobile Portrait 4x3 (Biggest & Baddest)',
        file: 'sample_biggest_baddest_4x3.jpg',
        layout: '4x3',
        expected: ['KingEitri', 'HydraBob', 'Martyr', 'AdamWarlock', 'TechnoOrganicVirus', 'ShadowlandsDaredevil', 'Lizard', 'Starbrand', 'Ares', 'ThanosFracturedFrontier', 'Sasquatch', 'Skaar']
    },
    {
        id: 'destroy',
        name: 'Sample 9: Destroy Deck 6x2 (Deadpool / Knull)',
        file: 'deck5_destroy.jpg',
        layout: '6x2',
        expected: ['Deadpool', 'X23', 'Carnage', 'Psylocke', 'WadeWilson', 'Firehair', 'Venom', 'Prodigy', 'Blink', 'Death', 'Knull', 'Destroyer']
    },
    {
        id: 'sample11',
        name: 'Sample 11: Cassandra Nova 4x3 (User Uploaded)',
        file: 'sample11_cassandra_4x3.png',
        layout: '4x3',
        expected: ['SilverSable', 'Korg', 'GrandMaster', 'MasterMold', 'Scorpion', 'Firehair', 'CassandraNova', 'Venom', 'DragonOfTheMoon', 'Firelord', 'Misery', 'Ronan']
    },
    {
        id: 'sample12',
        name: 'Sample 12: Polar Slop 4x3 (User Uploaded)',
        file: 'sample12_polar_slop_4x3.png',
        layout: '4x3',
        expected: ['TechnoOrganicVirus', 'Lizard', 'Kraglin', 'LunaSnow', 'Debrii', 'RedHulkFracturedFrontier', 'Starbrand', 'Jubilee', 'RedOnslaught', 'Blink', 'Enchantress', 'AntiPolarMagneto']
    },
    {
        id: 'sample13',
        name: 'Sample 13: Gambit Test 6x2 (User Uploaded)',
        file: 'sample13_gambit_test_6x2.png',
        layout: '6x2',
        expected: ['Quinjet', 'KingEitri', 'SamWilson', 'Mirage', 'Valentina', 'JaneFoster', 'Phastos', 'GambitHorseman', 'LunaSnow', 'Juggernaut', 'Thanos', 'Agamotto']
    },
    {
        id: 'sample_fire_wolf',
        name: 'Sample 14: Fire Wolf 6x2 (User Uploaded)',
        file: 'sample_fire_wolf.jpg',
        layout: '6x2',
        expected: ['SilverSable', 'Hawkeye', 'AmericaChavez', 'NicoMinoru', 'Surge', 'Boomerang', 'Toxin', 'GrandMaster', 'WerewolfByNight', 'FriendlyNeighborhoodCarnage', 'Beast', 'ShouLao']
    }
];

async function runParallelBenchmarks() {
    const numCores = Math.min(TEST_SUITES.length, os.cpus().length || 4);
    console.log(`================================================================================`);
    console.log(`🚀 MARVEL SNAP REAL PARALLEL BENCHMARK (Running across ${numCores} CPU Worker Threads)`);
    console.log(`   Executing real LayoutDetector -> LogoMatcher (ZNCC) -> Bipartite Assignment`);
    console.log(`================================================================================\n`);

    const tStart = Date.now();
    const workerScript = path.join(__dirname, 'benchmark_worker.js');

    // Run each suite in its own worker thread concurrently
    const suitePromises = TEST_SUITES.map((suite) => {
        return new Promise((resolve) => {
            const worker = new Worker(workerScript);
            worker.on('message', (result) => {
                worker.terminate();
                console.log(`[Worker Finished] ${result.name} in ${result.elapsed}ms (${result.correct}/${result.total})`);
                resolve(result);
            });
            worker.on('error', (err) => {
                worker.terminate();
                resolve({ id: suite.id, name: suite.name, error: err.message, correct: 0, total: 12, elapsed: 0, cards: [] });
            });
            worker.postMessage(suite);
        });
    });

    const results = await Promise.all(suitePromises);
    const totalElapsed = Date.now() - tStart;

    let overallMatched = 0;
    let overallTotal = 0;

    for (const res of results) {
        overallMatched += res.correct;
        overallTotal += res.total;

        console.log(`📌 ${res.name}`);
        console.log(`   Layout: ${res.layout || 'Unknown'} | Score: ${res.correct}/${res.total} (${res.pct}%) | Time: ${res.elapsed}ms`);
        if (res.cards && res.cards.length > 0) {
            for (const c of res.cards) {
                const status = c.isMatch ? '✅' : '❌';
                const note = c.isMatch ? '' : ` (EXPECTED: ${c.expected})`;
                console.log(`   Slot #${c.slot.toString().padStart(2, ' ')}: [${c.score}%] ${c.detected.padEnd(26, ' ')} ${status}${note}`);
            }
        } else if (res.error) {
            console.log(`   ❌ ERROR: ${res.error}`);
        }
        console.log('--------------------------------------------------------------------------------\n');
    }

    const totalPct = Math.round((overallMatched / overallTotal) * 100);
    console.log(`================================================================================`);
    console.log(`🎯 OVERALL BENCHMARK ACCURACY: ${overallMatched}/${overallTotal} (${totalPct}%)`);
    console.log(`⏱️ TOTAL WALL TIME: ${(totalElapsed / 1000).toFixed(2)}s across ${results.length} full test suites`);
    console.log(`================================================================================\n`);
}

runParallelBenchmarks();
