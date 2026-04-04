
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Cargar variables de entorno desde .env si existe
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY; // Nota: Usar ANON si RLS permite, o SERVICE_ROLE si no

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Error: Variables de entorno Supabase no encontradas.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetStock() {
    console.log('🔄 Iniciando reset de stock físico a 0...');
    
    const { data, error, count } = await supabase
        .from('catalogo_productos')
        .update({ stock_fisico: 0 })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Finge un filtro para que Supabase permita el update masivo si no hay WHERE
    
    if (error) {
        console.error('❌ Error al resetear stock:', error.message);
        process.exit(1);
    }
    
    console.log('✅ Stock físico reseteado a 0 en todos los productos.');
}

resetStock();
