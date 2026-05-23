import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function test() {
    const { count, error } = await supabase
        .from('catalogo_productos')
        .select('*', { count: 'exact', head: true })

    if (error) {
        console.error(error)
        return
    }
    console.log("Total items:", count)
}

test()
