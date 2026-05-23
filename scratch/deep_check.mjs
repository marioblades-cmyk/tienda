import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkMore() {
    console.log("Deep checking items...");
    
    const { data: allItems } = await supabase
        .from('pedido_items')
        .select('titulo, estado, fuente, pedido_id')
        .or('titulo.ilike.%HAIKYU%,titulo.ilike.%SOLO LEVELING%');

    console.table(allItems);

    const { count } = await supabase
        .from('pedido_items')
        .select('*', { count: 'exact', head: true })
        .is('estado', null);
    
    console.log("Items with NULL status:", count);

    const { count: pendingCount } = await supabase
        .from('pedido_items')
        .select('*', { count: 'exact', head: true })
        .eq('estado', 'PENDIENTE');
    
    console.log("Items with PENDIENTE status:", pendingCount);
}

checkMore()
