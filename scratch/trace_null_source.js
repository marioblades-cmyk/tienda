
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
        console.log(`--- INVESTIGANDO ORIGEN DE SALDOS "SIN CAJA" ---`);
        
        // 1. Obtener los pagos nulos de Sebastian o Jose Torrico
        const pagosNull = await query(`cliente_pagos?caja_mov_id=is.null&created_at=gte.2026-05-11T00:00:00Z&select=*,clientes(nombre)`);
        
        const clientesIds = [...new Set(pagosNull.map(p => p.cliente_id))];
        
        for (const cid of clientesIds) {
            const clienteNombre = pagosNull.find(p => p.cliente_id === cid).clientes.nombre;
            console.log(`\nCliente: ${clienteNombre}`);
            
            // Buscar el pago "madre" (Saldo recuperado o similar)
            const madre = await query(`cliente_pagos?cliente_id=eq.${cid}&concepto=ilike.Saldo%20recuperado*`);
            if (madre.length > 0) {
                madre.forEach(m => {
                    console.log(`  MADRE: [${m.created_at}] BS ${m.monto} - ${m.concepto} (Caja ID: ${m.caja_mov_id})`);
                });
            } else {
                console.log(`  No se encontró pago "Saldo recuperado". Buscando abonos generales...`);
                const abonos = await query(`cliente_pagos?cliente_id=eq.${cid}&not.concepto.ilike.Asignado*`);
                abonos.forEach(a => {
                    console.log(`  ABONO: [${a.created_at}] BS ${a.monto} - ${a.concepto} (Caja ID: ${a.caja_mov_id})`);
                });
            }
        }

    } catch (error) {
        console.error(error);
    }
}

main();
