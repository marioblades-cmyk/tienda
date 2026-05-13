
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
        const monday = "2026-05-11T00:00:00Z";
        console.log(`--- VERIFICANDO MODIFICACIONES EN PAGOS DEL LUNES ---`);
        
        const pagos = await query(`cliente_pagos?created_at=gte.${monday}&metodo_pago=eq.Yasta%20(QR)&select=*,clientes(nombre),caja_movimientos(*)`);
        
        pagos.forEach(p => {
            if (p.caja_movimientos) {
                // Si es una distribución, el monto del pago será menor o igual al del movimiento
                // Pero si es el pago MADRE, debe coincidir si no se ha distribuido nada aún
                // O la suma de todos los pagos hijos debe coincidir con la madre.
                // Ya lo hice globalmente y dio 0 errores.
            }
        });

        // Ver si hay algún pago que tenga una fecha (manual) distinta al created_at
        const manualDates = pagos.filter(p => p.fecha && p.fecha.slice(0,10) !== p.created_at.slice(0,10));
        if (manualDates.length > 0) {
            console.log(`\n📅 PAGOS CON FECHA MANUAL DISTINTA A LA DE CREACIÓN:`);
            manualDates.forEach(p => {
                console.log(`  [Creado: ${p.created_at}] [Fecha Manual: ${p.fecha}] BS ${p.monto} - ${p.clientes?.nombre}`);
            });
        }

    } catch (error) {
        console.error(error);
    }
}

main();
