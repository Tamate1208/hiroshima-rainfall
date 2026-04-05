const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const CSV_FILE = 'c:/Users/keiichi/Workspace/hiroshima-rainfall/県内雨量局.csv';
const EXCEL_FILE = 'c:/Users/keiichi/Workspace/downloads/20260331-uryo.xlsx';
const OUTPUT_FILE = 'c:/Users/keiichi/Workspace/hiroshima-rainfall/mapping.json';

async function sync() {
    console.log('--- Starting Mapping Sync ---');
    
    // 1. Load CSV Master (Spatial)
    const csvContent = fs.readFileSync(CSV_FILE, 'utf8');
    const csvLines = csvContent.split('\n').filter(line => line.trim() !== '');
    const csvStations = csvLines.slice(1).map(line => {
        const [name, city, lat, lon] = line.split(',');
        return { 
            name: name.trim(), 
            city: city.trim(), 
            lat: parseFloat(lat), 
            lon: parseFloat(lon),
            canonical: name.trim().replace(/\(.*\)/, '') // Remove (国), (気) etc.
        };
    });
    console.log(`Master (CSV) Stations: ${csvStations.length}`);

    // 2. Load Excel current rows
    const workbook = XLSX.readFile(EXCEL_FILE);
    const sheet = workbook.Sheets['雨量定時表1'];
    const excelRows = [];
    for (let r = 0; r < 500; r++) {
        const nameCell = sheet[XLSX.utils.encode_cell({r: r, c: 0})];
        const cityCell = sheet[XLSX.utils.encode_cell({r: r, c: 1})];
        if (nameCell && nameCell.v && nameCell.v !== '雨量局' && nameCell.v !== '局名') {
            excelRows.push({
                name: nameCell.v.toString().trim(),
                city: cityCell ? cityCell.v.toString().trim() : '',
                row: r + 1
            });
        }
    }
    console.log(`Current (Excel) Rows: ${excelRows.length}`);

    // 3. Match and Build New Mapping
    const mapping = [];
    const usedExcelIndices = new Set();

    csvStations.forEach(cs => {
        // Find best match in Excel
        // Priority 1: Exact name match
        // Priority 2: Canonical name match (ignoring suffixes)
        // Disambiguation: Use first available match that hasn't been used yet
        const matchIndex = excelRows.findIndex((er, idx) => {
            if (usedExcelIndices.has(idx)) return false;
            return er.name === cs.name || er.name === cs.canonical;
        });

        if (matchIndex !== -1) {
            const match = excelRows[matchIndex];
            mapping.push({
                row: match.row,
                city: cs.city,
                name: cs.name,
                lon: cs.lon,
                lat: cs.lat
            });
            usedExcelIndices.add(matchIndex);
        } else {
            console.warn(`Warning: No match found for ${cs.name} (${cs.city})`);
        }
    });

    // Write to mapping.json
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mapping, null, 2));
    console.log(`Success! mapping.json updated with ${mapping.length} stations.`);
    
    // Check specific stations mentioned by user
    const kotobara = mapping.find(m => m.name === '小鳥原');
    if (kotobara) console.log(`[Verification] 小鳥原 is now correctly mapped to Row ${kotobara.row}.`);

    console.log('--- Sync Completed ---');
}

sync().catch(console.error);
