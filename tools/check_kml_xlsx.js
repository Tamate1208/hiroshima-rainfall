const XLSX = require('xlsx');
const fs = require('fs');
const iconv = require('iconv-lite');
const xml2js = require('xml2js');

async function check() {
    // 1. Read KML
    const kmlBuffer = fs.readFileSync('c:/Users/keiichi/Workspace/雨量/RainfallStations.kml');
    const kmlText = iconv.decode(kmlBuffer, 'Shift_JIS');
    const parser = new xml2js.Parser();
    const kmlObj = await parser.parseStringPromise(kmlText);
    const placemarks = kmlObj.kml.Document[0].Placemark;

    const kmlStations = placemarks.map(p => {
        const description = p.description ? p.description[0] : '';
        const cityMatch = description.match(/市町名:\s*([^<\n]+)/);
        const city = cityMatch ? cityMatch[1].trim() : '';
        return {
            name: p.name[0].trim(),
            city: city
        };
    });

    console.log(`KML局数: ${kmlStations.length}`);

    // 2. Read Excel (20210812-uryo.xlsx)
    const wb = XLSX.readFile('c:/Users/keiichi/Workspace/downloads/20210812-uryo.xlsx');
    const sheet = wb.Sheets['雨量定時表1'];
    const xlsxStations = [];
    for (let i = 4; i <= 408; i++) {
        const nameCell = sheet['A' + i];
        const cityCell = sheet['B' + i];
        if (nameCell && nameCell.v) {
            xlsxStations.push({
                row: i,
                name: nameCell.v.toString().trim(),
                city: cityCell ? cityCell.v.toString().trim() : ''
            });
        }
    }
    console.log(`Excel局数: ${xlsxStations.length}`);

    // 3. For each Excel station, try to find matching KML entry (city+name)
    const matched = [];
    const unmatched = [];
    const multiMatch = [];

    xlsxStations.forEach(e => {
        const cleanExcelName = e.name.replace(/\s+/g, '').replace(/[（）\(\)]/g, '');
        const excelCity = e.city.replace(/\s+/g, '');

        // Exact city+name match
        let hits = kmlStations.filter(k => {
            const cleanKmlName = k.name.replace(/\s+/g, '').replace(/[（）\(\)]/g, '');
            const cleanKmlCity = k.city.replace(/\s+/g, '');
            return cleanKmlCity === excelCity && cleanKmlName === cleanExcelName;
        });

        if (hits.length === 1) {
            matched.push({ row: e.row, city: e.city, name: e.name, matchType: '完全一致' });
        } else if (hits.length > 1) {
            multiMatch.push({ row: e.row, city: e.city, name: e.name, hits: hits.length });
        } else {
            // Partial match (with city)
            hits = kmlStations.filter(k => {
                const cleanKmlName = k.name.replace(/\s+/g, '').replace(/[（）\(\)]/g, '');
                const cleanKmlCity = k.city.replace(/\s+/g, '');
                return cleanKmlCity === excelCity && 
                    (cleanKmlName.includes(cleanExcelName) || cleanExcelName.includes(cleanKmlName));
            });

            if (hits.length === 1) {
                matched.push({ row: e.row, city: e.city, name: e.name, matchType: `部分一致→KML:${hits[0].name}` });
            } else if (hits.length > 1) {
                multiMatch.push({ row: e.row, city: e.city, name: e.name, hits: hits.length, matchType: '部分一致が複数' });
            } else {
                unmatched.push({ row: e.row, city: e.city, name: e.name });
            }
        }
    });

    console.log(`\n✓ マッチ: ${matched.length}局`);
    console.log(`⚠ 複数マッチ: ${multiMatch.length}局`);
    console.log(`✗ アンマッチ: ${unmatched.length}局`);

    if (multiMatch.length > 0) {
        console.log('\n--- 複数マッチ（要確認） ---');
        multiMatch.forEach(m => console.log(`  Row${m.row} ${m.city} ${m.name}: ${m.hits}件ヒット (${m.matchType || ''})`));
    }

    if (unmatched.length > 0) {
        console.log('\n--- アンマッチ局（KMLに対応なし） ---');
        unmatched.forEach(u => console.log(`  Row${u.row} ${u.city} ${u.name}`));
    }

    // 4. Check KML stations not in Excel
    const kmlUnused = kmlStations.filter(k => {
        const cleanKmlName = k.name.replace(/\s+/g, '').replace(/[（）\(\)]/g, '');
        const cleanKmlCity = k.city.replace(/\s+/g, '');
        return !xlsxStations.some(e => {
            const cleanExcelName = e.name.replace(/\s+/g, '').replace(/[（）\(\)]/g, '');
            const excelCity = e.city.replace(/\s+/g, '');
            return cleanKmlCity === excelCity && 
                (cleanKmlName === cleanExcelName || cleanKmlName.includes(cleanExcelName) || cleanExcelName.includes(cleanKmlName));
        });
    });

    console.log(`\n--- KML側にあるがExcelにない局: ${kmlUnused.length}件 ---`);
    if (kmlUnused.length > 0 && kmlUnused.length <= 30) {
        kmlUnused.forEach(k => console.log(`  ${k.city} ${k.name}`));
    } else if (kmlUnused.length > 30) {
        kmlUnused.slice(0, 30).forEach(k => console.log(`  ${k.city} ${k.name}`));
        console.log(`  ...他${kmlUnused.length - 30}件`);
    }
}

check().catch(console.error);
