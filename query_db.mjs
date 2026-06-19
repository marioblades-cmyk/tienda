import { createClient } from './node_modules/@supabase/supabase-js/dist/index.mjs';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';
const supabase = createClient('https://lbraboujrajvzosmddtu.supabase.co', ANON);

// Pedido MAYORISTA de mario andres blades para esta semana
const MAYORISTA_PEDIDO_ID = '6d7bdc01-b858-42a6-ac24-8fe66da573dc';

const { data: items } = await supabase
    .from('pedido_items')
    .select('id, titulo, cantidad, estado')
    .eq('pedido_id', MAYORISTA_PEDIDO_ID);

console.log('Total ítems en pedido mayorista:', items?.length);

// Group by estado
const byEstado = {};
(items || []).forEach(i => {
    const e = i.estado || 'null';
    if (!byEstado[e]) byEstado[e] = [];
    byEstado[e].push(i.titulo);
});

Object.entries(byEstado).forEach(([estado, titles]) => {
    console.log(`\n[${estado}] (${titles.length} items):`);
    titles.forEach(t => console.log(`  - ${t}`));
});
