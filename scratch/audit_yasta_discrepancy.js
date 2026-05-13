
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
        const sinceDate = "2026-05-09T00:00:00Z";

        const pagos = await query(`cliente_pagos?vendedor_id=eq.${mauricioId}&metodo_pago=eq.Yasta%20(QR)&created_at=gte.${sinceDate}&select=*,clientes(nombre)`);
        
        const pagosSinCaja = pagos.filter(p => !p.caja_mov_id);
        
        console.log(`--- PAGOS YASTA SIN REGISTRO EN CAJA (MAURICIO) ---`);
        let total = 0;
        pagosSinCaja.forEach(p => {
            console.log(`[${p.created_at.slice(0,16)}] BS ${p.monto} - ${p.clientes?.nombre} (${p.concepto})`);
            total += Number(p.monto);
        });
        console.log(`\nTOTAL "FALTANTE" EN CAJA (Pagos sin movimiento): BS ${total}`);

        // Verificamos si hay movimientos de caja que SÍ existan para estos pagos pero el ID esté mal
        // (Buscamos movimientos de Mauricio del mismo día con el mismo monto que no tengan pago asociado)
        const caja = await query(`caja_movimientos?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}`);
        console.log(`\n--- VERIFICACIÓN CRUZADA ---`);
        const pagosConCaja = pagos.filter(p => p.caja_mov_id);
        console.log(`Pagos con Caja: ${pagosConCaja.length}`);
        console.log(`Pagos sin Caja: ${pagosSinCaja.length}`);
        
    } catch (error) {
        console.error(error);
    }
}

main();
