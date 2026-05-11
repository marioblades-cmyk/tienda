import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';
const supabase = createClient(supabaseUrl, supabaseKey);

async function countStoreTitles() {
    const weekId = 'a5552e79-64a0-484f-ae59-0bfcaddbc5fd';

    // Same logic as in the CatalogUpdatedView
    const { data: allOrders } = await supabase.from('pedido_items')
        .select('cantidad, titulo, pedido:pedidos!inner(semana_id, tipo)')
        .eq('pedido.semana_id', weekId)
        .order('id', { ascending: false });

    // Filter store items
    const storeItems = allOrders.filter(o => o.pedido?.tipo === 'tienda' && (o.cantidad || 0) > 0);
    
    // Sum total units for store
    const totalUnits = storeItems.reduce((sum, item) => sum + (item.cantidad || 0), 0);

    // Number of unique titles
    const uniqueTitles = new Set(storeItems.map(item => (item.titulo || '').toLowerCase().trim()));

    console.log(`Total Unique Titles for Store: ${uniqueTitles.size}`);
    console.log(`Total Units for Store: ${totalUnits}`);
}

countStoreTitles();
