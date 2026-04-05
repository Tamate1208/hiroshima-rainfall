const fs = require('fs');
const mappingPath = 'c:/Users/keiichi/Workspace/hiroshima-rainfall/mapping.json';
const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

const manualData = [
    { row: 11, city: '廿日市市', name: '冠山', lat: 34.436196, lon: 132.078269 },
    { row: 24, city: '廿日市市', name: '渡ノ瀬ダム', lat: 34.31861, lon: 132.20639 },
    { row: 35, city: '廿日市市', name: '中村', lat: 34.498472, lon: 132.143889 },
    { row: 148, city: '安芸太田町', name: '立岩ダム', lat: 34.54444, lon: 132.16389 },
    { row: 149, city: '安芸太田町', name: '田代', lat: 34.595679, lon: 132.146605 },
    { row: 156, city: '安芸太田町', name: '柴木川ダム', lat: 34.5961, lon: 132.2153 },
    { row: 170, city: '北広島町', name: '樽床ダム', lat: 34.651389, lon: 132.169167 },
    { row: 179, city: '北広島町', name: '王泊ダム', lat: 34.698333, lon: 132.313611 },
    { row: 326, city: '庄原市', name: '畑', lat: 34.782222, lon: 133.066389 }
];

manualData.forEach(item => {
    // Check if already mapped (just in case)
    const exists = mapping.some(m => m.row === item.row);
    if (!exists) {
        mapping.push(item);
        console.log(`Added manually: ${item.city} ${item.name}`);
    } else {
        console.log(`Already exists: ${item.city} ${item.name}`);
    }
});

// Sort by Row for consistency
mapping.sort((a, b) => a.row - b.row);

fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
console.log('Update complete.');
