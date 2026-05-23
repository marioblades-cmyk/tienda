import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkSoloLevelingPedidos() {
    console.log("Checking SOLO LEVELING 14 parent pedidos...");
    
    const { data } = await supabase
        .from('pedido_items')
        .select('titulo, estado, pedido:pedidos!inner(id, tipo, vendedor_nombre)')
        .ilike('titulo', '%SOLO LEVELING 14%');
    
    console.table(data);
}

checkSoloLevelingPedidos()
