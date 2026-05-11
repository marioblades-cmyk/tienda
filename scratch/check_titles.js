
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkReservations() {
    console.log("=== AUDITORÍA DE RESERVAS (SEMANA 19) ===");
    
    const { data: sems } = await supabase.from('semanas').select('id, nombre').ilike('nombre', '%19%');
    const semId = sems[0]?.id;
    if (!semId) return;

    const titles = ['20TH CENTURY BOYS 02', 'TRIGUN MAXIMUM 01', 'MASTER KEATON - EDICION KANZENBAN 03'];

    for (const t of titles) {
        console.log(`\nProducto: ${t}`);
        
        // 1. Ver cuánto hay en el Master
        const { data: master } = await supabase.from('master_confirmaciones').select('datos_json').eq('semana_id', semId);
        const masterQty = (master[0]?.datos_json || []).find(it => it.titulo === t)?.cantidad || 0;
        
        // 2. Ver cuánto se ha recibido
        const { data: rec } = await supabase.from('pedido_items_recepcion').select('cantidad_recibida').eq('semana_id', semId).ilike('titulo', t);
        const receivedQty = (rec || []).reduce((s, r) => s + (r.cantidad_recibida || 0), 0);

        // 3. Ver reservas de clientes (ADJUDICADO/CONFIRMADO)
        const { data: res } = await supabase.from('cliente_items').select('estado').eq('semana_id', semId).ilike('titulo', t);
        const reservedQty = (res || []).filter(ci => (ci.estado || '').includes('ADJUDICADO') || (ci.estado || '').includes('CONFIRMADO')).length;

        console.log(`  Confirmado (Master): ${masterQty}`);
        console.log(`  Recibido: ${receivedQty}`);
        console.log(`  Reservado (Clientes): ${reservedQty}`);
        console.log(`  DISPONIBLE TIENDA: ${masterQty - receivedQty - reservedQty}`);
    }
}

checkReservations();
