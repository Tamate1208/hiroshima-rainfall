// Check if the 4 remaining duplicates exist in KML itself with same coordinates
const fs = require('fs');
const iconv = require('iconv-lite');
const xml2js = require('xml2js');

async function run() {
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
            lat: parseFloat(coords[1]),
            coordKey: parseFloat(coords[1]).toFixed(6) + ',' + parseFloat(coords[0]).toFixed(6)
        };
    });

    const dupes = ['玖島', '楢原', '白木', '仁賀', '西野'];
    dupes.forEach(name => {
        const hits = kmlStations.filter(k => k.name.includes(name));
        if (hits.length > 0) {
            hits.forEach(h => console.log(`KML: ${h.city} 「${h.name}」 → (${h.lat}, ${h.lon})`));
        }
    });
}
run().catch(console.error);
