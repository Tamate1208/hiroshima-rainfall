const fs = require('fs');
const mapping = JSON.parse(fs.readFileSync('c:/Users/keiichi/Workspace/hiroshima-rainfall/mapping.json', 'utf8'));

console.log(`Total stations in mapping.json: ${mapping.length}`);

const threshold = 0.0001; // ~10m
const nearDuplicates = [];

for (let i = 0; i < mapping.length; i++) {
    for (let j = i + 1; j < mapping.length; j++) {
        const s1 = mapping[i];
        const s2 = mapping[j];
        const dLat = Math.abs(s1.lat - s2.lat);
        const dLon = Math.abs(s1.lon - s2.lon);
        
        if (dLat < threshold && dLon < threshold) {
            nearDuplicates.push({
                dist: Math.sqrt(dLat*dLat + dLon*dLon),
                s1: `${s1.city} ${s1.name} (Row: ${s1.row}) @ ${s1.lat},${s1.lon}`,
                s2: `${s2.city} ${s2.name} (Row: ${s2.row}) @ ${s2.lat},${s2.lon}`
            });
        }
    }
}

if (nearDuplicates.length > 0) {
    console.log(`Found ${nearDuplicates.length} near duplicates (within ${threshold} deg):`);
    nearDuplicates.sort((a, b) => a.dist - b.dist).forEach(d => {
        console.log(`- ${d.s1}\n  ${d.s2}\n  (diff: ${d.dist.toFixed(6)})`);
    });
} else {
    console.log(`No near duplicates found within ${threshold} degrees.`);
}
