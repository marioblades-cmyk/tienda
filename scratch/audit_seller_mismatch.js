
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
        const mauricioId = "159c2549-e6b3-4326-8b09-7eb8b1a7e671";
        const marioId = "278c0c3d-29d3-494e-94e1-e5108204917f";
        const sinceDate = "2026-05-09T00:00:00Z";

        const pagos = await query(`cliente_pagos?created_at=gte.${sinceDate}&select=*,clientes(nombre)`);
        const caja = await query(`caja_movimientos?created_at=gte.${sinceDate}`);
        const cajaMap = {};
        caja.forEach(m => cajaMap[m.id] = m);

        console.log(`--- ANALIZANDO ACCIONES MAURICIO vs MARIO ---`);

        pagos.forEach(p => {
            const mov = cajaMap[p.caja_mov_id];
            if (mov) {
                if (p.vendedor_id !== mov.vendedor_id) {
                    const pUser = p.vendedor_id === mauricioId ? "Mauricio" : (p.vendedor_id === marioId ? "Mario" : "Otro");
                    const mUser = mov.vendedor_id === mauricioId ? "Mauricio" : (mov.vendedor_id === marioId ? "Mario" : "Otro");
                    
                    console.log(`\n🚨 DISCREPANCIA DE VENDEDOR (Pago vs Caja):`);
                    console.log(`   Pago por: ${pUser} | Caja por: ${mUser}`);
                    console.log(`   Cliente: ${p.clientes?.nombre} | Monto: BS ${p.monto}`);
                    console.log(`   Concepto: ${p.concepto}`);
                    console.log(`   ID Movimiento: ${p.caja_mov_id}`);
                }
            }
        });

    } catch (error) {
        console.error(error);
    }
}

main();
