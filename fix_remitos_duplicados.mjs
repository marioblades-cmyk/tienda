import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://lbraboujrajvzosmddtu.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'
);

function getSufijo(nombre) {
    const m = (nombre || '').match(/\(([^)]+)\)\s*$/);
    return m ? m[1].trim().toLowerCase() : '';
}

async function fix() {
    const { data, error } = await supabase.from('app_state').select('data').eq('id', 'remitos').maybeSingle();
    if (error) { console.error('Error:', error); return; }

    const rows = Array.isArray(data?.data) ? data.data : (data?.data?.rows || []);
    console.log(`Filas antes: ${rows.length}`);

    const vistos = new Map();
    const eliminados = [];
    const limpias = rows.filter((r, i) => {
        const s = getSufijo(r.pedido || '');
        if (!s) return true;
        if (vistos.has(s)) {
            eliminados.push({ i, nro: r.nro, pedido: r.pedido });
            return false;
        }
        vistos.set(s, i);
        return true;
    });

    if (eliminados.length === 0) { console.log('Sin duplicados.'); return; }

    console.log(`\nEliminando ${eliminados.length} duplicado(s):`);
    eliminados.forEach(e => console.log(`  nro=${e.nro} "${e.pedido}"`));

    const { error: saveErr } = await supabase.from('app_state').upsert({ id: 'remitos', data: limpias });
    if (saveErr) console.error('Error guardando:', saveErr);
    else console.log(`\n✅ Listo. Filas después: ${limpias.length}`);
}

fix();
