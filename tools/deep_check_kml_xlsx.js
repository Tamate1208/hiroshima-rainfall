// Deep check: for each Excel station, show which KML entry it matches to,
// to detect cases where multiple Excel stations match the SAME KML entry
const XLSX = require('xlsx');
const fs = require('fs');
const iconv = require('iconv-lite');
const xml2js = require('xml2js');

async function deepCheck() {
    // Read KML
    const kmlBuffer = fs.readFileSync('c:/Users/keiichi/Workspace/雨量/RainfallStations.kml');
    const kmlText = iconv.decode(kmlBuffer, 'Shift_JIS');
    const parser = new xml2js.Parser();
    const kmlObj = await parser.parseStringPromise(kmlText);
    const placemarks = kmlObj.kml.Document[0].Placemark;

    const kmlStations = placemarks.map((p, idx) => {
        const description = p.description ? p.description[0] : '';
        const cityMatch = description.match(/市町名:\s*([^<\n]+)/);
        const city = cityMatch ? cityMatch[1].trim() : '';
        const coords = p.Point[0].coordinates[0].trim().split(',');
        return {
            idx,
            name: p.name[0].trim(),
            city,
            lon: parseFloat(coords[0]),
            lat: parseFloat(coords[1])
        };
    });

    // Read Excel
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

    // Map each Excel station to which KML index it matched (using same logic as map_stations.js)
    const kmlUsageCount = new Map(); // kmlIdx -> list of Excel stations
    const noMatch = [];

    xlsxStations.forEach(e => {
        const cleanExcelName = e.name.replace(/\s+/g, '').replace(/[（）]/g, '');
        const excelCity = e.city.replace(/\s+/g, '');

        // Priority 1: city + name match
        let match = kmlStations.find(k => {
            const cleanKmlName = k.name.replace(/\s+/g, '').replace(/[（）]/g, '');
            const cleanKmlCity = k.city.replace(/\s+/g, '');
            return cleanKmlCity === excelCity &&
                (cleanKmlName === cleanExcelName || cleanKmlName.includes(cleanExcelName) || cleanExcelName.includes(cleanKmlName));
        });

        // Fallback: name-only (for names > 2 chars)
        if (!match && cleanExcelName.length > 2) {
            match = kmlStations.find(k => {
                const cleanKmlName = k.name.replace(/\s+/g, '').replace(/[（）]/g, '');
                return cleanKmlName === cleanExcelName;
            });
        }

        if (match) {
            if (!kmlUsageCount.has(match.idx)) kmlUsageCount.set(match.idx, []);
            kmlUsageCount.get(match.idx).push({ row: e.row, city: e.city, name: e.name });
        } else {
            noMatch.push(e);
        }
    });

    // Report KML entries used by multiple Excel stations
    let overlapCount = 0;
    console.log('=== 同一KMLエントリに複数のExcel局がマッチしているケース ===');
    kmlUsageCount.forEach((excelList, kmlIdx) => {
        if (excelList.length > 1) {
            overlapCount++;
            const k = kmlStations[kmlIdx];
            console.log(`\nKML[${kmlIdx}] ${k.city} 「${k.name}」(${k.lat},${k.lon})`);
            excelList.forEach(e => console.log(`  → Excel Row${e.row} ${e.city} 「${e.name}」`));
        }
    });
    console.log(`\n合計: ${overlapCount}件のKMLエントリに複数の局が紐付いている`);

    if (noMatch.length > 0) {
        console.log(`\n=== マッチなし: ${noMatch.length}局 ===`);
        noMatch.forEach(u => console.log(`  Row${u.row} ${u.city} ${u.name}`));
    }

    // Unique KML entries used
    console.log(`\nユニークKMLエントリ使用数: ${kmlUsageCount.size} / ${kmlStations.length}`);
}

deepCheck().catch(console.error);
