
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
        const id = "f8562066-b93c-4204-82f5-c1cfe059af2c";
        console.log(`--- INVESTIGANDO MOVIMIENTO DE CAJA ${id} ---`);
        const mov = await query(`caja_movimientos?id=eq.${id}&select=*,vendedores(nombre)`);
        console.log(JSON.stringify(mov, null, 2));

        console.log(`\n--- PAGOS ASOCIADOS A ESTE MOVIMIENTO ---`);
        const pagos = await query(`cliente_pagos?caja_mov_id=eq.${id}&select=*,clientes(nombre)`);
        let total = 0;
        pagos.forEach(p => {
            console.log(`  BS ${p.monto} - ${p.clientes?.nombre} - ${p.concepto}`);
            total += Number(p.monto);
        });
        console.log(`TOTAL DISTRIBUIDO DE ESTE MOVIMIENTO: BS ${total}`);

    } catch (error) {
        console.error(error);
    }
}

main();
