const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://lbraboujrajvzosmddtu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runRestore() {
    const backupDir = 'backups/backup_2026-04-30_17-09';
    const catalogFile = path.join(backupDir, 'catalogo_productos.json');
    
    console.log('🚀 Iniciando restauración de emergencia...');
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    console.log(`📦 Encontrados ${catalog.length} productos en el backup.`);

    const CHUNK = 200;
    let restored = 0;

    for (let i = 0; i < catalog.length; i += CHUNK) {
        const chunk = catalog.slice(i, i + CHUNK).map(p => ({
            id: p.id,
            product_id: p.product_id,
            titulo: p.titulo,
            stock_fisico: p.stock_fisico || 0,
            stock_minimo: p.stock_minimo || 0,
            precio_tapa: p.precio_tapa || 0,
            precio_venta_bs: p.precio_venta_bs || 0,
            editorial: p.editorial || 'Desconocida',
            updated_at: new Date().toISOString()
        }));

        const { error } = await supabase
            .from('catalogo_productos')
            .upsert(chunk, { onConflict: 'id' });

        if (error) {
            console.error(`❌ Error en bloque ${i}:`, error.message);
        } else {
            restored += chunk.length;
            process.stdout.write(`\r✅ Procesados: ${restored}/${catalog.length}`);
        }
    }

    console.log('\n\n✨ RESTAURACIÓN COMPLETADA.');
    console.log('🔗 Los productos vuelven a estar en la base de datos.');
}

runRestore();
