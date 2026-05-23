import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    try {
        const { data: clients } = await supabase
            .from('clientes')
            .select('id, nombre')
            .ilike('nombre', '%Hezekiel%');
        const client = clients[0];
        
        // Query items
        const { data: items } = await supabase
            .from('cliente_items')
            .select('id, titulo, precio_venta, monto_pagado, estado')
            .eq('cliente_id', client.id);

        const sumMontoPagadoItems = items.reduce((acc, it) => acc + Number(it.monto_pagado || 0), 0);
        console.log("=== HEZEKIEL ITEMS ===");
        console.log(JSON.stringify(items, null, 2));
        console.log("Suma monto_pagado items:", sumMontoPagadoItems);

        // Query pagos
        const { data: pagos } = await supabase
            .from('cliente_pagos')
            .select('id, monto, metodo_pago, fecha, concepto')
            .eq('cliente_id', client.id);
        
        console.log("\n=== HEZEKIEL PAGOS ===");
        console.log(JSON.stringify(pagos, null, 2));
        const sumPagos = pagos.reduce((acc, p) => acc + Number(p.monto || 0), 0);
        console.log("Suma total pagos:", sumPagos);
        
        // Root pagos (not starting with 'Asignado a:')
        const rootPagos = pagos.filter(p => !p.concepto?.startsWith('Asignado a:'));
        const sumRootPagos = rootPagos.reduce((acc, p) => acc + Number(p.monto || 0), 0);
        console.log("Suma pagos raiz (getPagosRaiz):", sumRootPagos);
    } catch (e) {
        console.error(e);
    }
}

check();
