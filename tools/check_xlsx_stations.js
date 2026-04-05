const XLSX = require('xlsx');

const workbook = XLSX.readFile('c:/Users/keiichi/Workspace/downloads/20210812-uryo.xlsx');
console.log('Sheets:', workbook.SheetNames);

// Use the same sheet as extract_stations.js
const sheetName = workbook.SheetNames.includes('雨量定時表1') ? '雨量定時表1' : workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
console.log('Using sheet:', sheetName);

const stations = [];
for (let i = 4; i <= 408; i++) {
    const nameCell = sheet['A' + i];
    const cityCell = sheet['B' + i];
    if (nameCell && nameCell.v) {
        stations.push({
            row: i,
            name: nameCell.v.toString().trim(),
            city: cityCell ? cityCell.v.toString().trim() : ''
        });
    }
}

console.log(`\nTotal stations: ${stations.length}`);

// Check for duplicates (same city + name)
const seen = new Map();
const duplicates = [];

stations.forEach(s => {
    const key = `${s.city}__${s.name}`;
    if (seen.has(key)) {
        duplicates.push({ city: s.city, name: s.name, rows: [seen.get(key), s.row] });
    } else {
        seen.set(key, s.row);
    }
});

if (duplicates.length === 0) {
    console.log('\n観測局名（自治体+局名）の重複: なし ✓');
} else {
    console.log(`\n重複あり: ${duplicates.length}件`);
    duplicates.forEach(d => {
        console.log(`  ${d.city} ${d.name} - Row: ${d.rows.join(', ')}`);
    });
}

// Also check name-only duplicates
console.log('\n--- 局名のみで重複チェック ---');
const nameSeen = new Map();
const nameDups = [];
stations.forEach(s => {
    if (nameSeen.has(s.name)) {
        nameDups.push({ name: s.name, entries: [...nameSeen.get(s.name), { city: s.city, row: s.row }] });
        nameSeen.get(s.name).push({ city: s.city, row: s.row });
    } else {
        nameSeen.set(s.name, [{ city: s.city, row: s.row }]);
    }
});
if (nameDups.length === 0) {
    console.log('局名のみでも重複なし ✓');
} else {
    console.log(`局名のみで重複: ${nameDups.length}件`);
    nameDups.slice(0, 20).forEach(d => {
        const entries = nameSeen.get(d.name).map(e => `${e.city}(行${e.row})`).join(', ');
        console.log(`  「${d.name}」: ${entries}`);
    });
}
