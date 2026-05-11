/**
 * RESTORE SCRIPT — Restaura el stock_fisico del catálogo desde un backup JSON.
 * 
 * USO:
 *   node restore_stock.cjs backups/backup_2026-04-30_12-43
 *
 * IMPORTANTE: Solo restaura stock_fisico, no sobreescribe otros campos del catálogo.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SUPABASE_URL = 'https://lbraboujrajvzosmddtu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function askConfirm(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim().toLowerCase()); }));
}

async function runRestore() {
    const backupDir = process.argv[2];

    if (!backupDir) {
        console.error('❌ Falta argumento: node restore_stock.cjs <ruta-del-backup>');
        console.error('   Ejemplo: node restore_stock.cjs backups/backup_2026-04-30_12-43');
        process.exit(1);
    }

    const catalogFile = path.join(backupDir, 'catalogo_productos.json');
    if (!fs.existsSync(catalogFile)) {
        console.error(`❌ No se encontró: ${catalogFile}`);
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, '_manifest.json'), 'utf8'));
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));

    console.log('='.repeat(60));
    console.log('⚠️  RESTAURACIÓN DE STOCK — TIENDA');
    console.log(`📅 Backup generado: ${manifest.generatedAt}`);
    console.log(`📦 Productos a restaurar: ${catalog.length}`);
    const conStock = catalog.filter(p => p.stock_fisico > 0).length;
    const totalUnid = catalog.reduce((s, p) => s + (p.stock_fisico || 0), 0);
    console.log(`   - Con stock > 0: ${conStock} productos`);
    console.log(`   - Total unidades: ${totalUnid}`);
    console.log('='.repeat(60));
    console.log('');
    console.log('⚠️  ADVERTENCIA: Esto sobreescribirá el stock_fisico actual en la BD.');
    console.log('');

    const ans = await askConfirm('¿Confirmas la restauración? Escribí "SI" para continuar: ');
    if (ans !== 'si') {
        console.log('❌ Restauración cancelada.');
        process.exit(0);
    }

    console.log('\n🔄 Restaurando stock...');

    // Solo restauramos id + stock_fisico para no pisar otros datos
    const payload = catalog.map(p => ({
        id: p.id,
        stock_fisico: p.stock_fisico ?? 0,
        updated_at: new Date().toISOString()
    }));

    const CHUNK = 500;
    let restored = 0;
    for (let i = 0; i < payload.length; i += CHUNK) {
        const chunk = payload.slice(i, i + CHUNK);
        const { error } = await supabase
            .from('catalogo_productos')
            .upsert(chunk, { onConflict: 'id' });

        if (error) {
            console.error(`❌ Error en chunk ${i}-${i+CHUNK}:`, error.message);
            process.exit(1);
        }
        restored += chunk.length;
        process.stdout.write(`\r   ✅ ${restored}/${payload.length} productos restaurados...`);
    }

    console.log('\n');
    console.log('='.repeat(60));
    console.log(`✅ RESTAURACIÓN COMPLETADA — ${restored} productos actualizados`);
    console.log('💡 Recordá limpiar la caché del browser para que la app lea el stock nuevo.');
    console.log('='.repeat(60));
}

runRestore().catch(err => {
    console.error('\n❌ ERROR FATAL EN RESTAURACIÓN:', err);
    process.exit(1);
});
