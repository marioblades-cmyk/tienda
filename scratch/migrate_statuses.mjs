import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function migrate() {
    console.log("Iniciando migración de estados...");
    
    // 1. Obtener los items PENDIENTE con su semana
    const { data: items, error } = await supabase
        .from('pedido_items')
        .select('id, pedido:pedidos!inner(semana:semanas!inner(nombre))')
        .eq('estado', 'PENDIENTE')
        .eq('fuente', 'entelequia');

    if (error) {
        console.error("Error fetching items:", error);
        return;
    }

    console.log(`Encontrados ${items?.length || 0} ítems para actualizar.`);

    for (const item of (items || [])) {
        const newEstado = `PEDIDO ${item.pedido.semana.nombre}`;
        console.log(`Actualizando item ${item.id} -> ${newEstado}`);
        await supabase
            .from('pedido_items')
            .update({ estado: newEstado })
            .eq('id', item.id);
    }

    console.log("Migración completada.");
}

migrate()
