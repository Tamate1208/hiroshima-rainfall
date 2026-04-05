const XLSX = require('xlsx');
const fs = require('fs');

async function extractStations() {
    const workbook = XLSX.readFile('c:/Users/keiichi/Workspace/20260314-uryo.xlsx');
    const sheet = workbook.Sheets['雨量定時表1']; // Use the first data sheet
    
    const stations = [];
    // Based on VBA: Rows 4 to 408 (1-indexed)
    // sheet['A4'] etc.
    for (let i = 4; i <= 408; i++) {
        const nameCell = sheet['A' + i];
        const cityCell = sheet['B' + i];
        
        if (nameCell && nameCell.v) {
            stations.push({
                Row: i,
                Name: nameCell.v.toString().trim(),
                City: cityCell ? cityCell.v.toString().trim() : ''
            });
        }
    }
    
    fs.writeFileSync('c:/Users/keiichi/Workspace/hiroshima-rainfall/excel_stations.json', JSON.stringify(stations, null, 2));
    console.log(`Extracted ${stations.length} stations.`);
}

extractStations().catch(console.error);
