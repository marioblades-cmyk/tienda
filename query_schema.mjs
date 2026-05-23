import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function investigate() {
    const { data, error } = await supabase
        .from('pedido_items')
        .select('*')
        .limit(1)

    if (error) {
        console.error(error)
        return
    }
    
    // We can't get table schema directly via PostgREST without hitting the OpenAPI spec or Postgres meta tables.
    // Let's try inserting a dummy record that fails and see if it gives a schema hint, or just fetch 1 row to see existing columns.
    if (data && data.length > 0) {
        console.log("Columns present in first row:", Object.keys(data[0]))
    } else {
        console.log("Table is empty, trying to insert dummy to get error schema hint")
        const res = await supabase.from('pedido_items').insert([{ pedido_id: 1, titulo: 'test', cantidad: 1 }])
        console.log("Insert result:", res)
    }
}

investigate()
