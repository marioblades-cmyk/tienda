
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumns() {
    console.log("=== VERIFICANDO COLUMNAS DE catalogo_productos ===");
    const { data, error } = await supabase.rpc('get_table_columns', { t_name: 'catalogo_productos' });
    
    if (error) {
        // Si no hay RPC, probamos deducción por inserción de prueba
        console.log("No se pudo usar RPC. Probando inserción de prueba con es_novedad...");
        const { error: insertError } = await supabase.from('catalogo_productos').select('es_novedad').limit(1);
        if (insertError) {
            console.log("❌ ERROR: La columna 'es_novedad' NO parece existir o no es accesible:", insertError.message);
        } else {
            console.log("✅ COLUMNA 'es_novedad' CONFIRMADA.");
        }
    } else {
        console.table(data);
    }
}

checkColumns();
