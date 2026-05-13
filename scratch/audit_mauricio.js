
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
        console.log("--- BUSCANDO A MAURICIO ---");
        const sellers = await query("vendedores?nombre=ilike.*Mauricio*");
        console.log("Vendedores encontrados:", JSON.stringify(sellers, null, 2));

        if (sellers.length === 0) {
            console.log("No se encontró ningún vendedor con el nombre Mauricio.");
            return;
        }

        const mauricioId = sellers[0].id;
        const sinceDate = "2026-05-09T00:00:00Z";

        console.log(`\n--- ACTIVIDAD DE MAURICIO (ID: ${mauricioId}) DESDE EL SÁBADO 9 DE MAYO ---`);

        // 1. Items de Clientes (Ventas/Pedidos)
        console.log("\n1. Items de Clientes:");
        const items = await query(`cliente_items?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}&select=*,clientes(nombre)`);
        items.forEach(item => {
            console.log(`- [${item.created_at}] Cliente: ${item.clientes?.nombre || 'N/A'}, Producto: ${item.titulo}, Cantidad: ${item.cantidad}, Estado: ${item.estado}`);
        });

        // 2. Pagos de Clientes
        console.log("\n2. Pagos de Clientes:");
        const pagos = await query(`cliente_pagos?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}&select=*,clientes(nombre)`);
        pagos.forEach(pago => {
            console.log(`- [${pago.created_at}] Cliente: ${pago.clientes?.nombre || 'N/A'}, Monto: ${pago.monto}, Motivo: ${pago.motivo}`);
        });

        // 3. Movimientos de Caja
        console.log("\n3. Movimientos de Caja:");
        const caja = await query(`caja_movimientos?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}`);
        caja.forEach(mov => {
            console.log(`- [${mov.created_at}] Tipo: ${mov.tipo}, Monto: ${mov.monto}, Concepto: ${mov.concepto}`);
        });

        // 4. Movimientos de Stock
        console.log("\n4. Movimientos de Stock:");
        const stock = await query(`stock_movimientos?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}`);
        stock.forEach(mov => {
            console.log(`- [${mov.created_at}] Producto: ${mov.titulo}, Delta: ${mov.delta}, Motivo: ${mov.motivo}`);
        });

    } catch (error) {
        console.error("Error en la consulta:", error);
    }
}

main();
