// fix_dist_duplicados.mjs
// Limpia entradas duplicadas en app_state.distribuidor.pedidos
// Mantiene la PRIMERA ocurrencia de cada nombre (la más antigua = la que tiene pagos asignados)
// Ejecutar: node fix_dist_duplicados.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lbraboujrajvzosmddtu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fixDuplicados() {
    // 1. Leer estado actual
    const { data, error } = await supabase
        .from('app_state')
        .select('data')
        .eq('id', 'distribuidor')
        .maybeSingle();

    if (error) { console.error('Error leyendo app_state:', error); return; }
    if (!data?.data) { console.log('No hay datos en app_state.distribuidor'); return; }

    const distData = data.data;
    const pedidosAntes = distData.pedidos || [];

    console.log(`\n=== PEDIDOS ACTUALES (${pedidosAntes.length} entradas) ===`);
    pedidosAntes.forEach((p, i) => console.log(`  [${i}] ${p.nombre} → ARS ${p.monto}`));

    // 2. Deduplicar: mantener solo la PRIMERA aparición de cada nombre
    const vistos = new Set();
    const duplicados = [];
    const pedidosLimpios = pedidosAntes.filter((p, i) => {
        const key = (p.nombre || '').trim().toLowerCase();
        if (vistos.has(key)) {
            duplicados.push({ idx: i, nombre: p.nombre, monto: p.monto });
            return false;
        }
        vistos.add(key);
        return true;
    });

    if (duplicados.length === 0) {
        console.log('\n✅ No hay duplicados. No se necesita corrección.');
        return;
    }

    console.log(`\n⚠️  DUPLICADOS ENCONTRADOS (${duplicados.length}):`);
    duplicados.forEach(d => console.log(`  → [${d.idx}] "${d.nombre}" ARS ${d.monto}`));

    console.log(`\n✅ PEDIDOS DESPUÉS DE LIMPIAR (${pedidosLimpios.length} entradas):`);
    pedidosLimpios.forEach((p, i) => console.log(`  [${i}] ${p.nombre} → ARS ${p.monto}`));

    // 3. Guardar datos limpios
    const newDistData = { ...distData, pedidos: pedidosLimpios };
    const { error: saveError } = await supabase
        .from('app_state')
        .upsert({ id: 'distribuidor', data: newDistData });

    if (saveError) {
        console.error('\n❌ Error al guardar:', saveError);
    } else {
        console.log(`\n✅ Datos corregidos. Se eliminaron ${duplicados.length} duplicado(s).`);
        console.log('ℹ️  IMPORTANTE: Abrí Gestión Integral > Distribuidor y hacé clic en "Sincronizar" para que los remitos queden alineados.');
    }
}

fixDuplicados();
