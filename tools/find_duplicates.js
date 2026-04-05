const fs = require('fs');
const mapping = JSON.parse(fs.readFileSync('c:/Users/keiichi/Workspace/hiroshima-rainfall/mapping.json', 'utf8'));

const coordMap = new Map();

mapping.forEach(station => {
    const key = `${station.lat},${station.lon}`;
    if (!coordMap.has(key)) {
        coordMap.set(key, []);
    }
    coordMap.get(key).push(`${station.city} ${station.name} (Row: ${station.row})`);
});

const duplicates = [];
for (const [coord, stations] of coordMap.entries()) {
    if (stations.length > 1) {
        duplicates.push({
            coordinates: coord,
            stations: stations
        });
    }
}

console.log(JSON.stringify(duplicates, null, 2));
