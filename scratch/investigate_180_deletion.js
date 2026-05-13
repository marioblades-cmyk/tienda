
const url = "https://lbraboujrajvzosmddtu.supabase.co/rest/v1/";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs";

async function query(path) {
    const response = await fetch(url + path, {
        headers: {
            "apikey": key,
            "Authorization": "Bearer " + key
        }
    });
    return await response.json();
}

async function main() {
    try {
        console.log(`--- INVESTIGANDO EL PAGO DE BS 180 DE AYER ---`);
        
        // 1. Buscar el movimiento de caja de BS 180 de ayer
        const monday = "2026-05-11T00:00:00Z";
        const tuesday = "2026-05-12T00:00:00Z";
        const caja = await query(`caja_movimientos?monto=eq.180&created_at=gte.${monday}&created_at=lt.${tuesday}`);
        
        if (caja.length > 0) {
            for (const m of caja) {
                console.log(`\nEncontrado Movimiento de Caja:`);
                console.log(`  ID: ${m.id}`);
                console.log(`  Fecha: ${m.created_at}`);
                console.log(`  Concepto: ${m.concepto}`);
                console.log(`  Vendedor ID: ${m.vendedor_id}`);
                
                // Buscar si existe un pago vinculado
                const pago = await query(`cliente_pagos?caja_mov_id=eq.${m.id}`);
                if (pago.length > 0) {
                    console.log(`  ✅ VINCULADO a un pago activo: [${pago[0].id}] BS ${pago[0].monto}`);
                } else {
                    console.log(`  🔴 ORFANDAD: No hay ningún pago en cliente_pagos vinculado a este movimiento.`);
                    console.log(`     Esto indica que el pago fue BORRADO pero el movimiento de caja PERMANECE.`);
                }
            }
        } else {
            console.log(`\nNo se encontró ningún movimiento de caja de BS 180 el lunes.`);
        }

    } catch (error) {
        console.error(error);
    }
}

main();
