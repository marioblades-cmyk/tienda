import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://lbraboujrajvzosmddtu.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'
);

async function check() {
    const { data: vendors } = await supabase.from('vendedores').select('*').ilike('nombre', '%Mauricio%');
    console.log('Vendors named Mauricio:', vendors);

    if (!vendors || vendors.length === 0) return;
    const vendorId = vendors[0].id;

    const { data: weeks } = await supabase.from('semanas').select('*').order('created_at', { ascending: false });
    console.log('All weeks:', weeks.map(w => ({ id: w.id, nombre: w.nombre })));

    // Let's also check all client_items for Mauricio regardless of week
    const { data: allItems } = await supabase.from('cliente_items').select('*').eq('vendedor_id', vendorId);
    console.log(`Total client items for Mauricio:`, allItems?.length);

    for (const week of weeks) {
        const { data: items } = await supabase
            .from('cliente_items')
            .select('*, clientes(nombre)')
            .eq('vendedor_id', vendorId)
            .eq('semana_id', week.id);
        if (items && items.length > 0) {
            console.log(`Week ${week.id} (${week.nombre}) has ${items.length} items for Mauricio`);
        }
    }
}

check();
