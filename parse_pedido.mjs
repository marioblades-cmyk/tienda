import * as XLSX from './node_modules/xlsx/xlsx.mjs';
import { readFileSync } from 'fs';

const buf = readFileSync('./pedido_temp.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });

// Check ALL sheets for Boys Met Maria duplicates
console.log('=== BOYS MET MARIA (todos los sheets) ===');
for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    data.forEach((row, i) => {
        const rowStr = row.join(' ').toLowerCase();
        if (rowStr.includes('boy') && rowStr.includes('maria')) {
            console.log(`[${sheetName}] R${i}:`, JSON.stringify(row));
        }
    });
}

// Show ALL rows with qty > 0 in Otras sheet
console.log('\n=== OTRAS SHEET - TODOS LOS ITEMS CON CANTIDAD > 0 ===');
const ws2 = wb.Sheets['Otras'];
const data2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' });
data2.forEach((row, i) => {
    // Find rows where qty column (index 4) is > 0
    if (row.length >= 5 && typeof row[4] === 'number' && row[4] > 0) {
        console.log(`R${i}:`, JSON.stringify(row));
    }
});

// Show ALL rows with qty > 0 in Planeta sheet
console.log('\n=== PLANETA SHEET - TODOS LOS ITEMS CON CANTIDAD > 0 ===');
const wsPl = wb.Sheets['Planeta'];
const dataPl = XLSX.utils.sheet_to_json(wsPl, { header: 1, defval: '' });
dataPl.forEach((row, i) => {
    if (row.length >= 4 && typeof row[3] === 'number' && row[3] > 0) {
        console.log(`R${i}:`, JSON.stringify(row));
    }
});

// Show ALL rows with qty > 0 in Ivrea sheet
console.log('\n=== IVREA SHEET - TODOS LOS ITEMS CON CANTIDAD > 0 ===');
const wsIv = wb.Sheets['Ivrea'];
const dataIv = XLSX.utils.sheet_to_json(wsIv, { header: 1, defval: '' });
dataIv.forEach((row, i) => {
    if (row.length >= 4 && typeof row[3] === 'number' && row[3] > 0) {
        console.log(`R${i}:`, JSON.stringify(row));
    }
});
