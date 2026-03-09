
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function verifyCount() {
    const { count, error } = await supabase
        .from('catalogo_productos')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('Error fetching count:', error);
        return;
    }
    console.log('Total items in database:', count);
}

verifyCount();
