const XLSX = require('xlsx');
const fs = require('fs');
const iconv = require('iconv-lite');
const xml2js = require('xml2js');

async function mapStations() {
    // 1. KMLを読み込む（正とするデータ）
    const kmlBuffer = fs.readFileSync('c:/Users/keiichi/Workspace/雨量/RainfallStations.kml');
    const kmlText = iconv.decode(kmlBuffer, 'Shift_JIS');
    const parser = new xml2js.Parser();
    const kmlObj = await parser.parseStringPromise(kmlText);
    const placemarks = kmlObj.kml.Document[0].Placemark;

    const kmlStations = placemarks.map(p => {
        const coords = p.Point[0].coordinates[0].trim().split(',');
        const description = p.description ? p.description[0] : '';
        const cityMatch = description.match(/市町名:\s*([^<\n]+)/);
        return {
            name: p.name[0].trim(),
            city: cityMatch ? cityMatch[1].trim() : '',
            lon: parseFloat(coords[0]),
            lat: parseFloat(coords[1])
        };
    });

    // 2. Excelを読み込む（row番号を取得するため）
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

    // 3. KMLを正として、各KML局に対応するExcel行を完全一致で探す
    const mapping = [];
    const unmapped = [];

    kmlStations.forEach(k => {
        const kName = k.name.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
        const kCity = k.city.replace(/\s+/g, '');

        const match = xlsxStations.find(e => {
            const eName = e.name.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
            const eCity = e.city.replace(/\s+/g, '');
            return eCity === kCity && eName === kName;
        });

        if (match) {
            mapping.push({
                row: match.row,
                city: k.city,
                name: k.name,
                lon: k.lon,
                lat: k.lat
            });
        } else {
            unmapped.push(`${k.city} ${k.name}`);
        }
    });

    fs.writeFileSync('c:/Users/keiichi/Workspace/hiroshima-rainfall/mapping.json', JSON.stringify(mapping, null, 2));
    console.log(`Mapped ${mapping.length} stations. Unmapped: ${unmapped.length}`);
    if (unmapped.length > 0) {
        console.log('Unmapped:', unmapped.join(', '));
    }
}

mapStations().catch(console.error);
