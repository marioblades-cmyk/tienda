
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkNovedades() {
    const { data, error } = await supabase
        .from('catalogo_productos')
        .select('titulo, es_novedad, es_reimpresion')
        .eq('es_novedad', true)
        .limit(5);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Novedades encontradas:', JSON.stringify(data, null, 2));
    }
}

checkNovedades();
