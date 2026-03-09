import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '12 Comic manga bolivia 28-2.xlsx');
try {
    const workbook = xlsx.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    console.log("=== EXCEL STRUCTURE ANALYSIS ===");
    console.log("Sheet Name:", firstSheetName);
    console.log("Total Rows:", data.length);

    let headerRow = null;
    let firstDataRow = null;

    for (let i = 0; i < Math.min(10, data.length); i++) {
        const row = data[i];
        if (row && row.length > 0) {
            console.log(`Row ${i + 1}:`, row);
            if (!headerRow && row.length > 3) {
                headerRow = row;
            } else if (headerRow && !firstDataRow) {
                firstDataRow = row;
            }
        }
    }

    console.log("\nAssumed Headers:", headerRow);
    console.log("First Data Row:", firstDataRow);

} catch (err) {
    console.error("Error reading excel:", err);
}
