import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function migrateFase2() {
    console.log("Iniciando Migración Fase 2 (Items con estado NULL)...");
    
    // 1. Obtener los items NULL con su semana
    const { data: items, error } = await supabase
        .from('pedido_items')
        .select('id, pedido:pedidos!inner(tipo, semana:semanas!inner(nombre))')
        .is('estado', null)
        .eq('fuente', 'entelequia')
        .eq('pedido.tipo', 'mayorista');

    if (error) {
        console.error("Error fetching items:", error);
        return;
    }

    const count = items?.length || 0;
    console.log(`Encontrados ${count} ítems para actualizar.`);

    if (count === 0) return;

    // Procesar en batches de 50 para evitar timeouts
    const batchSize = 50;
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        console.log(`Procesando batch ${i / batchSize + 1} / ${Math.ceil(items.length / batchSize)}...`);
        
        await Promise.all(batch.map(async (item) => {
            const newEstado = `PEDIDO ${item.pedido.semana.nombre}`;
            return supabase
                .from('pedido_items')
                .update({ estado: newEstado })
                .eq('id', item.id);
        }));
    }

    console.log("Migración Fase 2 completada exitosamente.");
}

migrateFase2()
