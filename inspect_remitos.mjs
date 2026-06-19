// inspect_remitos.mjs — Solo lectura, no modifica nada
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://lbraboujrajvzosmddtu.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'
);

function getSufijo(nombre) {
    const m = (nombre || '').match(/\(([^)]+)\)\s*$/);
    return m ? m[1].trim().toLowerCase() : '';
}

async function inspect() {
    const { data } = await supabase.from('app_state').select('data').eq('id', 'remitos').maybeSingle();
    const rows = Array.isArray(data?.data) ? data.data : (data?.data?.rows || []);

    console.log(`\n=== REMITOS ACTUALES (${rows.length} filas) ===\n`);
    rows.forEach((r, i) => {
        const sufijo = getSufijo(r.pedido || '');
        const tieneData = parseFloat(r.compre) > 0 || parseFloat(r.cambio) > 0 || parseFloat(r.kg) > 0 || parseFloat(r.tc_dist) > 0;
        console.log(`[${i}] nro=${r.nro} | pedido="${r.pedido || '—'}" | sufijo="${sufijo}" | tieneData=${tieneData} | compre=${r.compre} cambio=${r.cambio} tc=${r.tc_dist}`);
    });

    // Detectar duplicados por sufijo de semana
    const vistosS = new Map(); // sufijo → primer índice
    const duplicados = [];
    rows.forEach((r, i) => {
        const s = getSufijo(r.pedido || '');
        if (!s) return;
        if (vistosS.has(s)) {
            duplicados.push({ idx: i, row: r, primeraIdx: vistosS.get(s) });
        } else {
            vistosS.set(s, i);
        }
    });

    if (duplicados.length === 0) {
        console.log('\n✅ No se detectaron duplicados en remitos.');
    } else {
        console.log(`\n⚠️  DUPLICADOS DETECTADOS (${duplicados.length}):`);
        duplicados.forEach(d => {
            const tieneData = parseFloat(d.row.compre) > 0 || parseFloat(d.row.cambio) > 0 || parseFloat(d.row.kg) > 0 || parseFloat(d.row.tc_dist) > 0;
            console.log(`  → [${d.idx}] nro=${d.row.nro} "${d.row.pedido}" (duplicado de idx=${d.primeraIdx}) | tieneData=${tieneData}`);
        });
    }
}

inspect();
