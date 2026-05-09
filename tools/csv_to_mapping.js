// tools/csv_to_mapping.js
// water_stations.csv → waterlevel_mapping.json 変換スクリプト
//
// CSV列定義 (水位局データ作成.py.txt の出力形式):
// 0: 観測所番号, 1: 観測所名, 2: ふりがな, 3: 水系名, 4: 河川名, 5: 河川名(表示用)
// 6: 市町村名,   7: 住所,     8: 緯度,     9: 経度,   10: 所管事務所名, 11: データ所管
// 12: 零点高[T.P.m], 13: 水防団待機[m], 14: はん濫注意[m], 15: 避難判断[m], 16: はん濫危険[m]

const fs   = require('fs');
const path = require('path');

const root      = path.join(__dirname, '..');
const csvPath   = path.join(root, 'water_stations.csv');
const jsonPath  = path.join(root, 'waterlevel_mapping.json');

if (!fs.existsSync(csvPath)) {
    console.error(`❌ ${csvPath} が見つかりません。先に run_water_station.py を実行してください。`);
    process.exit(1);
}

const raw   = fs.readFileSync(csvPath, 'utf-8');
const lines = raw.split(/\r?\n/).filter(l => l.trim());

// 1行目がヘッダー
const header = lines[0].split(',');
console.log('ヘッダー:', header.join(' | '));

const parseNum = (s) => {
    const v = parseFloat(s);
    return isNaN(v) ? null : v;
};

const mapping = [];
let skipped = 0;

for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');

    const lat = parseNum(cols[8]);
    const lon = parseNum(cols[9]);

    // 緯度経度が無効なものはスキップ
    if (!lat || !lon || lat < 33 || lat > 36 || lon < 130 || lon > 135) {
        console.warn(`[スキップ] 行${i}: ${cols[1]} lat=${cols[8]} lon=${cols[9]}`);
        skipped++;
        continue;
    }

    const thresholds = {
        standby:    parseNum(cols[13]),
        warning:    parseNum(cols[14]),
        evacuation: parseNum(cols[15]),
        danger:     parseNum(cols[16])
    };

    mapping.push({
        stationNo:  cols[0].trim(),
        name:       cols[1].trim(),
        furigana:   cols[2].trim(),
        riverSystem:cols[3].trim(),
        riverName:  cols[4].trim(),
        riverLabel: cols[5].trim(),
        city:       cols[6].trim(),
        address:    cols[7].trim(),
        lat,
        lon,
        office:     cols[10].trim(),
        org:        cols[11].trim(),
        zeroPoint:  parseNum(cols[12]),
        thresholds
    });
}

fs.writeFileSync(jsonPath, JSON.stringify(mapping, null, 2), 'utf-8');

console.log(`\n✅ 完了: ${jsonPath}`);
console.log(`   変換: ${mapping.length} 局`);
console.log(`   スキップ: ${skipped} 局 (座標無効)`);

// サンプル表示
console.log('\n--- 先頭3局のサンプル ---');
mapping.slice(0, 3).forEach(s => {
    console.log(`  ${s.name} (${s.riverLabel}) lat=${s.lat} lon=${s.lon}`);
    console.log(`    注意:${s.thresholds.warning}m 危険:${s.thresholds.danger}m`);
});
