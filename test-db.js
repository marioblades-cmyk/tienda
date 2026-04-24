import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data: clients, error } = await supabase.from('cliente_items').select('id, titulo, estado, semana_id').limit(10);
    console.log(clients);
    const { data: h } = await supabase.from('cliente_items').select('id, titulo, estado, semana_id').ilike('titulo', '%HAIKYU%');
    console.log("haikyu:", h);
}

check();
