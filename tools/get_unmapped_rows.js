const fs = require('fs');
const stations = JSON.parse(fs.readFileSync('c:/Users/keiichi/Workspace/hiroshima-rainfall/excel_stations.json', 'utf8'));

const unmappedNames = [
    { city: '廿日市市', name: '冠山' },
    { city: '廿日市市', name: '渡ノ瀬ダム' },
    { city: '廿日市市', name: '中村' },
    { city: '安芸太田町', name: '立岩ダム' },
    { city: '安芸太田町', name: '田代' },
    { city: '安芸太田町', name: '柴木川ダム' },
    { city: '北広島町', name: '樽床ダム' },
    { city: '北広島町', name: '王泊ダム' },
    { city: '庄原市', name: '畑' }
];

const results = unmappedNames.map(target => {
    const found = stations.find(s => s.City === target.city && s.Name === target.name);
    return found ? { row: found.Row, city: found.City, name: found.Name } : { error: 'Not found', target };
});

console.log(JSON.stringify(results, null, 2));
