// tools/map_suii_rows.js
// 水位定時表1 のエクセル行と waterlevel_mapping.json の観測所をマッチングし、
// json に "row" プロパティを付与するスクリプト

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');

const root = path.join(__dirname, '..');
const jsonPath = path.join(root, 'waterlevel_mapping.json');

async function run() {
    if (!fs.existsSync(jsonPath)) {
        console.error(`❌ ${jsonPath} がありません。`);
        process.exit(1);
    }

    let mapping = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    console.log('suii.xlsx を取得して行インデックスをマッチングします...');
    let res;
    try {
        res = await axios.get('https://www.bousai.pref.hiroshima.lg.jp/data/observation/2026/04/20260411-suii.xlsx', {responseType: 'arraybuffer'});
    } catch (e) {
        console.error('❌ ダウンロード失敗:', e.message);
        process.exit(1);
    }

    const wb = XLSX.read(res.data);
    const sheet = wb.Sheets['水位定時表1'];
    if (!sheet) {
        console.error("❌ 水位定時表1シートが見つかりません");
        process.exit(1);
    }

    // 4行目〜1000行目までスキャンし、B列(c=1) または A列(c=0) にある局名を探す
    let matchCount = 0;
    
    // 全観測所の name をキーにしたマップを作成
    const stationMap = new Map();
    mapping.forEach(s => stationMap.set(s.name, s));

    for (let r = 4; r <= 1000; r++) {
        const cellA = sheet[XLSX.utils.encode_cell({r: r-1, c: 0})];
        const cellB = sheet[XLSX.utils.encode_cell({r: r-1, c: 1})];
        const nameA = cellA ? String(cellA.v).trim() : null;
        const nameB = cellB ? String(cellB.v).trim() : null;

        // B列かA列に局名があれば、その行番号(r)を記録
        let matched = false;
        if (nameB && stationMap.has(nameB)) {
            stationMap.get(nameB).row = r;
            matched = true;
        } else if (nameA && stationMap.has(nameA)) {
            stationMap.get(nameA).row = r;
            matched = true;
        }
        
        if (matched) matchCount++;
    }

    // row が見つからなかったものを除外（または警告）
    const finalMapping = mapping.filter(s => s.row !== undefined);
    
    fs.writeFileSync(jsonPath, JSON.stringify(finalMapping, null, 2), 'utf-8');
    
    console.log(`\n✅ 行マッチング完了!`);
    console.log(`  元の局数: ${mapping.length}`);
    console.log(`  マッチした局数: ${finalMapping.length}`);
    if (finalMapping.length > 0) {
        console.log(`  サンプル: ${finalMapping[0].name} -> row: ${finalMapping[0].row}`);
    }
}

run();
