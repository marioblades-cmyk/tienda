import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkSoloLevelingPedidosDetail() {
    const { data } = await supabase
        .from('pedido_items')
        .select('titulo, estado, pedido:pedidos!inner(id, tipo, vendedor_nombre)')
        .ilike('titulo', '%SOLO LEVELING 14%');
    
    data.forEach(d => {
        console.log(`Item: ${d.titulo} | Estado: ${d.estado} | Tipo: ${d.pedido.tipo} | Vendedor: ${d.pedido.vendedor_nombre}`);
    });
}

checkSoloLevelingPedidosDetail()
