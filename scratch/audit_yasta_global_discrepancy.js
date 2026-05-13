
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
        console.log(`--- ESCANEO GLOBAL DE YASTA (QR): BUSCANDO ERRORES DE CONCILIACIÓN ---`);
        
        // 1. Obtener todos los movimientos de caja de Yasta
        const caja = await query(`caja_movimientos?metodo_pago=eq.Yasta%20(QR)`);
        const cajaMap = {};
        caja.forEach(m => cajaMap[m.id] = m);

        // 2. Obtener todos los pagos asociados a Yasta
        const pagos = await query(`cliente_pagos?metodo_pago=eq.Yasta%20(QR)&select=*,clientes(nombre)`);

        const sumasPorCaja = {};
        pagos.forEach(p => {
            if (p.caja_mov_id) {
                sumasPorCaja[p.caja_mov_id] = (sumasPorCaja[p.caja_mov_id] || 0) + Number(p.monto);
            }
        });

        console.log(`\n--- DISCREPANCIAS DETECTADAS ---`);
        let count = 0;
        for (const cid in sumasPorCaja) {
            const mov = cajaMap[cid];
            if (mov) {
                const diff = Math.abs(sumasPorCaja[cid] - Number(mov.monto));
                if (diff > 0.1) {
                    console.log(`❌ ERROR en Caja ID [${cid}]:`);
                    console.log(`   Fecha Movimiento: ${mov.created_at}`);
                    console.log(`   Concepto: ${mov.concepto}`);
                    console.log(`   Monto en Ledger: BS ${mov.monto}`);
                    console.log(`   Suma de Pagos vinculados: BS ${sumasPorCaja[cid].toFixed(2)}`);
                    console.log(`   DIFERENCIA: BS ${diff.toFixed(2)}`);
                    count++;
                }
            } else {
                console.log(`🔴 ORFANDAD: El pago apunta a un Movimiento [${cid}] que NO EXISTE.`);
                count++;
            }
        }

        if (count === 0) console.log("✅ No se encontraron descuadres entre pagos vinculados y caja.");

    } catch (error) {
        console.error(error);
    }
}

main();
