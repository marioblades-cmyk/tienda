/**
 * BACKUP SCRIPT — Exporta las tablas críticas de Supabase a JSON local.
 * Ejecutar con: node backup_db.cjs
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://lbraboujrajvzosmddtu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Timestamp para el nombre de la carpeta de backup
const now = new Date();
const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
const backupDir = path.join(__dirname, 'backups', `backup_${ts}`);
fs.mkdirSync(backupDir, { recursive: true });

// Función auxiliar para descargar UNA tabla completa (paginado)
async function downloadTable(tableName, selectCols = '*', extraInfo = '') {
    console.log(`\n📥 Descargando: ${tableName} ${extraInfo}...`);
    let allRows = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
        const { data, error } = await supabase
            .from(tableName)
            .select(selectCols)
            .range(from, from + pageSize - 1);

        if (error) {
            console.error(`  ❌ Error en ${tableName}:`, error.message);
            break;
        }
        if (!data || data.length === 0) break;

        allRows = allRows.concat(data);
        console.log(`  ✅ Página: ${from}–${from + data.length - 1} (total acum: ${allRows.length})`);

        if (data.length < pageSize) break; // última página
        from += pageSize;
    }

    return allRows;
}

async function runBackup() {
    console.log('='.repeat(60));
    console.log('🔒 BACKUP DE BASE DE DATOS — TIENDA');
    console.log(`📅 Fecha: ${now.toLocaleString('es-AR')}`);
    console.log(`📁 Destino: ${backupDir}`);
    console.log('='.repeat(60));

    const TABLES = [
        // Tablas CRÍTICAS para recepción y stock
        { name: 'catalogo_productos',        cols: 'id,product_id,titulo,stock_fisico,stock_minimo,precio_tapa,precio_venta_bs,editorial,updated_at', label: '📦 Catálogo (stock_fisico)' },
        { name: 'pedido_items_recepcion',    cols: '*', label: '📋 Recepciones registradas' },
        { name: 'cliente_items',             cols: '*', label: '👤 Items de clientes (estados)' },
        { name: 'app_state',                 cols: '*', label: '⚙️  App state (reception_delta)' },
        // Tablas de contexto para reconstruir si es necesario
        { name: 'semanas',                   cols: '*', label: '📅 Semanas' },
        { name: 'pedidos',                   cols: '*', label: '📄 Pedidos' },
        { name: 'pedido_items',              cols: '*', label: '📄 Items de pedidos' },
        { name: 'clientes',                  cols: 'id,nombre,vendedor_id', label: '🧑 Clientes' },
        { name: 'stock_movimientos',         cols: '*', label: '📊 Historial de movimientos' },
    ];

    const manifest = {
        generatedAt: now.toISOString(),
        tables: {}
    };

    for (const t of TABLES) {
        const rows = await downloadTable(t.name, t.cols, t.label);
        const filePath = path.join(backupDir, `${t.name}.json`);
        fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
        manifest.tables[t.name] = {
            rowCount: rows.length,
            file: `${t.name}.json`,
            label: t.label
        };
        console.log(`  💾 Guardado: ${t.name}.json (${rows.length} filas)`);
    }

    // Guardar manifiesto
    fs.writeFileSync(path.join(backupDir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    console.log('\n' + '='.repeat(60));
    console.log('✅ BACKUP COMPLETADO');
    console.log(`📁 Carpeta: ${backupDir}`);
    console.log('\n📋 Resumen:');
    for (const [t, info] of Object.entries(manifest.tables)) {
        console.log(`   ${info.label}: ${info.rowCount} filas`);
    }
    console.log('\n🛡️  Para restaurar el stock, usá los datos de catalogo_productos.json');
    console.log('   (columnas: id, titulo, stock_fisico, updated_at)');
    console.log('='.repeat(60));
}

runBackup().catch(err => {
    console.error('\n❌ ERROR FATAL EN BACKUP:', err);
    process.exit(1);
});
