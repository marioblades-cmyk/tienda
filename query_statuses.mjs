import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function investigate() {
    console.log("--- PEDIDOS ---")
    const p = await supabase.from('pedidos').select('estado').limit(50)
    const pEstados = new Set(p.data?.map(i => i.estado))
    console.log("Estados en pedidos:", Array.from(pEstados))

    console.log("--- PEDIDO_ITEMS ---")
    const pi = await supabase.from('pedido_items').select('estado').limit(50)
    const piEstados = new Set(pi.data?.map(i => i.estado))
    console.log("Estados en pedido_items:", Array.from(piEstados))

    console.log("--- CLIENTE_ITEMS ---")
    const ci = await supabase.from('cliente_items').select('estado').limit(50)
    const ciEstados = new Set(ci.data?.map(i => i.estado))
    console.log("Estados en cliente_items:", Array.from(ciEstados))
}

investigate()
