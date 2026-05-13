
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
        const id = "a559b267-1b51-47af-95f0-919051c210a4";
        console.log(`--- ANALIZANDO DISTRIBUCIÓN DEL MOVIMIENTO ${id} (BS 180) ---`);
        const pagos = await query(`cliente_pagos?caja_mov_id=eq.${id}`);
        
        let total = 0;
        pagos.forEach(p => {
            console.log(`  [${p.id}] BS ${p.monto} - ${p.concepto}`);
            total += Number(p.monto);
        });
        
        console.log(`\nSuma total de pagos vinculados: BS ${total}`);
        console.log(`Monto en Caja: BS 180`);
        console.log(`Diferencia: BS ${180 - total}`);

    } catch (error) {
        console.error(error);
    }
}

main();
