
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRLS() {
    console.log("=== LISTADO DE TABLAS CON RLS ACTIVO ===");

    // Ejecutamos la query via RPC si existe o intentamos deducirlo
    const { data, error } = await supabase.rpc('get_rls_status'); 
    
    if (error) {
        // Si no hay RPC, probamos una query directa al esquema (esto solo funciona si hay permisos de lectura en pg_tables)
        console.log("No se pudo ejecutar RPC. Intentando deducción por fallos de lectura...");
        
        const tables = ['catalogo_productos', 'pedidos', 'pedido_items', 'semanas', 'master_confirmaciones', 'caja_movimientos', 'cliente_pagos', 'clientes'];
        
        for (const t of tables) {
            const { data: test, error: err } = await supabase.from(t).select('count', { count: 'exact', head: true });
            if (err) {
                console.log(`❌ TABLA: ${t} | RLS/PERMISO: BLOQUEADO (${err.message})`);
            } else {
                console.log(`✅ TABLA: ${t} | RLS/PERMISO: ACCESIBLE`);
            }
        }
    } else {
        console.table(data);
    }
}

checkRLS();
