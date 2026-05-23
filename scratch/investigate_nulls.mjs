import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function investigateNulls() {
    console.log("Investigating NULL statuses...");
    
    const { data: samples } = await supabase
        .from('pedido_items')
        .select('titulo, fuente, pedido:pedidos!inner(tipo)')
        .is('estado', null)
        .limit(10);
    
    console.log("Samples of NULL status items:");
    console.table(samples);

    // Count by source and type
    const { data: stats } = await supabase
        .from('pedido_items')
        .select('fuente, pedido:pedidos!inner(tipo)')
        .is('estado', null);
    
    const counts = {};
    (stats || []).forEach(s => {
        const key = `${s.fuente} | ${s.pedido.tipo}`;
        counts[key] = (counts[key] || 0) + 1;
    });

    console.log("Distribution of NULL statuses:");
    console.table(counts);
}

investigateNulls()
