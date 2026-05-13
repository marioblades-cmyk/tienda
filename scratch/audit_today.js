
const url = "https://lbraboujrajvzosmddtu.supabase.co/rest/v1/";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLevel iiat i1772613662 iiat i1772613662 exp i2088189662 Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs";

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
        
        const pagos = await query(`cliente_pagos?created_at=gte.${today}&select=*,vendedores(nombre),clientes(nombre)`);
        console.log(`\nPagos registrados hoy: ${pagos.length}`);
        pagos.forEach(p => {
            console.log(`  [${p.created_at}] BS ${p.monto} - ${p.clientes?.nombre} - ${p.metodo_pago} (Caja ID: ${p.caja_mov_id}) - ${p.vendedores?.nombre}`);
        });

        const caja = await query(`caja_movimientos?created_at=gte.${today}`);
        console.log(`\nMovimientos de caja hoy: ${caja.length}`);
        caja.forEach(m => {
            console.log(`  [${m.created_at}] ${m.tipo}: BS ${m.monto} - ${m.concepto} - ${m.metodo_pago}`);
        });

    } catch (error) {
        console.error(error);
    }
}

main();
