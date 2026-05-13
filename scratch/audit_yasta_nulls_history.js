
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
        console.log(`--- BUSCANDO PAGOS YASTA (QR) "SIN CONTABILIDAD" EN TODO EL HISTORIAL ---`);
        const pagos = await query(`cliente_pagos?metodo_pago=eq.Yasta%20(QR)&caja_mov_id=is.null`);
        
        let total = 0;
        pagos.forEach(p => {
            total += Number(p.monto);
        });

        console.log(`Total Pagos Yasta sin Caja: BS ${total}`);
        console.log(`Número de registros: ${pagos.length}`);

        // Ver por vendedor
        const sellers = {};
        pagos.forEach(p => {
            sellers[p.vendedor_id] = (sellers[p.vendedor_id] || 0) + Number(p.monto);
        });
        console.log("\nPor Vendedor ID:");
        console.log(sellers);

    } catch (error) {
        console.error(error);
    }
}

main();
