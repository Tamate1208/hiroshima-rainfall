// Patch mapping.json with corrected coordinates for 4 KML duplicate entries
const fs = require('fs');
const mappingPath = 'c:/Users/keiichi/Workspace/hiroshima-rainfall/mapping.json';
const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

const corrections = [
    // 廿日市市 楢原(国): was same as 玖島 (34.3911, 132.25)
    // Correct: 34°23'26"N = 34.390556, 132°15'00"E = 132.25 (玖島地内ではあるが別地点)
    // river.go.jp: 廿日市市玖島字楢原4323-1 → 34°23'26", 132°15'00"
    { city: '廿日市市', name: '楢原(国)', lat: 34.390556, lon: 132.25 },

    // 広島市安佐北区 白木: was same as 白木(三日市) (34.5536, 132.6556)
    // Correct: 34°33'01"N = 34.550278, 132°40'25"E = 132.673611
    // river.go.jp: 安佐北区白木町大字小越字関川612-4
    { city: '広島市安佐北区', name: '白木', lat: 34.550278, lon: 132.673611 },

    // 三次市 仁賀: was same as 竹原市 仁賀 (34.7913, 132.9778)
    // Correct: 三良坂町仁賀 灰塚ダム付近 34°46'56"N = 34.782222, 132°59'22"E = 132.989444
    { city: '三次市', name: '仁賀', lat: 34.782222, lon: 132.989444 },

    // 三原市 西野: was same as 竹原市 西野 (34.4058, 133.0589)
    // Correct: 三原市西野町 大西バス停付近 34.410834, 133.053059
    { city: '三原市', name: '西野', lat: 34.410834, lon: 133.053059 },
];

let patched = 0;
corrections.forEach(fix => {
    const entry = mapping.find(m => m.city === fix.city && m.name === fix.name);
    if (entry) {
        console.log(`Before: ${fix.city} 「${fix.name}」 (${entry.lat}, ${entry.lon})`);
        entry.lat = fix.lat;
        entry.lon = fix.lon;
        console.log(`After:  ${fix.city} 「${fix.name}」 (${entry.lat}, ${entry.lon})`);
        patched++;
    } else {
        console.log(`NOT FOUND: ${fix.city} ${fix.name}`);
    }
});

fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
console.log(`\n${patched}件の座標を修正しました。`);
