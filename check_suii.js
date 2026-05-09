const XLSX = require('xlsx');
const fs = require('fs');

try {
    const wb = XLSX.readFile('temp_downloads/20260411-suii.xlsx');
    const sheet = wb.Sheets['水位定時表1'];
    
    // 行1〜4の、A〜L列までのセルの値をコンソールに出力する
    for (let r = 0; r < 4; r++) {
        const rowData = [];
        for (let c = 0; c < 12; c++) {
            const cell = sheet[XLSX.utils.encode_cell({r, c})];
            rowData.push(cell ? cell.v : '');
        }
        console.log(`Row ${r+1}:`, rowData.join(' | '));
    }
} catch (e) {
    console.error('エラー:', e.message);
}
