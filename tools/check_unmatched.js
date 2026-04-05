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
        const description = p.description ? p.description[0] : '';
        const cityMatch = description.match(/市町名:\s*([^<\n]+)/);
        return { name: p.name[0].trim(), city: cityMatch ? cityMatch[1].trim() : '' };
    });

    const excel = JSON.parse(fs.readFileSync('excel_stations.json', 'utf8'));

    // For each unmatched Excel station, show what KML entries exist in same city
    const unmatchedSample = [
        { city: '北広島町', name: '八幡' },
        { city: '三次市', name: '三次' },
        { city: '庄原市', name: '庄原' },
        { city: '安芸太田町', name: '加計' },
        { city: '安芸太田町', name: '内黒山' },
        { city: '三次市', name: '西野' },
        { city: '庄原市', name: '東城' },
        { city: '福山市', name: '福山' },
        { city: '庄原市', name: '河内' },
        { city: '廿日市市', name: '津田' },
    ];

    unmatchedSample.forEach(e => {
        console.log('Excel: ' + e.city + ' 「' + e.name + '」');
        const cityKml = kmlStations.filter(k => k.city.replace(/\s+/g,'') === e.city.replace(/\s+/g,''));
        const similar = cityKml.filter(k => k.name.includes(e.name) || e.name.includes(k.name));
        if (similar.length > 0) {
            similar.forEach(k => console.log('  KML類似: 「' + k.name + '」'));
        } else {
            console.log('  類似なし, 同市KML(' + cityKml.length + '局): ' + cityKml.slice(0,5).map(k => '「' + k.name + '」').join(', '));
        }
    });
}
run().catch(console.error);
