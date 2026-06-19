const XLSX = require('./node_modules/xlsx');
const path = require('path');

const filePath = "C:\\Users\\USUARIO\\Downloads\\PEDIDO_CONSOLIDADO_ENTELEQUIA DISTRIBUCIÓN 23 15-5_ENTELEQUIA DISTRIBUCIÓN 15-5' contigo.xlsx";
const wb = XLSX.readFile(filePath);
console.log('Sheets:', wb.SheetNames);

wb.SheetNames.forEach(sheetName => {
    console.log('\n=== SHEET:', sheetName, '===');
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    data.forEach((row, i) => {
        if (row.some(c => c !== '')) {
            console.log('R' + i + ':', JSON.stringify(row));
        }
    });
});
