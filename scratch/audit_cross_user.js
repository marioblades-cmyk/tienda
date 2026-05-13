
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
        console.log(`--- AUDITORÍA DE INTEGRIDAD: MAURICIO vs MARIO (Desde el Sábado) ---`);

        // 1. Obtener todos los pagos y movimientos
        const pagos = await query(`cliente_pagos?created_at=gte.${sinceDate}&select=*,clientes(nombre)`);
        const caja = await query(`caja_movimientos?created_at=gte.${sinceDate}`);

        const mauricioId = "159c2549-e6b3-4326-8b09-7eb8b1a7e671";
        const marioId = "278c0c3d-29d3-494e-94e1-e5108204917f";

        const cajaMap = {};
        caja.forEach(m => cajaMap[m.id] = m);

        console.log(`\n1. BUSCANDO DISCREPANCIAS DE MONTOS (Pago vs Caja):`);
        const sumasPorCaja = {};
        pagos.forEach(p => {
            if (p.caja_mov_id) {
                sumasPorCaja[p.caja_mov_id] = (sumasPorCaja[p.caja_mov_id] || 0) + Number(p.monto);
            }
        });

        for (const cid in sumasPorCaja) {
            const mov = cajaMap[cid];
            if (mov) {
                const diff = Math.abs(sumasPorCaja[cid] - Number(mov.monto));
                if (diff > 0.01) {
                    console.log(`⚠️ DESCUADRE en Movimiento [${cid}]:`);
                    console.log(`   Concepto: ${mov.concepto}`);
                    console.log(`   Monto en CAJA: BS ${mov.monto}`);
                    console.log(`   Suma de PAGOS: BS ${sumasPorCaja[cid]}`);
                    console.log(`   Diferencia: BS ${diff.toFixed(2)}`);
                    console.log(`   Vendedor Caja: ${mov.vendedor_id === mauricioId ? 'Mauricio' : 'Mario'}`);
                }
            } else {
                // El movimiento no existe en los de "sinceDate", buscar en toda la base
                const check = await query(`caja_movimientos?id=eq.${cid}`);
                if (check.length === 0) {
                    console.log(`🔴 MOVIMIENTO ELIMINADO: Pago de BS ${sumasPorCaja[cid]} apunta a Caja ID ${cid} que ya NO existe.`);
                }
            }
        }

        console.log(`\n2. BUSCANDO ACCIONES "CRUZADAS" (Uno alteró lo del otro):`);
        pagos.forEach(p => {
            const mov = cajaMap[p.caja_mov_id];
            if (mov && p.vendedor_id !== mov.vendedor_id) {
                const pName = p.vendedor_id === mauricioId ? 'Mauricio' : 'Mario';
                const mName = mov.vendedor_id === mauricioId ? 'Mauricio' : 'Mario';
                console.log(`🟠 ALERTA: Pago registrado por ${pName} está vinculado a un movimiento de Caja creado por ${mName}.`);
                console.log(`   Cliente: ${p.clientes?.nombre} - Monto: BS ${p.monto} - [${p.created_at}]`);
            }
        });

    } catch (error) {
        console.error(error);
    }
}

main();
