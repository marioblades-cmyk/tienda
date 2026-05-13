
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
        const sinceDate = "2026-05-09T00:00:00Z";

        console.log(`--- ANALIZANDO TODOS LOS PAGOS YASTA (QR) DESDE EL SÁBADO ---`);
        const pagos = await query(`cliente_pagos?metodo_pago=eq.Yasta%20(QR)&created_at=gte.${sinceDate}&select=*,vendedores(nombre),clientes(nombre)`);
        
        const summary = {};
        pagos.forEach(p => {
            const vName = p.vendedores?.nombre || "Desconocido";
            if (!summary[vName]) summary[vName] = { total: 0, count: 0, sinCaja: 0, montoSinCaja: 0 };
            summary[vName].total += Number(p.monto);
            summary[vName].count++;
            if (!p.caja_mov_id) {
                summary[vName].sinCaja++;
                summary[vName].montoSinCaja += Number(p.monto);
            }
        });

        console.table(summary);

        console.log(`\n--- DETALLE DE PAGOS SIN CAJA (SÓLO MAURICIO) ---`);
        pagos.filter(p => p.vendedores?.nombre === "Mauricio" && !p.caja_mov_id).forEach(p => {
            console.log(`[${p.created_at}] BS ${p.monto} - Cliente: ${p.clientes?.nombre} - Concepto: ${p.concepto}`);
        });

    } catch (error) {
        console.error(error);
    }
}

main();
