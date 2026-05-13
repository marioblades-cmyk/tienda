
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

        console.log(`--- INVESTIGANDO INTEGRIDAD DE PAGOS Y CAJA ---`);

        // 1. Obtener todos los pagos de Mauricio
        const pagos = await query(`cliente_pagos?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}`);
        
        // 2. Obtener todos los movimientos de caja de Mauricio
        const caja = await query(`caja_movimientos?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}`);
        const cajaIds = new Set(caja.map(m => m.id));

        console.log(`\nPagos totales registrados por Mauricio: ${pagos.length}`);
        console.log(`Movimientos de caja registrados por Mauricio: ${caja.length}`);

        // 3. Detectar pagos con ID de caja que NO existe (posible borrado manual de caja)
        const huerfanos = [];
        for (const p of pagos) {
            if (p.caja_mov_id && !cajaIds.has(p.caja_mov_id)) {
                // Verificar si el ID existe en TODA la tabla de caja (por si cambió el vendedor_id del movimiento)
                const check = await query(`caja_movimientos?id=eq.${p.caja_mov_id}`);
                if (check.length === 0) {
                    huerfanos.push(p);
                } else {
                    console.log(`⚠️ ALERTA: El pago [${p.id}] tiene un movimiento [${p.caja_mov_id}] pero el VENDEDOR del movimiento es ${check[0].vendedor_id} (Diferente a Mauricio).`);
                }
            }
        }

        if (huerfanos.length > 0) {
            console.log(`\n🔴 SE ENCONTRARON ${huerfanos.length} PAGOS CUYO MOVIMIENTO DE CAJA FUE ELIMINADO:`);
            huerfanos.forEach(p => {
                console.log(`  - [${p.created_at}] BS ${p.monto} (Concepto: ${p.concepto})`);
            });
        } else {
            console.log(`\n✅ No hay pagos con movimientos eliminados (que tuvieran ID previo).`);
        }

        // 4. Analizar los "Sin Contabilidad"
        const sinCaja = pagos.filter(p => !p.caja_mov_id);
        console.log(`\n🟡 PAGOS REGISTRADOS COMO "SIN CONTABILIDAD" (${sinCaja.length}):`);
        let totalSinCaja = 0;
        sinCaja.forEach(p => {
            if (p.metodo_pago === 'Yasta (QR)') {
                console.log(`  - [${p.created_at}] BS ${p.monto} (Yasta QR) - ${p.concepto}`);
                totalSinCaja += Number(p.monto);
            }
        });
        console.log(`TOTAL YASTA "SIN CAJA": BS ${totalSinCaja}`);

    } catch (error) {
        console.error(error);
    }
}

main();
