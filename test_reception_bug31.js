import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envFile = fs.readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim();
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAllCItems() {
    const { data: semanas } = await supabase.from('semanas').select('id, nombre').ilike('nombre', '%16%');
    const semanaId = semanas[0]?.id;

    const { data: cItems } = await supabase
        .from('cliente_items')
        .select('id, titulo, estado, semana_id')
        .or(`semana_id.eq.${semanaId},estado.ilike.CONFIRMADO%`);
    
    console.log("Total potential client items fetched by component logic:", cItems?.length);
    
    const targetTitles = ["THE FIRST SLAM DUNK RE:SOURCE", "ONE PIECE 106", "WITCH WATCH 01", "SHOUT LOUD MY HEART"];
    targetTitles.forEach(t => {
        const key = t.toLowerCase().trim();
        const found = (cItems || []).filter(ci => (ci.titulo || '').toLowerCase().trim() === key);
        console.log(`Title: ${t} | Found in component pool: ${found.length} items`);
    });
}
checkAllCItems();
