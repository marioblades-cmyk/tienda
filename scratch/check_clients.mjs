import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    try {
        console.log("=== BUSCANDO CLIENTES ===");
        const { data: clients, error: cErr } = await supabase
            .from('clientes')
            .select('id, nombre')
            .or('nombre.ilike.%Yamil Eid Montaño%,nombre.ilike.%Hezekiel%');
        if (cErr) throw cErr;
        console.log("Clientes encontrados:", clients);

        for (const client of clients) {
            console.log(`\n================ CLIENTE: ${client.nombre} (${client.id}) ================`);
            
            // Query cliente_items
            const { data: items, error: iErr } = await supabase
                .from('cliente_items')
                .select('id, titulo, precio_venta, monto_pagado, estado')
                .eq('cliente_id', client.id);
            if (iErr) throw iErr;
            
            console.log("--- CLIENTE_ITEMS ---");
            console.table(items);
            
            // Query cliente_pagos
            const { data: pagos, error: pErr } = await supabase
                .from('cliente_pagos')
                .select('id, monto, metodo_pago, fecha, concepto')
                .eq('cliente_id', client.id);
            if (pErr) throw pErr;
            
            console.log("--- CLIENTE_PAGOS ---");
            console.table(pagos);
        }
    } catch (e) {
        console.error(e);
    }
}

check();
