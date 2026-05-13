
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
        const today = "2026-05-12T00:00:00Z";
        console.log(`--- ANALIZANDO ACTIVIDAD DE HOY (MAYO 12) ---`);
        
        const pagos = await query(`cliente_pagos?created_at=gte.${today}&select=*,clientes(nombre),vendedores(nombre)`);
        if (Array.isArray(pagos)) {
            console.log(`\nPagos registrados hoy: ${pagos.length}`);
            pagos.forEach(p => {
                console.log(`  [${p.created_at}] BS ${p.monto} - ${p.clientes?.nombre} - ${p.metodo_pago} (Caja ID: ${p.caja_mov_id}) - ${p.vendedores?.nombre}`);
            });
        } else {
            console.log("Error consultando pagos:", pagos);
        }

        const caja = await query(`caja_movimientos?created_at=gte.${today}`);
        if (Array.isArray(caja)) {
            console.log(`\nMovimientos de caja hoy: ${caja.length}`);
            caja.forEach(m => {
                console.log(`  [${m.created_at}] ${m.tipo}: BS ${m.monto} - ${m.concepto} - ${m.metodo_pago}`);
            });
        } else {
            console.log("Error consultando caja:", caja);
        }

    } catch (error) {
        console.error(error);
    }
}

main();
