// fix_dist_duplicados2.mjs
// Segunda pasada: detecta entradas con el mismo sufijo de semana "(SEMANA X)" y elimina duplicados
// Ejecutar: node fix_dist_duplicados2.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lbraboujrajvzosmddtu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Extrae el sufijo de semana: todo lo que está entre el último "(" y ")"
// Ej: "24 MANGAS_... (ENTELEQUIA DISTRIBUCIÓN 23 15-5)" → "entelequia distribución 23 15-5"
function getSufijo(nombre) {
    const m = (nombre || '').match(/\(([^)]+)\)\s*$/);
    return m ? m[1].trim().toLowerCase() : '';
}

async function fixDuplicadosSufijo() {
    const { data, error } = await supabase
        .from('app_state')
        .select('data')
        .eq('id', 'distribuidor')
        .maybeSingle();

    if (error) { console.error('Error leyendo app_state:', error); return; }
    if (!data?.data) { console.log('No hay datos.'); return; }

    const distData = data.data;
    const pedidosAntes = distData.pedidos || [];

    console.log(`\n=== PEDIDOS ACTUALES (${pedidosAntes.length} entradas) ===`);
    pedidosAntes.forEach((p, i) => console.log(`  [${i}] "${p.nombre}" → ARS ${p.monto}`));

    // Deduplicar por sufijo de semana: mantener la PRIMERA aparición
    const vistosPosSufijo = new Set();
    const duplicados = [];
    const pedidosLimpios = pedidosAntes.filter((p, i) => {
        const sufijo = getSufijo(p.nombre);
        if (!sufijo) return true; // Sin sufijo, no toca
        if (vistosPosSufijo.has(sufijo)) {
            duplicados.push({ idx: i, nombre: p.nombre, monto: p.monto });
            return false;
        }
        vistosPosSufijo.add(sufijo);
        return true;
    });

    if (duplicados.length === 0) {
        console.log('\n✅ No se encontraron más duplicados por sufijo de semana.');
        return;
    }

    console.log(`\n⚠️  DUPLICADOS A ELIMINAR (${duplicados.length}):`);
    duplicados.forEach(d => console.log(`  → [${d.idx}] "${d.nombre}" ARS ${d.monto}`));

    console.log(`\n✅ RESULTADO FINAL (${pedidosLimpios.length} entradas):`);
    pedidosLimpios.forEach((p, i) => console.log(`  [${i}] "${p.nombre}" → ARS ${p.monto}`));

    const newDistData = { ...distData, pedidos: pedidosLimpios };
    const { error: saveError } = await supabase
        .from('app_state')
        .upsert({ id: 'distribuidor', data: newDistData });

    if (saveError) {
        console.error('\n❌ Error al guardar:', saveError);
    } else {
        console.log(`\n✅ Listo. Se eliminaron ${duplicados.length} duplicado(s) adicional(es).`);
    }
}

fixDuplicadosSufijo();
