import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log("--- PRESTAMOS ---");
    const { data: p } = await supabase.from('prestamos')
        .select('id, deudor_nombre, monto_original, concepto, fecha_prestamo, caja_mov_id')
        .ilike('concepto', '%coca%')
        .eq('fecha_prestamo', '2026-04-23');
    console.log(JSON.stringify(p, null, 2));

    if (p && p.length > 0 && p[0].caja_mov_id) {
        console.log("--- MOVIMIENTO ASOCIADO ---");
        const { data: m } = await supabase.from('caja_movimientos')
            .select('*')
            .eq('id', p[0].caja_mov_id);
        console.log(JSON.stringify(m, null, 2));
    }
}

check();
