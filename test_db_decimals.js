
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function testDecimals() {
    console.log("Testing decimal precision in cliente_items...");
    
    // 1. Create a dummy client
    const { data: client, error: cliErr } = await supabase.from('clientes').insert([{
        nombre: 'TEST DECIMAL',
        celular: '00000000'
    }]).select().single();
    
    if (cliErr) {
        console.error("Error creating client:", cliErr);
        return;
    }
    
    console.log("Client created:", client.id);
    
    // 2. Insert item with decimals
    const { data: item, error: itemErr } = await supabase.from('cliente_items').insert([{
        cliente_id: client.id,
        titulo: 'TEST ITEM DECIMALS',
        precio_venta: 165.55,
        monto_pagado: 50.25,
        estado: 'TEST'
    }]).select().single();
    
    if (itemErr) {
        console.error("Error inserting item:", itemErr);
    } else {
        console.log("Item inserted with prices:", item.precio_venta, item.monto_pagado);
        if (item.precio_venta === 165.55) {
            console.log("SUCCESS: Database preserves decimals.");
        } else {
            console.log("FAILURE: Database truncated decimals to", item.precio_venta);
        }
    }
    
    // Cleanup
    await supabase.from('cliente_items').delete().eq('id', item.id);
    await supabase.from('clientes').delete().eq('id', client.id);
}

testDecimals();
