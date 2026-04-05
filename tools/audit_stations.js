const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const CSV_FILE = 'c:/Users/keiichi/Workspace/hiroshima-rainfall/県内雨量局.csv';
const EXCEL_FILE = 'c:/Users/keiichi/Workspace/downloads/20260331-uryo.xlsx';

async function audit() {
    console.log('--- Starting Audit ---');
    
    // 1. Load CSV Stations
    const csvContent = fs.readFileSync(CSV_FILE, 'utf8');
    const csvLines = csvContent.split('\n').filter(line => line.trim() !== '');
    const csvStations = csvLines.slice(1).map(line => {
        const [name, city, lat, lon] = line.split(',');
        return { name: name.trim(), city: city.trim() };
    });
    console.log(`CSV Stations: ${csvStations.length}`);

    // 2. Load Excel Stations
    if (!fs.existsSync(EXCEL_FILE)) {
        console.error(`Excel file not found: ${EXCEL_FILE}`);
        return;
    }
    const workbook = XLSX.readFile(EXCEL_FILE);
    const sheet = workbook.Sheets['雨量定時表1'];
    const excelStations = [];
    
    // Scan all rows from 0 to 500
    for (let r = 0; r < 500; r++) {
        const nameCell = sheet[XLSX.utils.encode_cell({r: r, c: 0})];
        const cityCell = sheet[XLSX.utils.encode_cell({r: r, c: 1})];
        
        if (nameCell && nameCell.v && nameCell.v !== '雨量局' && nameCell.v !== '局名') {
            excelStations.push({
                name: nameCell.v.toString().trim(),
                city: cityCell ? cityCell.v.toString().trim() : '',
                row: r + 1
            });
        }
    }
    console.log(`Excel Stations found: ${excelStations.length}`);

    // 3. Compare
    const inExcelOnly = excelStations.filter(es => !csvStations.some(cs => cs.name === es.name));
    const inCsvOnly = csvStations.filter(cs => !excelStations.some(es => es.name === cs.name));

    console.log('\n--- Discrepancies ---');
    console.log(`Excel Only (New Stations): ${inExcelOnly.length}`);
    inExcelOnly.forEach(s => console.log(`  Row ${s.row}: ${s.name} (${s.city})`));

    console.log(`\nCSV Only (Missing in Excel?): ${inCsvOnly.length}`);
    inCsvOnly.forEach(s => console.log(`  ${s.name} (${s.city})`));

    // 4. Detailed Mapping Trace (for Kotobara)
    const kotobara = excelStations.find(s => s.name.includes('小鳥原'));
    if (kotobara) {
        console.log(`\n--- Verification ---`);
        console.log(`小鳥原 found at Excel Row: ${kotobara.row}`);
    }

    console.log('\n--- End Audit ---');
}

audit().catch(console.error);
