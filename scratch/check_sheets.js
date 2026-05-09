const XLSX = require('xlsx');
const path = require('path');

const file = path.join(__dirname, '..', 'temp_downloads', '20260409-uryo.xlsx');
try {
    const workbook = XLSX.readFile(file);
    console.log('Sheets in 20260409-uryo.xlsx:');
    console.log(workbook.SheetNames);
} catch (e) {
    console.error('Error reading file:', e.message);
}
