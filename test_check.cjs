
const fs = require('fs');
const envStr = fs.readFileSync('.env', 'utf8');
const env = {};
envStr.split('\n').filter(Boolean).forEach(line => {
    if(line.includes('=')) {
        const parts = line.split('=');
        env[parts[0]] = parts.slice(1).join('=').trim();
    }
});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function check() {
    console.log('Fetching weeks for safe fallback');
    const { data: sem } = await supabase.from('semanas').select('id, nombre');
    const semanaId = sem.find(s => s.nombre.includes('15'))?.id;

    if(!semanaId) return console.log('No semana 15 found');

    const { data: mc } = await supabase.from('master_confirmaciones').select('*').eq('semana_id', semanaId).maybeSingle();
    const items = mc.datos_json || [];
    
    console.log('Master items:', items.length);
    for(const item of items.slice(0, 5)) {
        const { data: prods } = await supabase.from('catalogo_productos').select('titulo, stock_fisico').ilike('titulo', '%' + item.titulo.trim() + '%');
        const p = prods && prods.length > 0 ? prods[0] : null;
        console.log(item.titulo, '->', p ? p.stock_fisico : 'NOT FOUND');
    }
}
check();

