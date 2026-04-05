// Show side-by-side: for each KML station, what is the corresponding Excel entry?
// Group by city, then compare names directly
const XLSX = require('xlsx');
const fs = require('fs');
const iconv = require('iconv-lite');
const xml2js = require('xml2js');

async function run() {
    // Read KML
    const kmlBuffer = fs.readFileSync('c:/Users/keiichi/Workspace/雨量/RainfallStations.kml');
    const kmlText = iconv.decode(kmlBuffer, 'Shift_JIS');
    const parser = new xml2js.Parser();
    const kmlObj = await parser.parseStringPromise(kmlText);
    const placemarks = kmlObj.kml.Document[0].Placemark;
    const kmlStations = placemarks.map((p, i) => {
        const description = p.description ? p.description[0] : '';
        const cityMatch = description.match(/市町名:\s*([^<\n]+)/);
        const coords = p.Point[0].coordinates[0].trim().split(',');
        return {
            kmlIdx: i,
            name: p.name[0].trim(),
            city: cityMatch ? cityMatch[1].trim() : '',
            lon: parseFloat(coords[0]),
            lat: parseFloat(coords[1])
        };
    });

    // Read ACTUAL rainfall excel (20210812-uryo.xlsx) which has the city column too
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

    // For each KML station, find Excel exact match and near-miss
    const mismatches = [];
    kmlStations.forEach(k => {
        const kName = k.name.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
        const kCity = k.city.replace(/\s+/g, '');

        const exact = xlsxStations.find(e => {
            const eName = e.name.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
            return e.city.replace(/\s+/g, '') === kCity && eName === kName;
        });

        if (!exact) {
            // Find closest (same city, name contains or is contained)
            const sameCityXlsx = xlsxStations.filter(e => e.city.replace(/\s+/g, '') === kCity);
            const near = sameCityXlsx.filter(e => {
                const eName = e.name.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
                return eName.includes(kName) || kName.includes(eName);
            });
            mismatches.push({
                kmlCity: k.city,
                kmlName: k.name,
                xlsxNear: near.map(e => e.city + ' 「' + e.name + '」').join(', ') || 'なし'
            });
        }
    });

    console.log('KMLにあるがExcel完全一致なし: ' + mismatches.length + '件\n');
    mismatches.forEach(m => {
        console.log('KML: ' + m.kmlCity + ' 「' + m.kmlName + '」 → Excel近似: ' + m.xlsxNear);
    });
}
run().catch(console.error);
