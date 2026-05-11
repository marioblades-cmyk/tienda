import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://lbraboujrajvzosmddtu.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'
);

async function check() {
    const { data: allItems } = await supabase.from('cliente_items').select('*, clientes(*)').limit(100);
    console.log(`First 100 items:`, allItems?.length);

    const vendorIds = new Set();
    allItems?.forEach(i => {
        if (i.vendedor_id) vendorIds.add(i.vendedor_id);
    });

    console.log('Vendor IDs present in these items:', Array.from(vendorIds));

    // Let's get the names of these vendor IDs
    for (const vid of vendorIds) {
        const { data: v } = await supabase.from('vendedores').select('nombre').eq('id', vid).single();
        console.log(`Vendor ID ${vid} belongs to:`, v?.nombre);
    }
}

check();
