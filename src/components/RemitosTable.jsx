import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import './RemitosTable.css';

// Configuración de tarifas de flete en BS
let FG = 70, FM = 40, FP = 20;

// Limpiador de inputs numéricos (vital para evitar errores de tipo)
function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    return parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0;
}
// Formateadores de moneda (ARS y BS)
function fBS(v) { return v ? 'BS ' + v.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'; }
function fARS(v) { return v ? 'ARS ' + Number(v).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'; }
function fARS_dist(v) { return v ? 'ARS ' + Number(v).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'; }

// Calculador por fila (Debe mantenerse intacto)
function calcRow(id, rows) {
    let r = rows.find(x => x.id === id);
    if (!r) return;

    let compre = num(r.compre);
    let cambio = num(r.cambio);
    let costoBS = compre * cambio;

    let cg = num(r.cg), cm = num(r.cm), cp = num(r.cp);
    let fleteBS = (cg * FG) + (cm * FM) + (cp * FP);

    let totalBS = costoBS + fleteBS;
    r._totalBS = totalBS;

    // Cálculos para el distribuidor y total
    let pago_aprox = num(r.pago_aprox);
    let tc_dist = parseFloat(r.tc_dist) || 0; // Usar el raw value o parseFloat como fallback
    let costoLibrosBS = pago_aprox && tc_dist ? pago_aprox * tc_dist : 0;
    let grandBS = totalBS + costoLibrosBS;

    // Asignaciones globales a nivel de fila 
    r._costoLibrosBS = costoLibrosBS;
    r._grandBS = grandBS;

    // Cálculos para el socio (peso proporcional)
    let skg = num(r.skg);
    let kgTotal = num(r.kg);
    let pctKg = kgTotal > 0 ? skg / kgTotal : 0;

    r._sEnvBS = compre * pctKg * cambio;
    r._sFltBS = num(r.scaj) * FG;
    r._sPedBS = num(r.smonto) * tc_dist;
    r._sTotBS = r._sEnvBS + r._sFltBS + r._sPedBS;

    let miPedBS = grandBS - r._sTotBS;

    return { costoBS, fleteBS, totalBS, costoLibrosBS, grandBS, sEnvBS: r._sEnvBS, sFltBS: r._sFltBS, sPedBS: r._sPedBS, sTotBS: r._sTotBS, miPedBS };
}

// Algoritmo FIFO (First-In-First-Out) - ¡No alterar la lógica!
function calcDistFIFO(distState, rowsData) {
    // 1. Convertir los pedidos en deudas (débitos)
    let debitos = distState.pedidos.map((p, idx) => {
        let r = rowsData[idx];
        return {
            id: r ? r.id : -1,
            nro: r ? (r.nro || '#' + r.id) : ('pedido ' + (idx + 1)),
            nombre: p.nombre || '',
            monto: parseFloat(p.monto) || 0
        };
    }).filter(d => d.monto > 0);

    // Insertar saldo inicial deudor si existe
    if (distState.saldoInicial && distState.saldoInicial.monto > 0 && distState.saldoInicial.tipo === 'deuda') {
        debitos.unshift({ id: -1, nro: 'Saldo inicial', nombre: 'Saldo inicial', monto: distState.saldoInicial.monto, esInicial: true });
    }

    // 2. Convertir los pagos en un pozo de créditos disponibles (pool)
    let pagos = [...distState.pagos].sort((a, b) => (a.fecha || '') > (b.fecha || '') ? 1 : -1);
    // Convertir a un pool para el FIFO
    let pool = [];

    if (distState.saldoInicial && distState.saldoInicial.monto > 0 && distState.saldoInicial.tipo === 'favor') {
        pool.push({ restante: distState.saldoInicial.monto, tc: 0, nota: 'Saldo inicial a favor' });
    }

    pagos.forEach(p => pool.push({ restante: p.monto || 0, tc: p.tc || 0, fecha: p.fecha }));

    // Aplicar ajustes manuales al pool
    (distState.ajustes || []).forEach(a => {
        if (!a.monto) return;
        if (a.monto > 0) {
            pool.push({ restante: a.monto, tc: 0, nota: 'Ajuste positivo' });
        } else {
            let resta = Math.abs(a.monto);
            for (let i = pool.length - 1; i >= 0 && resta > 0; i--) {
                let quitar = Math.min(pool[i].restante, resta);
                pool[i].restante -= quitar;
                resta -= quitar;
            }
        }
    });

    // 3. Cruzar Débitos con el Pool de créditos (La magia del FIFO)
    let resultado = debitos.map(d => {
        let pendiente = d.monto;
        let cubiertoARS = 0;
        let sp = 0, sm = 0; // sp = Suma Producto, sm = Suma Montos (para TC Ponderado)

        for (let i = 0; i < pool.length && pendiente > 0; i++) {
            if (pool[i].restante <= 0) continue;
            let usar = Math.min(pool[i].restante, pendiente);
            pool[i].restante -= usar;
            pendiente -= usar;
            cubiertoARS += usar;
            if (pool[i].tc) {
                sp += usar * pool[i].tc;
                sm += usar;
            }
        }
        let tcPond = sm > 0 ? sp / sm : 0;
        let cubiertoBS = tcPond > 0 ? cubiertoARS * tcPond : null;
        let estadoPct = d.monto > 0 ? Math.min(100, Math.round(cubiertoARS / d.monto * 100)) : 0;
        return {
            id: d.id, nro: d.nro, nombre: d.nombre, monto: d.monto,
            cubierto: cubiertoARS, pendiente: pendiente, tcPond: tcPond,
            cubiertoBS: cubiertoBS, estadoPct: estadoPct
        };
    });

    let saldoARS = pool.reduce((s, p) => s + p.restante, 0);
    return { debitos: resultado, saldoARS: saldoARS };
}

export default function RemitosTable({ activeTab = 'remitos', isSocio = false }) {
    const [rows, setRows] = useState([]);
    const [dist, setDist] = useState({ pagos: [], pedidos: [], saldoInicial: null, ajustes: [] });

    // Nuevos estados
    const [plans, setPlans] = useState([]);
    const [nplan, setNplan] = useState(1);
    const [cta, setCta] = useState({ pagos: [], extras: [] });
    const [alq, setAlq] = useState({ meses: [] });

    // Distributor UI Modals State
    const [showAddPedido, setShowAddPedido] = useState(false);
    const [showAddPago, setShowAddPago] = useState(false);
    const [newPedido, setNewPedido] = useState({ nombre: '', monto: '' });
    const [newPago, setNewPago] = useState({ fecha: '', monto: '', tc: '', metodo: 'Efectivo' });

    // Inline Edit & Ajustes States
    const [editingPedidoIdx, setEditingPedidoIdx] = useState(null);
    const [editPedidoData, setEditPedidoData] = useState({ nombre: '', monto: '' });

    const [editingPagoIdx, setEditingPagoIdx] = useState(null);
    const [editPagoData, setEditPagoData] = useState({ fecha: '', monto: '', tc: '' });

    const [isEditingSaldo, setIsEditingSaldo] = useState(false);
    const [editSaldoMonto, setEditSaldoMonto] = useState('');

    const [showAddAjuste, setShowAddAjuste] = useState(false);
    const [newAjuste, setNewAjuste] = useState({ fecha: '', monto: '', descripcion: '' });

    const [selectedSocioItems, setSelectedSocioItems] = useState({});
    const [checkedItemsToAddToPlan, setCheckedItemsToAddToPlan] = useState({});
    const [newSocioExtraDesc, setNewSocioExtraDesc] = useState('');
    const [newSocioExtraBs, setNewSocioExtraBs] = useState('');

    // UI states for adding available items inline to an existing plan
    const [addingItemToPlan, setAddingItemToPlan] = useState(null); // id del plan
    const [selectedPlanItemKey, setSelectedPlanItemKey] = useState('');

    const [ctaExtraLbl, setCtaExtraLbl] = useState('');
    const [ctaExtraAmt, setCtaExtraAmt] = useState('');

    // States for enhanced Payment/Plan features
    const [expandedPlans, setExpandedPlans] = useState({}); // { planId: boolean }
    const [hidePaidPlans, setHidePaidPlans] = useState(false);
    const [editingPagoPlanKey, setEditingPagoPlanKey] = useState(null); // "planId-pagoIdx"
    const [editingPagoCtaIdx, setEditingPagoCtaIdx] = useState(null); // idx
    const [editPagoNote, setEditPagoNote] = useState('');

    const [editingExtraId, setEditingExtraId] = useState(null); // id del extra que se está editando

    // Alquiler Config Modal State
    const [showConfigAlq, setShowConfigAlq] = useState(false);
    const [alqConfigData, setAlqConfigData] = useState({ totalBS: '', socioBS: '', mesInicio: '' });

    const [loading, setLoading] = useState(true);
    const [compactMode, setCompactMode] = useState(false);
    const [toasts, setToasts] = useState([]); // [{id, msg, type}]

    // Alquiler pago modal state
    const [alqPagoModal, setAlqPagoModal] = useState(null); // null | { idx, mes, totalBS, tuParteBS }
    const [alqMetodo, setAlqMetodo] = useState('Efectivo Personal');
    const [alqSaving, setAlqSaving] = useState(false);

    // Flete registration modal state
    const [fleteModal, setFleteModal] = useState(null); // null | { rowId, fleteBS, nro, fecha }
    const [fleteMetodo, setFleteMetodo] = useState('Efectivo Personal');
    const [fleteSaving, setFleteSaving] = useState(false);

    // Costo (Envío AR) registration modal state
    const [costoModal, setCostoModal] = useState(null); // null | { rowId, costoBS, nro, fecha, compre, cambio }
    const [costoMetodo, setCostoMetodo] = useState('Efectivo Personal');
    const [costoSaving, setCostoSaving] = useState(false);

    // Custom Confirmation Modal State
    const [confirmModal, setConfirmModal] = useState({ show: false, title: '', msg: '', onConfirm: null });

    const openConfirm = (title, msg, onConfirm) => {
        setConfirmModal({ show: true, title, msg, onConfirm });
    };

    const showToast = (msg, type = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, msg, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    };

    // Carga inicial (initApp)
    useEffect(() => {
        const initApp = async () => {
            try {
                // Cargar datos de Supabase en paralelo
                const [resRemitos, resDist, resPlans, resCta, resAlq] = await Promise.all([
                    supabase.from('app_state').select('data').eq('id', 'remitos').maybeSingle(),
                    supabase.from('app_state').select('data').eq('id', 'distribuidor').maybeSingle(),
                    supabase.from('app_state').select('data').eq('id', 'planes_socio').maybeSingle(),
                    supabase.from('app_state').select('data').eq('id', 'cuenta_corriente').maybeSingle(),
                    supabase.from('app_state').select('data').eq('id', 'alquiler').maybeSingle()
                ]);

                // Compatibilidad de data structures {rows, nid} vs simple array
                let loadedRows = Array.isArray(resRemitos.data?.data) ? resRemitos.data.data : (resRemitos.data?.data?.rows || []);
                let loadedDist = resDist.data?.data || { pagos: [], pedidos: [], saldoInicial: null, ajustes: [] };

                let loadedPlans = resPlans.data?.data?.plans || [];
                let loadedNplan = resPlans.data?.data?.nplan || 1;
                let loadedCta = resCta.data?.data || { pagos: [], extras: [] };

                // Migración: Si existen manualSocioItems en planes_socio, los movemos a extras de cuenta_corriente si no están
                let oldManualItems = resPlans.data?.data?.manualSocioItems || [];
                if (oldManualItems.length > 0) {
                    oldManualItems.forEach(it => {
                        const exists = (loadedCta.extras || []).some(ex => ex.id === it.id || (ex.label === it.desc && ex.amount === it.amount));
                        if (!exists) {
                            if (!loadedCta.extras) loadedCta.extras = [];
                            loadedCta.extras.push({ id: it.id || Date.now().toString() + Math.random(), label: it.desc, amount: it.amount });
                        }
                    });
                }

                let loadedAlq = resAlq.data?.data || { meses: [], config: { totalBS: 1850, socioBS: 600, mesInicio: '' } };
                if (!loadedAlq.config) loadedAlq.config = { totalBS: 1850, socioBS: 600, mesInicio: '' };

                // Backfill flete_monto_pagado / costo_monto_pagado para filas antiguas
                const rowsNeedingBackfill = loadedRows.filter(r =>
                    (r.flete_caja_id && r.flete_monto_pagado == null) ||
                    (r.costo_caja_id && r.costo_monto_pagado == null)
                );
                if (rowsNeedingBackfill.length > 0) {
                    const allIds = [
                        ...rowsNeedingBackfill.filter(r => r.flete_caja_id && r.flete_monto_pagado == null).map(r => r.flete_caja_id),
                        ...rowsNeedingBackfill.filter(r => r.costo_caja_id && r.costo_monto_pagado == null).map(r => r.costo_caja_id),
                    ].filter(Boolean);
                    const { data: cajaMovs } = await supabase.from('caja_movimientos').select('id, monto').in('id', allIds);
                    const montoMap = {};
                    (cajaMovs || []).forEach(m => { montoMap[m.id] = parseFloat(m.monto) || 0; });
                    let didBackfill = false;
                    loadedRows = loadedRows.map(r => {
                        let updated = { ...r };
                        if (r.flete_caja_id && r.flete_monto_pagado == null && montoMap[r.flete_caja_id] != null) {
                            updated.flete_monto_pagado = montoMap[r.flete_caja_id];
                            didBackfill = true;
                        }
                        if (r.costo_caja_id && r.costo_monto_pagado == null && montoMap[r.costo_caja_id] != null) {
                            updated.costo_monto_pagado = montoMap[r.costo_caja_id];
                            didBackfill = true;
                        }
                        return updated;
                    });
                    if (didBackfill) {
                        await supabase.from('app_state').upsert({ id: 'remitos', data: loadedRows });
                    }
                }

                // Si no hay filas, inyectamos historial real
                if (loadedRows.length === 0) {
                    loadedRows = [
                        { id: 1, nro: '3737-8350', fecha: '2026-02-03', cajas: '3', kg: '40', precio_remito: '54852', compre: '54800', cambio: '0.0062', cg: '2', cm: '1', cp: '0', skg: '6.9', scaj: '0.4', smonto: '219600', pedido: '7 COMIC M BOLIVIA 24-1', pago_aprox: '1268890', pagos_dist: '', tc_dist: '0.0062', selected: false },
                        { id: 2, nro: '9940-18495', fecha: '2026-02-09', cajas: '2', kg: '22', precio_remito: '56830', compre: '56800', cambio: '0.0062', cg: '2', cm: '0', cp: '0', skg: '7.65', scaj: '0.4', smonto: '239000', pedido: '8 COMIC M BOLIVIA 31-1', pago_aprox: '697920', pagos_dist: '', tc_dist: '0.0062', selected: false },
                        { id: 3, nro: '', fecha: '2026-02-15', cajas: '0', kg: '0', precio_remito: '0', compre: '0', cambio: '0.0000', cg: '0', cm: '0', cp: '0', skg: '0', scaj: '0', smonto: '220735', pedido: '9 COMIC M BOLIVIA 7-2', pago_aprox: '2273915', pagos_dist: '', tc_dist: '0.0062', selected: false },
                        { id: 4, nro: '3737-8675', fecha: '2026-02-23', cajas: '11', kg: '140', precio_remito: '207354', compre: '208000', cambio: '0.0063', cg: '11', cm: '0', cp: '0', skg: '5.4', scaj: '0.3', smonto: '244200', pedido: '10 COMIC M BOLIVIA 14-2', pago_aprox: '2209620', pagos_dist: '', tc_dist: '0.0063', selected: false },
                        { id: 5, nro: '3737-8813', fecha: '2026-03-03', cajas: '1', kg: '13', precio_remito: '25845', compre: '0', cambio: '0.0000', cg: '0', cm: '0', cp: '0', skg: '0', scaj: '0', smonto: '215600', pedido: '11 COMIC M BOLIVIA 21-2', pago_aprox: '484375', pagos_dist: '', tc_dist: '0.0063', selected: false }
                    ];
                    if (!loadedDist.pedidos || loadedDist.pedidos.length === 0) {
                        loadedDist.pedidos = [
                            { nombre: '7 COMIC M BOLIVIA 24-1', monto: 1268890 },
                            { nombre: '8 COMIC M BOLIVIA 31-1', monto: 697920 },
                            { nombre: '9 COMIC M BOLIVIA 7-2', monto: 2273915 },
                            { nombre: '10 COMIC M BOLIVIA 14-2', monto: 2209620 },
                            { nombre: '11 COMIC M BOLIVIA 21-2', monto: 484375 }
                        ];
                    }
                }

                setRows(loadedRows);
                setDist(loadedDist);
                setPlans(loadedPlans);
                setNplan(loadedNplan);
                setCta(loadedCta);
                setAlq(loadedAlq);

                // TRICK: Sync on mount to ensure all pedidos have rows
                await syncDistToRows(loadedDist, loadedRows);
            } catch (error) {
                console.error('Error al inicializar la app desde Supabase:', error);
                // Fallback a array vacío por si falla la conexión
                setRows([{ id: 1, nro: '1', fecha: '', cajas: '', kg: '', precio_remito: '', compre: '', cambio: '', cg: '', cm: '', cp: '', skg: '', scaj: '', smonto: '', pedido: '', pago_aprox: '', pagos_dist: '', tc_dist: '', selected: false }]);
            } finally {
                setLoading(false);
            }
        };

        initApp();
    }, []);

    // Efecto para procesar Cargos Automáticos de Alquiler y agregar el mes en curso automáticamente
    useEffect(() => {
        if (!loading && activeTab === 'alquiler') {
            const checkAutoAlquiler = async () => {
                let changedAlq = false;
                let currentAlq = { ...alq };

                const now = new Date();
                const currentYm = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;

                if (!currentAlq.meses) currentAlq.meses = [];

                // 1. Si no hay meses, creamos el mes actual
                if (currentAlq.meses.length === 0) {
                    const cfg = currentAlq.config || {};
                    if (!cfg.mesInicio) {
                        return; // Omit auto-generate until they configure a start month
                    }
                    currentAlq.meses.push({
                        ym: cfg.mesInicio,
                        totalBS: cfg.totalBS || 1850,
                        socioBS: cfg.socioBS || 600,
                        tuParteBS: (cfg.totalBS || 1850) - (cfg.socioBS || 600),
                        cargado: false
                    });
                    changedAlq = true;
                }

                // 2. Revisar si hay meses vencidos para cargarlos a CTA y si hay que autogenerar el mes actual
                let lastYmIdx = currentAlq.meses.length - 1;
                let lastYm = currentAlq.meses[lastYmIdx].ym;

                // Mientras el último mes sea menor al mes actual, autogenerar siguientes
                while (lastYm < currentYm) {
                    let [y, m] = lastYm.split('-').map(Number);
                    m++; if (m > 12) { m = 1; y++; }
                    lastYm = `${y}-${m.toString().padStart(2, '0')}`;

                    const cfg = currentAlq.config || { totalBS: 1850, socioBS: 600 };
                    currentAlq.meses.push({
                        ym: lastYm,
                        totalBS: cfg.totalBS,
                        socioBS: cfg.socioBS,
                        tuParteBS: cfg.totalBS - cfg.socioBS,
                        cargado: false
                    });
                    changedAlq = true;
                }

                // Cargar meses vencidos a Socio (cta.extras)
                let currentCta = { ...cta };
                let changedCta = false;

                currentAlq.meses.forEach((mes, idx) => {
                    if (mes.ym < currentYm && !mes.cargado) {
                        currentAlq.meses[idx].cargado = true;
                        const desc = 'Alquiler Mes: ' + formatMesAlq(mes.ym);
                        const exists = (currentCta.extras || []).some(ex => ex.label === desc);
                        if (!exists) {
                            currentCta.extras.push({
                                id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 5),
                                label: desc,
                                amount: parseFloat(mes.socioBS) || 0
                            });
                            changedCta = true;
                        }
                        changedAlq = true;
                    }
                });

                if (changedAlq) {
                    setAlq(currentAlq);
                    saveAlq(currentAlq);
                }
                if (changedCta) {
                    setCta(currentCta);
                    saveCta(currentCta);
                }
            };
            checkAutoAlquiler();
        }
    }, [activeTab, loading, alq.meses?.length, cta, plans, nplan]);

    // Estados UI Distribuidor
    const [pedNombre, setPedNombre] = useState('');
    const [pedMonto, setPedMonto] = useState('');
    const [pagoFecha, setPagoFecha] = useState('');
    const [pagoMonto, setPagoMonto] = useState('');
    const [pagoTc, setPagoTc] = useState('');

    const handleChange = async (id, field, value) => {
        const newRows = rows.map(r => r.id === id ? { ...r, [field]: value } : r);
        setRows(newRows);
        await saveRemitos(newRows);
    };

    const addRow = async () => {
        const newId = rows.length > 0 ? Math.max(...rows.map(r => r.id)) + 1 : 1;
        const newRows = [...rows, {
            id: newId,
            nro: `${newId}`,
            fecha: '',
            cajas: '',
            kg: '',
            precio_remito: '',
            compre: '',
            cambio: '',
            cg: '',
            cm: '',
            cp: '',
            skg: '',
            scaj: '',
            smonto: '',
            pedido: '',
            pago_aprox: '',
            pagos_dist: '',
            tc_dist: '',
            selected: false
        }];
        setRows(newRows);
        await saveRemitos(newRows);
    };

    const deleteSelectedRows = async () => {
        const remainingRows = rows.filter(r => !r.selected);
        let updatedRows;
        if (remainingRows.length === 0) {
            // Si el usuario elimina todas las filas, inicializamos con una vacía por defecto
            updatedRows = [{ id: 1, nro: '1', fecha: '', cajas: '', kg: '', precio_remito: '', compre: '', cambio: '', cg: '', cm: '', cp: '', skg: '', scaj: '', selected: false }];
        } else {
            updatedRows = remainingRows;
        }
        setRows(updatedRows);
        await saveRemitos(updatedRows);
    };

    const handleSelectAll = (e) => {
        const checked = e.target.checked;
        const newRows = rows.map(r => ({ ...r, selected: checked }));
        setRows(newRows);
        // No guardamos inmediatamente la selección masiva para evitar bloqueos innecesarios a Supabase
    };

    // --- FUNCIONES ASÍNCRONAS DE PERSISTENCIA A SUPABASE ---
    const saveRemitos = async (currentRows) => {
        try {
            await supabase.from('app_state').upsert({ id: 'remitos', data: currentRows });
        } catch (error) {
            console.error('Error guardando remitos en Supabase:', error);
        }
    };

    const saveDist = async (currentDist) => {
        try {
            await supabase.from('app_state').upsert({ id: 'distribuidor', data: currentDist });
        } catch (error) {
            console.error('Error guardando distribuidor en Supabase:', error);
        }
    };
    // ----------------------------------------------------

    const handleRegistrarFlete = async () => {
        if (!fleteModal) return;
        const { rowId, fleteBS, nro, fecha } = fleteModal;
        if (!fleteBS || fleteBS <= 0) { showToast('El flete es 0, no hay nada que registrar.', 'error'); return; }
        setFleteSaving(true);
        try {
            const row = rows.find(r => r.id === rowId);
            const cg = num(row?.cg), cm = num(row?.cm), cp = num(row?.cp);
            const partes = [];
            if (cg > 0) partes.push(`${cg}G`);
            if (cm > 0) partes.push(`${cm}M`);
            if (cp > 0) partes.push(`${cp}P`);
            const detalleCajas = partes.length > 0 ? ' · ' + partes.join(' ') : '';
            const nroLabel = nro ? `Remito ${nro}` : 'Remito s/n';
            const fechaLabel = fecha ? ` (${fecha})` : '';
            const concepto = `Flete — ${nroLabel}${detalleCajas}${fechaLabel}`;
            const { data: cajaMov, error } = await supabase.from('caja_movimientos').insert([{
                turno_id: null,
                tipo: 'EGRESO',
                categoria: 'Flete / Envío',
                concepto,
                monto: fleteBS,
                metodo_pago: fleteMetodo,
                origen: 'Envios',
            }]).select('id').single();
            if (error) throw error;
            const flete_caja_id = cajaMov?.id || null;
            const newRows = rows.map(r => r.id === rowId
                ? { ...r, flete_caja_id, flete_monto_pagado: fleteBS }
                : r);
            setRows(newRows);
            await saveRemitos(newRows);
            setFleteModal(null);
            showToast('Flete registrado como egreso correctamente.', 'success');
        } catch (e) {
            showToast('Error al registrar el flete: ' + e.message, 'error');
        } finally {
            setFleteSaving(false);
        }
    };

    const handleRegistrarCosto = async () => {
        if (!costoModal) return;
        const { rowId, costoBS, nro, fecha, compre, cambio } = costoModal;
        if (!costoBS || costoBS <= 0) { showToast('El costo es 0, no hay nada que registrar.', 'error'); return; }
        setCostoSaving(true);
        try {
            const nroLabel = nro ? `Remito ${nro}` : 'Remito s/n';
            const fechaLabel = fecha ? ` (${fecha})` : '';
            const detalle = compre && cambio ? ` · ARS ${Number(compre).toLocaleString()} × ${cambio}` : '';
            const concepto = `Envío AR — ${nroLabel}${detalle}${fechaLabel}`;
            const { data: cajaMov, error } = await supabase.from('caja_movimientos').insert([{
                turno_id: null,
                tipo: 'EGRESO',
                categoria: 'Envío Argentina',
                concepto,
                monto: costoBS,
                metodo_pago: costoMetodo,
                origen: 'Proveedores',
            }]).select('id').single();
            if (error) throw error;
            const costo_caja_id = cajaMov?.id || null;
            const newRows = rows.map(r => r.id === rowId
                ? { ...r, costo_caja_id, costo_monto_pagado: costoBS }
                : r);
            setRows(newRows);
            await saveRemitos(newRows);
            setCostoModal(null);
            showToast('Envío AR registrado como egreso correctamente.', 'success');
        } catch (e) {
            showToast('Error al registrar el costo: ' + e.message, 'error');
        } finally {
            setCostoSaving(false);
        }
    };

    const handleRegistrarFleteRestante = async () => {
        if (!fleteModal) return;
        const { rowId, fleteBS, nro, fecha } = fleteModal;
        if (!fleteBS || fleteBS <= 0) return;
        setFleteSaving(true);
        try {
            const row = rows.find(r => r.id === rowId);
            const cg = num(row?.cg), cm = num(row?.cm), cp = num(row?.cp);
            const partes = [];
            if (cg > 0) partes.push(`${cg}G`);
            if (cm > 0) partes.push(`${cm}M`);
            if (cp > 0) partes.push(`${cp}P`);
            const detalleCajas = partes.length > 0 ? ' · ' + partes.join(' ') : '';
            const nroLabel = nro ? `Remito ${nro}` : 'Remito s/n';
            const fechaLabel = fecha ? ` (${fecha})` : '';
            const concepto = `Flete (restante) — ${nroLabel}${detalleCajas}${fechaLabel}`;
            const { data: cajaMov, error } = await supabase.from('caja_movimientos').insert([{
                turno_id: null, tipo: 'EGRESO', categoria: 'Flete / Envío',
                concepto, monto: fleteBS, metodo_pago: fleteMetodo, origen: 'Envios',
            }]).select('id').single();
            if (error) throw error;
            const nuevoPagado = (num(row?.flete_monto_pagado) + fleteBS);
            const newRows = rows.map(r => r.id === rowId ? { ...r, flete_monto_pagado: nuevoPagado } : r);
            setRows(newRows);
            await saveRemitos(newRows);
            setFleteModal(null);
            showToast(`Restante de flete (Bs ${fleteBS.toFixed(2)}) registrado.`, 'success');
        } catch (e) {
            showToast('Error: ' + e.message, 'error');
        } finally {
            setFleteSaving(false);
        }
    };

    const handleRegistrarCostoRestante = async () => {
        if (!costoModal) return;
        const { rowId, costoBS, nro, fecha, compre, cambio } = costoModal;
        if (!costoBS || costoBS <= 0) return;
        setCostoSaving(true);
        try {
            const row = rows.find(r => r.id === rowId);
            const nroLabel = nro ? `Remito ${nro}` : 'Remito s/n';
            const fechaLabel = fecha ? ` (${fecha})` : '';
            const detalle = compre && cambio ? ` · ARS ${Number(compre).toLocaleString()} × ${cambio}` : '';
            const concepto = `Envío AR (restante) — ${nroLabel}${detalle}${fechaLabel}`;
            const { data: cajaMov, error } = await supabase.from('caja_movimientos').insert([{
                turno_id: null, tipo: 'EGRESO', categoria: 'Envío Argentina',
                concepto, monto: costoBS, metodo_pago: costoMetodo, origen: 'Proveedores',
            }]).select('id').single();
            if (error) throw error;
            const nuevoPagado = (num(row?.costo_monto_pagado) + costoBS);
            const newRows = rows.map(r => r.id === rowId ? { ...r, costo_monto_pagado: nuevoPagado } : r);
            setRows(newRows);
            await saveRemitos(newRows);
            setCostoModal(null);
            showToast(`Restante de envío AR (Bs ${costoBS.toFixed(2)}) registrado.`, 'success');
        } catch (e) {
            showToast('Error: ' + e.message, 'error');
        } finally {
            setCostoSaving(false);
        }
    };

    // Función para inyectar los datos del Distribuidor en los Remitos (Adaptado a React State)
    const syncDistToRows = async (latestDist = dist, currentRows = rows) => {
        try {
            // 1. Sincronizar los pedidos del distribuidor a las filas en orden de creación
            let updatedRows1 = [...currentRows];
            
            latestDist.pedidos.forEach((ped, idx) => {
                if (idx < updatedRows1.length) {
                    // Update existing row
                    updatedRows1[idx] = { 
                        ...updatedRows1[idx], 
                        pedido: ped.nombre || '', 
                        pago_aprox: ped.monto ? String(ped.monto) : '' 
                    };
                } else {
                    // CREATE new row if we have more pedidos than rows
                    const newId = updatedRows1.length > 0 ? Math.max(...updatedRows1.map(r => r.id || 0)) + 1 : 1;
                    updatedRows1.push({
                        id: newId,
                        nro: `${newId}`,
                        fecha: new Date().toISOString().split('T')[0],
                        cajas: '0',
                        kg: '0',
                        precio_remito: '0',
                        compre: '0',
                        cambio: '0',
                        cg: '0',
                        cm: '0',
                        cp: '0',
                        skg: '0',
                        scaj: '0',
                        smonto: '0',
                        pedido: ped.nombre || '',
                        pago_aprox: ped.monto ? String(ped.monto) : '',
                        pagos_dist: '0',
                        tc_dist: '0',
                        selected: false
                    });
                }
            });

            // 2. Recalcular el FIFO con las filas asignadas
            let fifoResults = calcDistFIFO(latestDist, updatedRows1);

            // 3. Propagar el TC Ponderado a cada fila de remito
            const finalRows = updatedRows1.map(r => {
                let debtMatch = fifoResults.debitos.find(d => d.id === r.id);
                if (debtMatch) {
                    return { ...r, tc_dist: debtMatch.tcPond || 0, pagos_dist: debtMatch.cubierto || 0 };
                }
                return r;
            });

            // 4. Actualizar estado
            setRows(finalRows);
            await saveRemitos(finalRows);
        } catch (e) {
            console.error('Error al sincronizar distribuidor con remitos:', e);
        }
    };

    // Evento para guardar un Pedido
    const handleSavePed = async () => {
        let nombre = pedNombre.trim();
        let monto = parseFloat(pedMonto) || 0;

        if (!monto) {
            showToast('Ingresa un monto válido para el pedido.', 'error');
            return;
        }

        const newDist = { ...dist, pedidos: [...dist.pedidos, { nombre: nombre || null, monto: monto }] };
        setDist(newDist);
        await saveDist(newDist);

        // Limpiar inputs
        setPedNombre('');
        setPedMonto('');

        // Sincronizar con los remitos usando el estado fresco
        await syncDistToRows(newDist);
        showToast('Pedido guardado y sincronizado.', 'success');
    };

    // Evento para guardar un Pago
    const handleSavePago = async () => {
        let fecha = pagoFecha;
        let monto = parseFloat(pagoMonto) || 0;
        let tc = parseFloat(pagoTc) || 0;

        if (!monto) {
            showToast('Ingresa un monto válido para el pago.', 'error');
            return;
        }

        const newDist = { ...dist, pagos: [...dist.pagos, { fecha: fecha, monto: monto, tc: tc || null }] };
        setDist(newDist);
        await saveDist(newDist);

        // Registrar en contabilidad como EGRESO
        const montoBS = tc > 0 ? monto * tc : monto;
        await supabase.from('caja_movimientos').insert([{
            turno_id: null,
            tipo: 'EGRESO',
            categoria: 'Pago Distribuidor',
            concepto: `Pago distribuidor${fecha ? ' · ' + fecha : ''} · ARS ${monto.toLocaleString()}${tc > 0 ? ' (TC ' + tc + ')' : ''}`,
            monto: montoBS,
            metodo_pago: 'Efectivo',
            origen: 'Proveedores',
        }]);

        // Limpiar inputs
        setPagoFecha('');
        setPagoMonto('');
        setPagoTc('');

        // Sincronizar con los remitos
        await syncDistToRows(newDist);
        showToast('Pago guardado, sincronizado y contabilizado.', 'success');
    };

    const startEditPedido = (idx, ped) => {
        setEditingPedidoIdx(idx);
        setEditPedidoData({ nombre: ped.nombre || '', monto: ped.monto || '' });
    };

    const saveEditPedido = async (idx) => {
        const amt = parseFloat(editPedidoData.monto) || 0;
        const updated = [...dist.pedidos];
        updated[idx] = { ...updated[idx], monto: amt, nombre: editPedidoData.nombre };
        const newDist = { ...dist, pedidos: updated };
        setDist(newDist);
        await saveDist(newDist);
        await syncDistToRows(newDist);
        setEditingPedidoIdx(null);
    };

    const cancelEditPedido = () => setEditingPedidoIdx(null);

    const handleDeletePedido = async (idx) => {
        openConfirm('Confirmar Eliminación', '¿Deseas eliminar este pedido?', async () => {
            const updated = dist.pedidos.filter((_, i) => i !== idx);
            const newDist = { ...dist, pedidos: updated };
            setDist(newDist);
            await saveDist(newDist);
            await syncDistToRows(newDist);
            showToast('Pedido eliminado correctamente.', 'success');
        });
    };

    const startEditPago = (idx, pago) => {
        setEditingPagoIdx(idx);
        setEditPagoData({ fecha: pago.fecha || '', monto: pago.monto || '', tc: pago.tc || '' });
    };

    const saveEditPago = async (idx) => {
        const updated = [...dist.pagos];
        updated[idx] = {
            ...updated[idx],
            monto: parseFloat(editPagoData.monto) || 0,
            tc: parseFloat(editPagoData.tc) || 0,
            fecha: editPagoData.fecha
        };
        const newDist = { ...dist, pagos: updated };
        setDist(newDist);
        await saveDist(newDist);
        await syncDistToRows(newDist);
        setEditingPagoIdx(null);
    };

    const cancelEditPago = () => setEditingPagoIdx(null);

    const handleDeletePago = async (idx) => {
        openConfirm('Confirmar Eliminación', '¿Deseas eliminar este pago?', async () => {
            const updated = dist.pagos.filter((_, i) => i !== idx);
            const newDist = { ...dist, pagos: updated };
            setDist(newDist);
            await saveDist(newDist);
            await syncDistToRows(newDist);
            showToast('Pago eliminado correctamente.', 'success');
        });
    };

    const saveSaldoInicial = async () => {
        const monto = parseFloat(editSaldoMonto);
        if (!isNaN(monto)) {
            const newDist = { ...dist, saldoInicial: { monto, tipo: 'favor' } };
            setDist(newDist);
            await saveDist(newDist);
            await syncDistToRows(newDist);
        }
        setIsEditingSaldo(false);
    };

    const handleDeleteAjuste = async (idx) => {
        openConfirm('Confirmar Eliminación', '¿Deseas eliminar este ajuste?', async () => {
            const updated = (dist.ajustes || []).filter((_, i) => i !== idx);
            const newDist = { ...dist, ajustes: updated };
            setDist(newDist);
            await saveDist(newDist);
            await syncDistToRows(newDist);
            showToast('Ajuste eliminado correctamente.', 'success');
        });
    };

    // Resumen variables
    let count = 0, tARS = 0, tBS = 0, tFlete = 0, tTotal = 0;
    let tCajas = 0, tKg = 0, tLibros = 0, tGrandSummary = 0, tSocioTotal = 0;

    // Calcular costos totales sumando el cálculo de cada fila
    rows.forEach(r => {
        count++;
        let compre = num(r.compre);
        let cambio = num(r.cambio);
        let costoBS = compre * cambio;

        let cg = num(r.cg), cm = num(r.cm), cp = num(r.cp);
        let fleteBS = (cg * FG) + (cm * FM) + (cp * FP);
        tARS += compre;
        tBS += costoBS;
        tFlete += fleteBS;
        tTotal += costoBS + fleteBS;
        tCajas += num(r.cajas);
        tKg += num(r.kg);

        // Costo de libros (Distribuidor)
        let tcUsar = num(r.tc_dist) || 0;
        let costoLibroFila = num(r.pago_aprox) * tcUsar;
        tLibros += costoLibroFila;

        tGrandSummary += (costoBS + fleteBS) + costoLibroFila;

        // Sumar total del socio de esta fila
        tSocioTotal += num(r._sTotBS);
    });

    let tMisPedidos = tGrandSummary - tSocioTotal;

    // Contar seleccionados
    const selectedCount = rows.filter(r => r.selected).length;

    // Calcular estado global del distribuidor para el Dashboard
    const distFifoResult = calcDistFIFO(dist, rows);
    const isAllSelected = rows.length > 0 && rows.every(r => r.selected);

    // ==========================================
    // LÓGICA SOCIO
    // ==========================================
    const savePlans = async (newPlans, newNplan) => {
        try { await supabase.from('app_state').upsert({ id: 'planes_socio', data: { plans: newPlans, nplan: newNplan } }); } catch (err) { }
    };
    const getAvailableItems = () => {
        let used = {};
        plans.forEach(p => { if (p.items) p.items.forEach(it => used[`${it.remId}-${it.type}`] = true); });
        let items = [];
        rows.forEach(r => {
            let nro = r.pedido || r.nro || ('#' + r.id);
            let sEnv = parseFloat(r._sEnvBS) || 0;
            let sFlt = parseFloat(r._sFltBS) || 0;
            let sPed = parseFloat(r._sPedBS) || 0;
            if (sEnv !== 0 && !used[`${r.id}-envio`]) items.push({ remId: r.id, type: 'envio', label: 'Envío Arg', nro, amount: sEnv });
            if (sFlt !== 0 && !used[`${r.id}-flete`]) items.push({ remId: r.id, type: 'flete', label: 'Flete Bol', nro, amount: sFlt });
            if (sPed !== 0 && !used[`${r.id}-pedido`]) items.push({ remId: r.id, type: 'pedido', label: 'Costo Libros', nro, amount: sPed });
        });
        // Agregamos ítems extras manuales (desde cta.extras)
        (cta.extras || []).forEach(ex => {
            if (!used[`extra-${ex.id}-extra`]) {
                items.push({ remId: `extra-${ex.id}`, type: 'extra', label: ex.label, nro: 'OTROS CARGOS / ALQUILER', amount: ex.amount });
            }
        });

        return items;
    };
    const availSocioItems = getAvailableItems();

    const handleAddManualSocioItem = async () => {
        const desc = newSocioExtraDesc.trim();
        const bs = parseFloat(newSocioExtraBs);
        if (!desc || isNaN(bs)) return showToast('Descripción o monto inválido', 'error');

        const newItem = { id: Date.now().toString(), label: desc, amount: bs, isAlq: false };
        const newCta = { ...cta, extras: [...(cta.extras || []), newItem] };
        setCta(newCta);
        setNewSocioExtraDesc('');
        setNewSocioExtraBs('');
        await saveCta(newCta);
    };

    const handleDeleteManualSocioItem = async (id) => {
        const newCta = { ...cta, extras: (cta.extras || []).filter(item => item.id !== id) };
        setCta(newCta);
        setSelectedSocioItems({});
        await saveCta(newCta);
    };

    const handleAddExtraToPlan = async (planId) => {
        const toAdd = availSocioItems.filter(it => checkedItemsToAddToPlan[`${it.remId}-${it.type}`]);
        if (toAdd.length === 0) return showToast('Selecciona al menos un ítem.', 'error');

        const newPlans = plans.map(p => {
            if (p.id === planId) {
                return { ...p, items: [...p.items, ...toAdd] };
            }
            return p;
        });

        // Also deselect it from the global "Seleccionado" if it were checked there
        setSelectedSocioItems(prev => {
            const next = { ...prev };
            Object.keys(checkedItemsToAddToPlan).forEach(k => {
                if (checkedItemsToAddToPlan[k]) delete next[k];
            });
            return next;
        });

        setPlans(newPlans);
        setAddingItemToPlan(null);
        setCheckedItemsToAddToPlan({});
        await savePlans(newPlans, nplan);
    };

    const handleGeneratePlan = async () => {
        const toWrap = availSocioItems.filter(it => selectedSocioItems[`${it.remId}-${it.type}`]);
        if (toWrap.length === 0) { showToast('Selecciona al menos un ítem.', 'error'); return; }
        const newPlan = { id: nplan, fecha: new Date().toISOString().slice(0, 10), items: toWrap, pagos: [] };
        const newPlans = [...plans, newPlan];
        setPlans(newPlans);
        setNplan(nplan + 1);
        setSelectedSocioItems({});
        await savePlans(newPlans, nplan + 1);
        showToast(`Plan de pagos #${newPlan.id} generado correctamente.`, 'success');
    };

    const handleAddSelectedToExistingPlan = async (planId) => {
        const toAdd = availSocioItems.filter(it => selectedSocioItems[`${it.remId}-${it.type}`]);
        if (toAdd.length === 0) return showToast('Selecciona al menos un ítem.', 'error');

        const newPlans = plans.map(p => {
            if (p.id === planId) {
                return { ...p, items: [...p.items, ...toAdd] };
            }
            return p;
        });

        setSelectedSocioItems({});
        setPlans(newPlans);
        await savePlans(newPlans, nplan);
        showToast(`Ítems agregados al Plan #${planId}`, 'success');
    };

    const handleAddPagoPlan = async (pid) => {
        const newPlans = [...plans];
        const p = newPlans.find(x => x.id === pid);
        if (p) {
            if (!p.pagos) p.pagos = [];
            const newPago = {
                id: 'pg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                monto: 0,
                fecha: new Date().toISOString().slice(0, 10),
                nota: `Pago Plan #${pid}`,
                banco: 'Banco Unión (QR/Transf)',
                caja_id: null,
            };
            p.pagos.push(newPago);
            setPlans(newPlans);

            // Sync with CTA
            const newCta = { ...cta, pagos: [...(cta.pagos || []), { ...newPago, isFromPlan: true, planId: pid }] };
            setCta(newCta);

            await savePlans(newPlans, nplan);
            await saveCta(newCta);
        }
    };

    const updatePagoPlan = async (pid, pidx, field, val) => {
        const newPlans = [...plans];
        const p = newPlans.find(x => x.id === pid);
        if (p) {
            const pg = p.pagos[pidx];
            pg[field] = field === 'monto' ? (parseFloat(val) || 0) : val;
            setPlans(newPlans);

            // Sync with CTA
            if (pg.id) {
                const newCta = { ...cta };
                const ctp = (newCta.pagos || []).find(x => x.id === pg.id);
                if (ctp) {
                    ctp[field] = pg[field];
                    setCta(newCta);
                    await saveCta(newCta);
                }
            }

            await savePlans(newPlans, nplan);
        }
    };

    // Sincroniza el pago con caja_movimientos al confirmar edición
    const handleConfirmarPagoPlan = async (pid, pidx) => {
        setEditingPagoPlanKey(null);
        const newPlans = [...plans];
        const p = newPlans.find(x => x.id === pid);
        if (!p) return;
        const pg = p.pagos[pidx];
        if (!pg || pg.monto <= 0) return;

        const concepto = `Pago Plan #${pid}${pg.nota ? ' — ' + pg.nota : ''}`;
        if (pg.caja_id) {
            // Actualizar registro existente
            await supabase.from('caja_movimientos').update({
                monto: pg.monto,
                concepto,
                metodo_pago: pg.banco || 'Banco Unión (QR/Transf)',
            }).eq('id', pg.caja_id);
        } else {
            // Crear nuevo registro en contabilidad
            const { data } = await supabase.from('caja_movimientos').insert({
                tipo: 'INGRESO',
                categoria: 'Transferencia Recibida',
                monto: pg.monto,
                concepto,
                metodo_pago: pg.banco || 'Banco Unión (QR/Transf)',
                origen: 'Planes',
            }).select('id').single();
            if (data?.id) {
                pg.caja_id = data.id;
                // Sync CTA
                const newCta = { ...cta };
                const ctp = (newCta.pagos || []).find(x => x.id === pg.id);
                if (ctp) { ctp.caja_id = data.id; setCta(newCta); await saveCta(newCta); }
                await savePlans(newPlans, nplan);
            }
        }
        showToast('Pago registrado en contabilidad.', 'success');
    };

    const deletePagoPlan = async (pid, pidx) => {
        openConfirm('Confirmar Eliminación', '¿Borrar pago del plan?', async () => {
            const newPlans = [...plans];
            const p = newPlans.find(x => x.id === pid);
            if (p) {
                const pg = p.pagos[pidx];

                // Eliminar de caja_movimientos si existe
                if (pg.caja_id) {
                    await supabase.from('caja_movimientos').delete().eq('id', pg.caja_id);
                }

                p.pagos.splice(pidx, 1);
                setPlans(newPlans);

                // Sync with CTA
                const newCta = { ...cta };
                if (pg.id) {
                    newCta.pagos = (newCta.pagos || []).filter(x => x.id !== pg.id);
                    setCta(newCta);
                    await saveCta(newCta);
                }

                await savePlans(newPlans, nplan);
                showToast('Pago eliminado correctamente.', 'success');
            }
        });
    };

    const handleUpdateExtra = async (id, field, val) => {
        const newCta = { ...cta };
        const idx = newCta.extras.findIndex(ex => ex.id === id);
        if (idx !== -1) {
            newCta.extras[idx][field] = field === 'amount' ? (parseFloat(val) || 0) : val;

            // Si el ítem está en algún plan, también debemos actualizarlo allí
            const newPlans = plans.map(p => ({
                ...p,
                items: p.items.map(it => {
                    if (it.remId === `extra-${id}` && it.type === 'extra') {
                        return { ...it, label: field === 'label' ? val : it.label, amount: field === 'amount' ? (parseFloat(val) || 0) : it.amount };
                    }
                    return it;
                })
            }));

            setCta(newCta);
            setPlans(newPlans);
            await saveCta(newCta);
            await savePlans(newPlans, nplan);
        }
    };


    const deleteItemFromPlan = async (pid, itemKey) => {
        const newPlans = plans.map(p => {
            if (p.id === pid) {
                return { ...p, items: p.items.filter(it => `${it.remId}-${it.type}` !== itemKey) };
            }
            return p;
        });
        setPlans(newPlans);
        await savePlans(newPlans, nplan);
    };

    const togglePlanExpand = (id) => {
        setExpandedPlans(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // ==========================================
    // LÓGICA CUENTA CORRIENTE (CTA)
    // ==========================================
    const saveCta = async (newCta) => {
        try { await supabase.from('app_state').upsert({ id: 'cuenta_corriente', data: newCta }); } catch (err) { }
    };
    const ctaTotalDeuda = () => {
        let fromSocioDisp = availSocioItems.reduce((s, it) => s + (it.amount || 0), 0);
        let fromPlans = plans.reduce((acc, p) => acc + p.items.reduce((s, it) => s + (it.amount || 0), 0), 0);
        return fromSocioDisp + fromPlans;
    };
    const ctaTotalPagado = () => (cta.pagos || []).reduce((s, p) => s + (parseFloat(p.monto) || 0), 0);
    const ctaDeuda = ctaTotalDeuda();
    const ctaPagado = ctaTotalPagado();
    const ctaSaldo = ctaDeuda - ctaPagado;
    const ctaPct = ctaDeuda > 0 ? Math.min(100, Math.round((ctaPagado / ctaDeuda) * 100)) : 0;

    const handleSaveExtraCta = handleAddManualSocioItem; // Alias for reuse

    const handleAddPagoCta = async () => {
        const newCta = { ...cta, pagos: [...(cta.pagos || []), { monto: 0, fecha: new Date().toISOString().slice(0, 10) }] };
        setCta(newCta);
        await saveCta(newCta);
    };

    const updatePagoCta = async (idx, field, val) => {
        const newCta = { ...cta };
        const pg = newCta.pagos[idx];
        pg[field] = field === 'monto' ? (parseFloat(val) || 0) : val;
        setCta(newCta);

        // Sync with Plan
        if (pg.isFromPlan && pg.planId && pg.id) {
            const newPlans = plans.map(p => {
                if (p.id === pg.planId) {
                    const ppg = (p.pagos || []).find(x => x.id === pg.id);
                    if (ppg) ppg[field] = pg[field];
                    return { ...p };
                }
                return p;
            });
            setPlans(newPlans);
            await savePlans(newPlans, nplan);
        }

        await saveCta(newCta);
    };

    const handleDelExtraCta = async (idx) => {
        openConfirm('Confirmar Eliminación', '¿Seguro que deseas eliminar este cargo extra?', async () => {
            const newCta = { ...cta };
            newCta.extras.splice(idx, 1);
            setCta(newCta);
            await saveCta(newCta);
            showToast('Cargo extra eliminado.', 'success');
        });
    };

    const handleDelPagoCta = async (idx) => {
        openConfirm('¡ATENCIÓN CRÍTICA!', '¿Estás seguro de que deseas eliminar este PAGO?\n\nSi el pago proviene de un plan de pagos, también será eliminado de dicho plan. Esta acción no se puede deshacer.', async () => {
            const newCta = { ...cta };
            const pg = newCta.pagos[idx];
            newCta.pagos.splice(idx, 1);
            setCta(newCta);

            // Sync with Plan
            if (pg.isFromPlan && pg.planId && pg.id) {
                const newPlans = plans.map(p => {
                    if (p.id === pg.planId) {
                        return { ...p, pagos: (p.pagos || []).filter(x => x.id !== pg.id) };
                    }
                    return p;
                });
                setPlans(newPlans);
                await savePlans(newPlans, nplan);
            }

            await saveCta(newCta);
            showToast('Pago eliminado correctamente.', 'success');
        });
    };

    // ==========================================
    // LÓGICA ALQUILER (ALQ)
    // ==========================================
    const saveAlq = async (newAlq) => {
        try { await supabase.from('app_state').upsert({ id: 'alquiler', data: newAlq }); } catch (err) { }
    };
    // Alquiler helpers
    const formatMesAlq = (ym) => {
        if (!ym) return '';
        const [year, month] = ym.split('-');
        const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        return `${meses[parseInt(month, 10) - 1]} ${year}`;
    };

    const handleAddAlq = async () => {
        let lastYm = '';
        if (alq.meses && alq.meses.length > 0) {
            lastYm = alq.meses[alq.meses.length - 1].ym;
        } else {
            return showToast('Por favor, ingresa a "⚙ Configurar" y define el Mes de Inicio primero.', 'error');
        }

        let [year, month] = lastYm.split('-').map(Number);
        month += 1;
        if (month > 12) { month = 1; year += 1; }
        const nextYm = `${year}-${month.toString().padStart(2, '0')}`;

        const cfg = alq.config || { totalBS: 1850, socioBS: 600 };
        const tuParte = cfg.totalBS - cfg.socioBS;

        const newAlq = {
            ...alq,
            meses: [...(alq.meses || []), { ym: nextYm, totalBS: cfg.totalBS, socioBS: cfg.socioBS, tuParteBS: tuParte, cargado: false }]
        };
        setAlq(newAlq);
        await saveAlq(newAlq);
    };

    const handleSaveAlqConfig = async () => {
        const tBS = parseFloat(alqConfigData.totalBS) || 1850;
        const sBS = parseFloat(alqConfigData.socioBS) || 600;
        const mIni = alqConfigData.mesInicio || '';
        const newAlq = { ...alq, config: { totalBS: tBS, socioBS: sBS, mesInicio: mIni } };
        setAlq(newAlq);
        await saveAlq(newAlq);
        setShowConfigAlq(false);
    };
    const updateAlq = async (idx, field, val) => {
        const newAlq = { ...alq };
        newAlq.meses[idx][field] = (field === 'total' || field === 'pct') ? (parseFloat(val) || 0) : val;
        setAlq(newAlq);
        await saveAlq(newAlq);
    };
    const deleteAlq = async (idx) => {
        const m = alq.meses[idx];
        const newAlq = { ...alq };
        newAlq.meses.splice(idx, 1);
        setAlq(newAlq);
        await saveAlq(newAlq);

        if (m && m.ym) {
            const descTarget = 'Alquiler Mes: ' + formatMesAlq(m.ym);

            if (cta && cta.extras) {
                const newExtras = cta.extras.filter(ex => ex.label !== descTarget);
                if (newExtras.length !== cta.extras.length) {
                    const newCta = { ...cta, extras: newExtras };
                    setCta(newCta);
                    await saveCta(newCta);
                }
            }
        }
    };
    const pagarMiParteAlq = async (idx, metodo) => {
        const m = alq.meses[idx];
        const monto = parseFloat(m.totalBS) || 0; // Pagás el total, el socio te devuelve su parte
        if (!monto) return showToast('El monto total es 0. Configura el alquiler primero.', 'error');
        setAlqSaving(true);
        try {
            const newAlq = { ...alq };
            newAlq.meses = [...alq.meses];
            newAlq.meses[idx] = { ...alq.meses[idx], pagadoPorMi: true };
            setAlq(newAlq);
            await saveAlq(newAlq);
            await supabase.from('caja_movimientos').insert([{
                turno_id: null,
                tipo: 'EGRESO',
                categoria: 'Alquiler',
                concepto: `Alquiler ${formatMesAlq(m.ym)} — total pagado (socio debe devolver ${fBS(parseFloat(m.socioBS) || 0)})`,
                monto,
                metodo_pago: metodo || 'Efectivo Personal',
                origen: 'Proveedores',
            }]);
            setAlqPagoModal(null);
            showToast(`Alquiler ${formatMesAlq(m.ym)} registrado como egreso.`, 'success');
        } catch (e) {
            showToast('Error: ' + e.message, 'error');
        } finally {
            setAlqSaving(false);
        }
    };

    const cargarAlqToCta = async (idx) => {
        const m = alq.meses[idx];
        if (!m.ym || !m.totalBS) return showToast('Datos de mes incompletos.', 'error');
        let cuota = parseFloat(m.socioBS) || 0;

        const newItem = {
            id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 5),
            label: 'Alquiler Mes: ' + formatMesAlq(m.ym),
            amount: cuota,
            isAlq: true
        };
        const newCta = { ...cta, extras: [...(cta.extras || []), newItem] };
        setCta(newCta);

        const newAlq = { ...alq };
        newAlq.meses[idx].cargado = true;
        setAlq(newAlq);

        await saveCta(newCta);
        await saveAlq(newAlq);
        showToast('Alquiler agregado a los ítems del socio.', 'success');
    };

    if (loading) {
        return (
            <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'monospace' }}>
                <h2 style={{ color: 'var(--navy)' }}>Cargando datos desde la nube (Supabase)...</h2>
            </div>
        );
    }

    return (
        <div className="remitos-container">
            {/* Gestión del Distribuidor */}
            {activeTab === 'distribuidor' && (
                <div id="page-dist" style={{ marginBottom: '20px', fontFamily: '"DM Sans", sans-serif' }}>

                    {/* 1. TOP SUMMARY BAR (Punto de Partida) */}
                    <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginBottom: '1.5rem' }}>

                        {/* Header Azul Oscuro */}
                        <div style={{ background: 'var(--navy)', color: '#fff', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: '0.85rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: '#fff' }}>Punto de Partida</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                {isEditingSaldo ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <input
                                            type="number"
                                            value={editSaldoMonto}
                                            onChange={e => setEditSaldoMonto(e.target.value)}
                                            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)', width: '120px', color: '#000' }}
                                            placeholder="Monto ARS"
                                            autoFocus
                                            onKeyDown={e => e.key === 'Enter' && saveSaldoInicial()}
                                        />
                                        <button onClick={saveSaldoInicial} style={{ background: 'var(--ok)', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 12px', cursor: 'pointer', fontWeight: 'bold' }}>Guardar</button>
                                        <button onClick={() => setIsEditingSaldo(false)} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '4px', padding: '4px 12px', cursor: 'pointer' }}>Cancelar</button>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                        <span style={{ color: 'var(--ok)', fontWeight: 'bold', fontSize: '0.9rem' }}>
                                            Saldo a favor inicial: {dist.saldoInicial?.monto ? fARS_dist(dist.saldoInicial.monto) : '--'}
                                        </span>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                onClick={() => {
                                                    setEditSaldoMonto(dist.saldoInicial?.monto || '');
                                                    setIsEditingSaldo(true);
                                                }}
                                                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', borderRadius: '4px', padding: '4px 12px', fontSize: '0.75rem', cursor: 'pointer', transition: 'background 0.2s' }}
                                                onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                                                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                                            >Editar</button>
                                            <button
                                                onClick={() => {
                                                    openConfirm('Confirmar Eliminación', '¿Eliminar el saldo inicial?', () => {
                                                        const newDist = { ...dist, saldoInicial: null };
                                                        setDist(newDist);
                                                        saveDist(newDist);
                                                        showToast('Saldo inicial eliminado.', 'success');
                                                    });
                                                }}
                                                style={{ background: 'transparent', border: '1px solid rgba(235, 87, 87, 0.5)', color: '#eb5757', borderRadius: '4px', padding: '4px 12px', fontSize: '0.75rem', cursor: 'pointer', transition: 'background 0.2s' }}
                                                onMouseOver={e => e.currentTarget.style.background = 'rgba(235, 87, 87, 0.1)'}
                                                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                                            >Quitar</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 4 Cards (KPIs) */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'var(--border)', padding: '1px' }}>

                            {/* Card 1: Total Pagado ARS */}
                            <div style={{ background: '#fff', padding: '20px' }}>
                                <div style={{ fontSize: '0.65rem', color: '#000', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Total Pagado ARS</div>
                                <div style={{ fontSize: '1.3rem', color: 'var(--ok)', fontWeight: '900' }}>
                                    {fARS_dist((dist.pagos || []).reduce((s, p) => s + (parseFloat(p.monto) || 0), 0))}
                                </div>
                            </div>

                            {/* Card 2: Total Pedidos ARS */}
                            <div style={{ background: '#fff', padding: '20px' }}>
                                <div style={{ fontSize: '0.65rem', color: '#000', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Total Pedidos ARS</div>
                                <div style={{ fontSize: '1.3rem', color: 'var(--accent)', fontWeight: '900' }}>
                                    {fARS_dist((dist.pedidos || []).reduce((s, p) => s + (parseFloat(p.monto) || 0), 0))}
                                </div>
                            </div>

                            {/* Card 3: Saldo A Favor */}
                            <div style={{ background: '#fff', padding: '20px' }}>
                                <div style={{ fontSize: '0.65rem', color: '#000', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Saldo A Favor</div>
                                <div style={{ fontSize: '1.3rem', color: 'var(--ok)', fontWeight: '900' }}>
                                    {fARS_dist(distFifoResult.saldoARS)}
                                </div>
                            </div>

                            {/* Card 4: Pendiente Pedidos */}
                            <div style={{ background: '#fff', padding: '20px' }}>
                                <div style={{ fontSize: '0.65rem', color: '#000', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Pendiente Pedidos</div>
                                <div style={{ fontSize: '1.3rem', color: 'var(--navy)', fontWeight: '900' }}>
                                    {distFifoResult.debitos.reduce((s, d) => s + d.pendiente, 0) > 0
                                        ? fARS_dist(distFifoResult.debitos.reduce((s, d) => s + d.pendiente, 0))
                                        : '--'}
                                </div>
                            </div>

                        </div>
                        {/* Green bottom line indicator */}
                        <div style={{ height: '6px', background: distFifoResult.saldoARS > 0 ? 'var(--ok)' : (distFifoResult.debitos.reduce((s, d) => s + d.pendiente, 0) > 0 ? 'var(--warn)' : 'var(--navy)'), width: '100%' }}></div>
                    </div>

                    {/* 2. MAIN SPLIT VIEW (Pedidos vs Pagos) */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', marginBottom: '1.5rem' }}>

                        {/* LEFT: PEDIDOS AL DISTRIBUIDOR */}
                        <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                            <div style={{ background: 'var(--navy)', color: '#fff', padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px', color: '#fff' }}>
                                    <span>📄</span> PEDIDOS AL DISTRIBUIDOR
                                </h3>
                                <button onClick={() => setShowAddPedido(true)} style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: '4px', padding: '4px 12px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>+ Pedido</button>
                            </div>
                            <div style={{ padding: '0 16px' }}>
                                {(dist.pedidos || []).length === 0 ? (
                                    <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--border)' }}>No hay pedidos registrados</div>
                                ) : dist.pedidos.map((ped, idx) => (
                                    <div key={idx} style={{ padding: '10px 0', borderBottom: idx < dist.pedidos.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                        {editingPedidoIdx === idx ? (
                                            <div style={{ background: '#f8f9fa', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginBottom: '8px' }}>
                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 'bold', color: '#666', marginBottom: '2px', textTransform: 'uppercase' }}>Nombre</label>
                                                        <input type="text" value={editPedidoData.nombre} onChange={e => setEditPedidoData({ ...editPedidoData, nombre: e.target.value })} style={{ width: '100%', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem' }} />
                                                    </div>
                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 'bold', color: '#666', marginBottom: '2px', textTransform: 'uppercase' }}>Monto ARS</label>
                                                        <input type="number" value={editPedidoData.monto} onChange={e => setEditPedidoData({ ...editPedidoData, monto: e.target.value })} style={{ width: '100%', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem' }} />
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                    <button onClick={cancelEditPedido} style={{ padding: '4px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#666', fontSize: '0.75rem' }}>Cancelar</button>
                                                    <button onClick={() => saveEditPedido(idx)} style={{ padding: '4px 12px', background: 'var(--navy)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#fff', fontSize: '0.75rem' }}>Guardar</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <div style={{ fontWeight: '900', color: 'var(--navy)', fontSize: '1rem' }}>{fARS_dist(ped.monto || 0)}</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '2px' }}>{ped.nombre || 'Pedido sin nombre'}</div>
                                                    <div style={{ fontSize: '0.65rem', color: 'var(--sky)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <span>→</span> Remito asociado (TBD)
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    <button onClick={() => startEditPedido(idx, ped)} style={{ background: '#fff', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '4px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.75rem' }}>✏️</button>
                                                    <button onClick={() => handleDeletePedido(idx)} style={{ background: '#fff', border: '1px solid #eb5757', color: '#eb5757', borderRadius: '4px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.75rem' }}>❌</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* RIGHT: CRÉDITOS - PAGOS AL DISTRIBUIDOR */}
                        <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                            <div style={{ background: 'var(--navy)', color: '#fff', padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px', color: '#fff' }}>
                                    <span>💰</span> CRÉDITOS — PAGOS AL DISTRIBUIDOR
                                </h3>
                                <button onClick={() => setShowAddPago(true)} style={{ background: 'var(--ok)', border: 'none', color: '#fff', borderRadius: '4px', padding: '4px 12px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>+ Pago</button>
                            </div>
                            <div style={{ padding: '0 16px' }}>
                                {(dist.pagos || []).length === 0 ? (
                                    <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--border)' }}>No hay pagos registrados</div>
                                ) : dist.pagos.map((pago, idx) => (
                                    <div key={idx} style={{ padding: '10px 0', borderBottom: idx < dist.pagos.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                        {editingPagoIdx === idx ? (
                                            <div style={{ background: '#f8f9fa', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginBottom: '8px' }}>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 'bold', color: '#666', marginBottom: '2px', textTransform: 'uppercase' }}>Fecha</label>
                                                        <input type="date" value={editPagoData.fecha} onChange={e => setEditPagoData({ ...editPagoData, fecha: e.target.value })} style={{ width: '100%', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem' }} />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 'bold', color: '#666', marginBottom: '2px', textTransform: 'uppercase' }}>Monto ARS</label>
                                                        <input type="number" value={editPagoData.monto} onChange={e => setEditPagoData({ ...editPagoData, monto: e.target.value })} style={{ width: '100%', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem' }} />
                                                    </div>
                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 'bold', color: '#666', marginBottom: '2px', textTransform: 'uppercase' }}>TC del Día</label>
                                                        <input type="number" step="0.0001" value={editPagoData.tc} onChange={e => setEditPagoData({ ...editPagoData, tc: e.target.value })} style={{ width: '100%', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem' }} />
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                    <button onClick={cancelEditPago} style={{ padding: '4px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#666', fontSize: '0.75rem' }}>Cancelar</button>
                                                    <button onClick={() => saveEditPago(idx)} style={{ padding: '4px 12px', background: 'var(--ok)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#fff', fontSize: '0.75rem' }}>Guardar</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <div style={{ fontWeight: '900', color: 'var(--ok)', fontSize: '1rem' }}>{fARS_dist(pago.monto || 0)}</div>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 'bold', marginTop: '2px' }}>{fBS((pago.monto || 0) * (pago.tc || 0))} BS</div>
                                                    <div style={{ fontSize: '0.65rem', color: '#999', marginTop: '2px' }}>
                                                        {pago.fecha || 'Sin fecha'} · TC {pago.tc || '0.0000'}
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    <button onClick={() => startEditPago(idx, pago)} style={{ background: '#fff', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '4px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.75rem' }}>✏️</button>
                                                    <button onClick={() => handleDeletePago(idx)} style={{ background: '#fff', border: '1px solid #eb5757', color: '#eb5757', borderRadius: '4px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.75rem' }}>❌</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 3. STATUS GRID (Débitos - Estado de Pedidos FIFO) */}
                        <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginBottom: '1.5rem' }}>
                            <div style={{ background: 'var(--navy)', color: '#fff', padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px', color: '#fff' }}>
                                    <span>📊</span> DÉBITOS — ESTADO DE PEDIDOS FIFO
                                </h3>
                            </div>

                            <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                                {distFifoResult.debitos.length === 0 ? (
                                    <div style={{ color: 'var(--border)', textAlign: 'center', gridColumn: '1 / -1' }}>No hay débitos generados. Agrega pedidos y filas a la tabla.</div>
                                ) : distFifoResult.debitos.map((deb, idx) => {
                                    const isPagado = deb.pendiente <= 0;
                                    return (
                                        <div key={idx} style={{ border: `1px solid ${isPagado ? 'var(--ok)' : 'var(--border)'}`, borderRadius: '8px', padding: '12px', position: 'relative' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                                                <div>
                                                    <div style={{ fontWeight: '900', color: 'var(--navy)', fontSize: '1rem' }}>{fARS_dist(deb.monto)}</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#666' }}>{deb.nombre || 'Pedido TBD'}</div>
                                                </div>
                                                {isPagado ? (
                                                    <span style={{ background: 'rgba(39, 174, 96, 0.1)', color: 'var(--ok)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 'bold' }}>✓ Pagado</span>
                                                ) : (
                                                    <span style={{ background: 'rgba(235, 87, 87, 0.1)', color: '#eb5757', padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 'bold' }}>Pendiente: {fARS_dist(deb.pendiente)}</span>
                                                )}
                                            </div>

                                            {/* Progress Bar */}
                                            <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden', margin: '8px 0' }}>
                                                <div style={{ height: '100%', background: isPagado ? 'var(--ok)' : 'var(--accent)', width: `${deb.estadoPct}%`, transition: 'width 0.3s' }}></div>
                                            </div>

                                            <div style={{ fontSize: '0.7rem', color: '#666', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                <span>TC pond. <strong style={{ color: 'var(--accent)' }}>{deb.tcPond ? deb.tcPond.toFixed(7) : '0.000'}</strong></span>
                                                <span style={{ fontWeight: 'bold', color: 'var(--ok)' }}>{deb.cubiertoBS ? fBS(deb.cubiertoBS) : '0,00'} BS</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {
                                distFifoResult.saldoARS > 0 && (
                                    <div style={{ background: 'rgba(39, 174, 96, 0.05)', borderTop: '1px dashed var(--ok)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                                        <div style={{ background: 'var(--ok)', color: '#fff', width: '32px', height: '32px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.2rem' }}>✓</div>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--ok)', fontWeight: 'bold', textTransform: 'uppercase' }}>Saldo A Favor Restante</div>
                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                                                <span style={{ fontSize: '1.3rem', color: 'var(--ok)', fontWeight: '900' }}>{fARS(distFifoResult.saldoARS)}</span>
                                            </div>
                                        </div>
                                    </div>
                                )
                            }
                        </div>

                        {/* 4. AJUSTES / CORRECCIONES */}
                        <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginBottom: '1.5rem' }}>
                            <div style={{ background: 'var(--navy)', color: '#fff', padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px', color: '#fff' }}>
                                    <span>⚙️</span> AJUSTES / CORRECCIONES
                                </h3>
                                {!showAddAjuste && (
                                    <button onClick={() => setShowAddAjuste(true)} style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: '4px', padding: '4px 12px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>+ Ajuste</button>
                                )}
                            </div>
                            <div style={{ padding: '16px' }}>
                                {showAddAjuste && (
                                    <div style={{ background: '#f8f9fa', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: (dist.ajustes || []).length > 0 ? '20px' : '0' }}>
                                        <p style={{ fontSize: '0.75rem', color: '#666', margin: '0 0 12px 0' }}>Positivo = te acreditan · Negativo = te cobran de más</p>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.5fr) minmax(0,3fr)', gap: '12px', marginBottom: '12px' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#666', marginBottom: '4px', textTransform: 'uppercase' }}>Fecha</label>
                                                <input type="date" value={newAjuste.fecha} onChange={e => setNewAjuste({ ...newAjuste, fecha: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px' }} />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#666', marginBottom: '4px', textTransform: 'uppercase' }}>Monto ARS (Con Signo)</label>
                                                <input type="number" value={newAjuste.monto} onChange={e => setNewAjuste({ ...newAjuste, monto: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px' }} placeholder="Ej: 5000 o -3200" />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#666', marginBottom: '4px', textTransform: 'uppercase' }}>Descripción</label>
                                                <input type="text" value={newAjuste.descripcion} onChange={e => setNewAjuste({ ...newAjuste, descripcion: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px' }} placeholder="Ej: mal cobro, descuento..." />
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                            <button onClick={() => setShowAddAjuste(false)} style={{ padding: '6px 16px', background: '#fff', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>Cancelar</button>
                                            <button onClick={async () => {
                                                const amt = parseFloat(newAjuste.monto) || 0;
                                                if (amt === 0) return alert('Ingresa un monto válido.');
                                                const newDist = { ...dist, ajustes: [...(dist.ajustes || []), { fecha: newAjuste.fecha, monto: amt, descripcion: newAjuste.descripcion }] };
                                                setDist(newDist);
                                                await saveDist(newDist);
                                                await syncDistToRows(newDist);
                                                setShowAddAjuste(false);
                                                setNewAjuste({ fecha: '', monto: '', descripcion: '' });
                                            }} style={{ padding: '6px 16px', background: 'var(--accent)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#fff' }}>Guardar</button>
                                        </div>
                                    </div>
                                )}

                                {(dist.ajustes || []).length === 0 ? (
                                    !showAddAjuste && <div style={{ textAlign: 'center', color: 'var(--border)', padding: '10px 0', fontSize: '0.8rem' }}>Sin ajustes registrados.</div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {(dist.ajustes || []).map((aj, idx) => (
                                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid var(--border)' }}>
                                                <div>
                                                    <div style={{ fontWeight: '900', color: aj.monto > 0 ? 'var(--ok)' : 'var(--warn)', fontSize: '1rem' }}>
                                                        {aj.monto > 0 ? '+' : ''}{fARS_dist(aj.monto)}
                                                    </div>
                                                    <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '2px' }}>{aj.descripcion || 'Sin descripción'}</div>
                                                    <div style={{ fontSize: '0.65rem', color: '#999', marginTop: '2px' }}>{aj.fecha || 'Sin fecha'}</div>
                                                </div>
                                                <button onClick={() => handleDeleteAjuste(idx)} style={{ background: '#fff', border: '1px solid #eb5757', color: '#eb5757', borderRadius: '4px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.75rem' }}>❌</button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* MODAL: ADD PEDIDO */}
                        {
                            showAddPedido && (
                                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                                    <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '350px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                        <h3 style={{ margin: '0 0 16px 0', color: 'var(--navy)' }}>Nuevo Pedido</h3>
                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>Nombre / Referencia</label>
                                            <input type="text" value={newPedido.nombre} onChange={e => setNewPedido({ ...newPedido, nombre: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px' }} placeholder="Ej: Pedido Samsung" />
                                        </div>
                                        <div style={{ marginBottom: '20px' }}>
                                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>Monto (ARS)</label>
                                            <input type="number" value={newPedido.monto} onChange={e => setNewPedido({ ...newPedido, monto: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px' }} placeholder="Ej: 150000" />
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                                            <button onClick={() => setShowAddPedido(false)} style={{ flex: 1, padding: '10px', background: '#f1f1f1', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>Cancelar</button>
                                            <button onClick={() => {
                                                const newDist = { ...dist, pedidos: [...(dist.pedidos || []), { ...newPedido, monto: parseFloat(newPedido.monto) || 0 }] };
                                                setDist(newDist);
                                                saveDist(newDist);
                                                setShowAddPedido(false);
                                                setNewPedido({ nombre: '', monto: '' });
                                            }} style={{ flex: 1, padding: '10px', background: 'var(--accent)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#fff' }}>Guardar Pedido</button>
                                        </div>
                                    </div>
                                </div>
                            )
                        }

                        {/* MODAL: ADD PAGO */}
                        {
                            showAddPago && (
                                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                                    <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '350px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                        <h3 style={{ margin: '0 0 16px 0', color: 'var(--navy)' }}>Nuevo Pago (Crédito)</h3>
                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>Monto (ARS)</label>
                                            <input type="number" value={newPago.monto} onChange={e => setNewPago({ ...newPago, monto: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px' }} placeholder="Ej: 50000" />
                                        </div>
                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>Tasa de Cambio (TC)</label>
                                            <input type="number" step="0.0001" value={newPago.tc} onChange={e => setNewPago({ ...newPago, tc: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px' }} placeholder="Ej: 0.1250" />
                                        </div>
                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>Fecha</label>
                                            <input type="date" value={newPago.fecha} onChange={e => setNewPago({ ...newPago, fecha: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px' }} />
                                        </div>
                                        <div style={{ marginBottom: '20px' }}>
                                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>Forma de Pago</label>
                                            <select value={newPago.metodo} onChange={e => setNewPago({ ...newPago, metodo: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', background: '#fff' }}>
                                                {['Efectivo', 'Yasta (QR)', 'Banco Unión (QR/Transf)', 'BNB', 'Efectivo Personal', 'Otros'].map(m => (
                                                    <option key={m} value={m}>{m}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                                            <button onClick={() => setShowAddPago(false)} style={{ flex: 1, padding: '10px', background: '#f1f1f1', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>Cancelar</button>
                                            <button onClick={async () => {
                                                const monto = parseFloat(newPago.monto) || 0;
                                                const tc = parseFloat(newPago.tc) || 0;
                                                if (!monto) { showToast('Ingresa un monto válido.', 'error'); return; }
                                                // Registrar en contabilidad como EGRESO y obtener el ID generado
                                                const montoBS = tc > 0 ? monto * tc : monto;
                                                const { data: cajaMov } = await supabase.from('caja_movimientos').insert([{
                                                    turno_id: null,
                                                    tipo: 'EGRESO',
                                                    categoria: 'Pago Distribuidor',
                                                    concepto: `Pago distribuidor${newPago.fecha ? ' · ' + newPago.fecha : ''} · ARS ${monto.toLocaleString()}${tc > 0 ? ' (TC ' + tc + ')' : ''}`,
                                                    monto: montoBS,
                                                    metodo_pago: newPago.metodo || 'Efectivo',
                                                    origen: 'Proveedores',
                                                }]).select('id').single();
                                                // Guardar caja_id en el pago para permitir sincronización al borrar
                                                const newDist = { ...dist, pagos: [...(dist.pagos || []), { monto, tc: tc || null, fecha: newPago.fecha, metodo: newPago.metodo || 'Efectivo', caja_id: cajaMov?.id || null }] };
                                                setDist(newDist);
                                                await saveDist(newDist);
                                                setShowAddPago(false);
                                                setNewPago({ fecha: '', monto: '', tc: '', metodo: 'Efectivo' });
                                                showToast('Pago guardado y contabilizado como egreso.', 'success');
                                            }} style={{ flex: 1, padding: '10px', background: 'var(--ok)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#fff' }}>Guardar Pago</button>
                                        </div>
                                    </div>
                                </div>
                            )
                        }
                    </div>
                </div>
            )}

            {
                activeTab === 'remitos' && (
                    <>
                        {/* Botones de Acción (Movidos al principio) */}
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                            {!isSocio && (
                                <>
                                    <button
                                        onClick={addRow}
                                        style={{ padding: '0.3rem 0.6rem', backgroundColor: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem', transition: 'opacity 0.2s' }}
                                        onMouseOver={e => e.currentTarget.style.opacity = '0.9'}
                                        onMouseOut={e => e.currentTarget.style.opacity = '1'}
                                    >
                                        + AÑADIR FILA
                                    </button>
                                    <button
                                        onClick={syncDistToRows}
                                        style={{ padding: '0.3rem 0.6rem', backgroundColor: 'var(--warn)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem', transition: 'opacity 0.2s' }}
                                        onMouseOver={e => e.currentTarget.style.opacity = '0.9'}
                                        onMouseOut={e => e.currentTarget.style.opacity = '1'}
                                    >
                                        ↻ SYNC DISTRIBUIDOR
                                    </button>
                                </>
                            )}
                            <button
                                onClick={() => setCompactMode(!compactMode)}
                                style={{ padding: '0.3rem 0.6rem', backgroundColor: compactMode ? 'var(--navy)' : '#fff', color: compactMode ? '#fff' : 'var(--navy)', border: '1px solid var(--navy)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem', transition: 'all 0.2s', marginLeft: isSocio ? '0' : '10px' }}
                                title="Modo compacto: oculta columnas calculadas para editar más fácil"
                            >
                                {compactMode ? '👁️ VER TODO' : '🔍 MODO COMPACTO'}
                            </button>
                            {!isSocio && selectedCount > 0 && (
                                <button
                                    onClick={deleteSelectedRows}
                                    style={{ padding: '0.3rem 0.6rem', backgroundColor: '#eb5757', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem', transition: 'opacity 0.2s' }}
                                    onMouseOver={e => e.currentTarget.style.opacity = '0.9'}
                                    onMouseOut={e => e.currentTarget.style.opacity = '1'}
                                >
                                    🗑️ ELIMINAR {selectedCount} FILA(S)
                                </button>
                            )}
                        </div>

                        {/* Barra de Resumen */}
                        <div className="summary-bar" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem', flexWrap: 'wrap' }}>
                            <div className="summary-item">
                                <span className="summary-label">Filas</span>
                                <span className="summary-value" id="s-count">{count}</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-label">Inversión (ARS)</span>
                                <span className="summary-value" id="s-ars" style={{ color: 'var(--accent)' }}>{fARS(tARS)}</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-label">Cambio (BS)</span>
                                <span className="summary-value" id="s-bs">{fBS(tBS)}</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-label">Fletes País (BS)</span>
                                <span className="summary-value" id="s-flete">{fBS(tFlete)}</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-label">Remitos Total (BS)</span>
                                <span className="summary-value" id="s-total" style={{ color: 'var(--ok)' }}>{fBS(tTotal)}</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-label">Distribuidor (BS)</span>
                                <span className="summary-value" id="s-libros" style={{ color: 'var(--warn)' }}>{tLibros ? fBS(tLibros) : '--'}</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-label">GRAND TOTAL (BS)</span>
                                <span className="summary-value" id="s-grand" style={{ color: 'var(--ok)', fontWeight: '900' }}>{tGrandSummary ? fBS(tGrandSummary) : '--'}</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-label">Total Socio (BS)</span>
                                <span className="summary-value" id="s-socio-total" style={{ color: '#e1bee7' }}>{fBS(tSocioTotal)}</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-label" style={{ color: '#fff', opacity: 0.8 }}>MIS PEDIDOS (BS)</span>
                                <span className="summary-value" id="s-mis-pedidos" style={{ color: '#fff', fontWeight: '900' }}>{fBS(tMisPedidos)}</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-label">Cajas</span>
                                <span className="summary-value" id="s-cajas">{tCajas}</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-label">Factor Peso</span>
                                <span className="summary-value" id="s-kg">{tKg} kg</span>
                            </div>
                        </div >

                        {/* MODAL: REGISTRAR FLETE */}
                        {fleteModal && (
                            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                                <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '360px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                    <h3 style={{ margin: '0 0 4px 0', color: 'var(--navy)' }}>📤 Registrar Flete como Egreso</h3>
                                    <p style={{ margin: '0 0 16px 0', fontSize: '0.8rem', color: '#666' }}>
                                        {fleteModal.nro ? `Remito ${fleteModal.nro}` : 'Remito s/n'}
                                        {fleteModal.fecha ? ` · ${fleteModal.fecha}` : ''}
                                    </p>
                                    <div style={{ marginBottom: '12px', padding: '12px', background: '#f8f8f8', borderRadius: '6px', textAlign: 'center' }}>
                                        <span style={{ fontSize: '0.75rem', color: '#666', display: 'block', marginBottom: '4px' }}>Monto a registrar</span>
                                        <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--navy)' }}>
                                            BS {fleteModal.fleteBS.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>Forma de Pago</label>
                                        <select value={fleteMetodo} onChange={e => setFleteMetodo(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', background: '#fff' }}>
                                            {['Efectivo', 'Yasta (QR)', 'Banco Unión (QR/Transf)', 'BNB', 'Efectivo Personal', 'Otros'].map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button onClick={() => setFleteModal(null)} disabled={fleteSaving} style={{ flex: 1, padding: '10px', background: '#f1f1f1', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>Cancelar</button>
                                        <button onClick={fleteModal?.isRestante ? handleRegistrarFleteRestante : handleRegistrarFlete} disabled={fleteSaving} style={{ flex: 1, padding: '10px', background: fleteSaving ? '#aaa' : (fleteModal?.isRestante ? '#e67e22' : 'var(--ok)'), border: 'none', borderRadius: '4px', cursor: fleteSaving ? 'not-allowed' : 'pointer', fontWeight: 'bold', color: '#fff' }}>
                                            {fleteSaving ? 'Registrando...' : (fleteModal?.isRestante ? 'Confirmar Restante' : 'Confirmar Egreso')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* MODAL: REGISTRAR COSTO ENVÍO AR */}
                        {costoModal && (
                            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                                <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '360px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                    <h3 style={{ margin: '0 0 4px 0', color: 'var(--navy)' }}>🚚 Registrar Envío AR como Egreso</h3>
                                    <p style={{ margin: '0 0 16px 0', fontSize: '0.8rem', color: '#666' }}>
                                        {costoModal.nro ? `Remito ${costoModal.nro}` : 'Remito s/n'}
                                        {costoModal.fecha ? ` · ${costoModal.fecha}` : ''}
                                    </p>
                                    <div style={{ marginBottom: '12px', padding: '12px', background: '#f8f8f8', borderRadius: '6px', textAlign: 'center' }}>
                                        <span style={{ fontSize: '0.75rem', color: '#666', display: 'block', marginBottom: '2px' }}>Monto a registrar</span>
                                        <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--navy)' }}>
                                            BS {costoModal.costoBS.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                        {costoModal.compre && costoModal.cambio && (
                                            <span style={{ fontSize: '0.72rem', color: '#888', display: 'block', marginTop: '2px' }}>
                                                ARS {Number(costoModal.compre).toLocaleString()} × TC {costoModal.cambio}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>Forma de Pago</label>
                                        <select value={costoMetodo} onChange={e => setCostoMetodo(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', background: '#fff' }}>
                                            {['Efectivo', 'Yasta (QR)', 'Banco Unión (QR/Transf)', 'BNB', 'Efectivo Personal', 'Otros'].map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button onClick={() => setCostoModal(null)} disabled={costoSaving} style={{ flex: 1, padding: '10px', background: '#f1f1f1', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>Cancelar</button>
                                        <button onClick={costoModal?.isRestante ? handleRegistrarCostoRestante : handleRegistrarCosto} disabled={costoSaving} style={{ flex: 1, padding: '10px', background: costoSaving ? '#aaa' : (costoModal?.isRestante ? '#e67e22' : 'var(--ok)'), border: 'none', borderRadius: '4px', cursor: costoSaving ? 'not-allowed' : 'pointer', fontWeight: 'bold', color: '#fff' }}>
                                            {costoSaving ? 'Registrando...' : (costoModal?.isRestante ? 'Confirmar Restante' : 'Confirmar Egreso')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Tabla Principal */}
                        < div className="table-wrapper" >
                            <table id="tbl">
                                <thead>
                                    <tr className="group">
                                        <th rowSpan="2">
                                            <input
                                                type="checkbox"
                                                id="chk-all"
                                                checked={isAllSelected}
                                                onChange={handleSelectAll}
                                            />
                                        </th>
                                        <th colSpan="5">Remito + Envío Argentina</th>
                                        <th colSpan={compactMode ? (isSocio ? 2 : 3) : (isSocio ? 3 : 4)}>Compra ARS a BS</th>
                                        <th colSpan={compactMode ? (isSocio ? 3 : 4) : (isSocio ? 4 : 5)}>Flete Bolivia BS</th>
                                        {!compactMode && <th colSpan="1">Costo Total</th>}
                                        <th colSpan="2" style={{ textAlign: "center" }}>Pedido</th>
                                        <th colSpan={compactMode ? 2 : 3} style={{ color: "var(--warn)", backgroundColor: "rgba(245, 168, 0, 0.05)" }}>Distribuidor</th>
                                        <th colSpan={compactMode ? 3 : 6} style={{ color: "var(--purple)", backgroundColor: "rgba(156, 39, 176, 0.05)" }}>Socio</th>
                                        {!compactMode && <th colSpan="2" style={{ color: "var(--ok)", backgroundColor: "rgba(39, 174, 96, 0.05)" }}>TOTALES</th>}
                                    </tr>
                                    <tr className="cols">
                                        <th>Nro Remito</th>
                                        <th>Fecha</th>
                                        <th>Cajas</th>
                                        <th>Peso KG</th>
                                        <th>Precio Remito ARS</th>
                                        <th>Compré ARS</th>
                                        <th>Cambio día</th>
                                        {!compactMode && <th>Costo BS</th>}
                                        {!isSocio && <th style={{ minWidth: '95px' }}>Envío AR Reg.</th>}
                                        <th>Cajas Gdes 70</th>
                                        <th>Cajas Med 40</th>
                                        <th>Cajas Peq 20</th>
                                        {!compactMode && <th>Total Flete BS</th>}
                                        {!isSocio && <th style={{ minWidth: '95px' }}>Flete Reg.</th>}
                                        {!compactMode && <th>Costo Total BS</th>}
                                        <th>Pedido</th>
                                        <th>Pago Aprox ARS</th>
                                        <th>Pagos Dist. ARS</th>
                                        <th>TC Dist.</th>
                                        {!compactMode && <th>Grand Total BS</th>}
                                        <th>Peso KG</th>
                                        <th>Cajas Gdes</th>
                                        <th>Monto ARS</th>
                                        {!compactMode && <th>Envío BS</th>}
                                        {!compactMode && <th>Flete BS</th>}
                                        {!compactMode && <th>Pedido BS</th>}
                                        {!compactMode && <th style={{ backgroundColor: 'rgba(39, 174, 96, 0.05)' }}>Total Socio BS</th>}
                                        {!compactMode && <th style={{ backgroundColor: 'rgba(39, 174, 96, 0.05)' }}>Mis Pedidos BS</th>}
                                    </tr>
                                </thead>
                                <tbody id="tbody">
                                    {rows.map(r => {
                                        // Calculamos directamente ejecutando calcRow con la referencia exacta
                                        const calcs = calcRow(r.id, rows) || { costoBS: 0, fleteBS: 0, totalBS: 0 };

                                        const inputStyle = {
                                            width: '100%',
                                            minWidth: '70px',
                                            border: 'none',
                                            background: 'transparent',
                                            outline: 'none',
                                            fontFamily: 'inherit',
                                            fontSize: 'inherit',
                                            color: 'inherit'
                                        };

                                        const numInputStyle = {
                                            ...inputStyle,
                                            textAlign: 'right'
                                        };

                                        return (
                                            <tr key={r.id} style={{ backgroundColor: r.selected ? 'rgba(235, 87, 87, 0.05)' : 'transparent' }}>
                                                <td style={{ textAlign: 'center' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={!!r.selected}
                                                        onChange={e => handleChange(r.id, 'selected', e.target.checked)}
                                                        disabled={isSocio}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="text"
                                                        placeholder="Ej: A-01"
                                                        value={r.nro || ''}
                                                        onChange={e => handleChange(r.id, 'nro', e.target.value)}
                                                        style={inputStyle}
                                                        disabled={isSocio}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="date"
                                                        value={r.fecha || ''}
                                                        onChange={e => handleChange(r.id, 'fecha', e.target.value)}
                                                        style={inputStyle}
                                                        disabled={isSocio}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        placeholder="0"
                                                        value={r.cajas || ''}
                                                        onChange={e => handleChange(r.id, 'cajas', e.target.value)}
                                                        style={numInputStyle}
                                                        onFocus={e => e.target.select()}
                                                        onWheel={e => e.target.blur()}
                                                        disabled={isSocio}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="0.00"
                                                        value={r.kg || ''}
                                                        onChange={e => handleChange(r.id, 'kg', e.target.value)}
                                                        style={numInputStyle}
                                                        onFocus={e => e.target.select()}
                                                        onWheel={e => e.target.blur()}
                                                        disabled={isSocio}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="0.00"
                                                        value={r.precio_remito || ''}
                                                        onChange={e => handleChange(r.id, 'precio_remito', e.target.value)}
                                                        style={numInputStyle}
                                                        onFocus={e => e.target.select()}
                                                        onWheel={e => e.target.blur()}
                                                        disabled={isSocio}
                                                    />
                                                </td>
                                                <td style={{ backgroundColor: 'rgba(245, 168, 0, 0.05)' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="0.00"
                                                        value={r.compre || ''}
                                                        onChange={e => handleChange(r.id, 'compre', e.target.value)}
                                                        style={{ ...numInputStyle, fontWeight: 'bold', color: 'var(--accent)' }}
                                                        onFocus={e => e.target.select()}
                                                        onWheel={e => e.target.blur()}
                                                        disabled={isSocio}
                                                    />
                                                </td>
                                                <td style={{ backgroundColor: 'rgba(245, 168, 0, 0.05)' }}>
                                                    <input
                                                        type="number"
                                                        step="0.0001"
                                                        placeholder="0.0000"
                                                        value={r.cambio || ''}
                                                        onChange={e => handleChange(r.id, 'cambio', e.target.value)}
                                                        style={numInputStyle}
                                                        onFocus={e => e.target.select()}
                                                        onWheel={e => e.target.blur()}
                                                        disabled={isSocio}
                                                    />
                                                </td>
                                                {!compactMode && (
                                                    <td style={{ backgroundColor: 'rgba(245, 168, 0, 0.05)', textAlign: 'right', fontWeight: 'bold' }}>
                                                        {calcs.costoBS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                )}
                                                {!isSocio && (
                                                    <td style={{ textAlign: 'center', verticalAlign: 'middle', padding: '2px 4px' }}>
                                                        {(() => {
                                                            const restanteCosto = calcs.costoBS - num(r.costo_monto_pagado);
                                                            if (r.costo_caja_id && restanteCosto > 0.01) {
                                                                return (
                                                                    <button
                                                                        onClick={() => { setCostoModal({ rowId: r.id, costoBS: restanteCosto, nro: r.nro || '', fecha: r.fecha || '', compre: r.compre, cambio: r.cambio, isRestante: true }); setCostoMetodo('Efectivo Personal'); }}
                                                                        style={{ padding: '3px 8px', background: '#e67e22', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                                                                        title={`Falta pagar BS ${restanteCosto.toFixed(2)}`}
                                                                    >
                                                                        🚚 Restante Bs {restanteCosto.toFixed(2)}
                                                                    </button>
                                                                );
                                                            }
                                                            if (r.costo_caja_id) {
                                                                return <span title="Pago completo" style={{ display: 'inline-block', padding: '3px 8px', background: 'rgba(39,174,96,0.12)', color: 'var(--ok)', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold', border: '1px solid rgba(39,174,96,0.3)', whiteSpace: 'nowrap' }}>✓ Registrado</span>;
                                                            }
                                                            if (calcs.costoBS > 0) {
                                                                return (
                                                                    <button
                                                                        onClick={() => { setCostoModal({ rowId: r.id, costoBS: calcs.costoBS, nro: r.nro || '', fecha: r.fecha || '', compre: r.compre, cambio: r.cambio }); setCostoMetodo('Efectivo Personal'); }}
                                                                        style={{ padding: '3px 8px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                                                                        title={`Registrar BS ${calcs.costoBS.toFixed(2)} como egreso "Envío Argentina"`}
                                                                    >
                                                                        🚚 Reg. Envío AR
                                                                    </button>
                                                                );
                                                            }
                                                            return <span style={{ color: '#ccc', fontSize: '0.7rem' }}>—</span>;
                                                        })()}
                                                    </td>
                                                )}
                                                <td>
                                                    <input
                                                        type="number"
                                                        placeholder="0"
                                                        value={r.cg || ''}
                                                        onChange={e => handleChange(r.id, 'cg', e.target.value)}
                                                        style={numInputStyle}
                                                        onFocus={e => e.target.select()}
                                                        onWheel={e => e.target.blur()}
                                                        disabled={isSocio}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        placeholder="0"
                                                        value={r.cm || ''}
                                                        onChange={e => handleChange(r.id, 'cm', e.target.value)}
                                                        style={numInputStyle}
                                                        onFocus={e => e.target.select()}
                                                        onWheel={e => e.target.blur()}
                                                        disabled={isSocio}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        placeholder="0"
                                                        value={r.cp || ''}
                                                        onChange={e => handleChange(r.id, 'cp', e.target.value)}
                                                        style={numInputStyle}
                                                        onFocus={e => e.target.select()}
                                                        onWheel={e => e.target.blur()}
                                                        disabled={isSocio}
                                                    />
                                                </td>
                                                {!isSocio && (
                                                    <td style={{ textAlign: 'center', verticalAlign: 'middle', padding: '2px 4px' }}>
                                                        {(() => {
                                                            const restanteFlete = calcs.fleteBS - num(r.flete_monto_pagado);
                                                            if (r.flete_caja_id && restanteFlete > 0.01) {
                                                                return (
                                                                    <button
                                                                        onClick={() => { setFleteModal({ rowId: r.id, fleteBS: restanteFlete, nro: r.nro || '', fecha: r.fecha || '', isRestante: true }); setFleteMetodo('Efectivo Personal'); }}
                                                                        style={{ padding: '3px 8px', background: '#e67e22', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                                                                        title={`Falta pagar BS ${restanteFlete.toFixed(2)}`}
                                                                    >
                                                                        📤 Restante Bs {restanteFlete.toFixed(2)}
                                                                    </button>
                                                                );
                                                            }
                                                            if (r.flete_caja_id) {
                                                                return <span title="Pago completo" style={{ display: 'inline-block', padding: '3px 8px', background: 'rgba(39,174,96,0.12)', color: 'var(--ok)', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold', border: '1px solid rgba(39,174,96,0.3)', whiteSpace: 'nowrap' }}>✓ Registrado</span>;
                                                            }
                                                            if (calcs.fleteBS > 0) {
                                                                return (
                                                                    <button
                                                                        onClick={() => { setFleteModal({ rowId: r.id, fleteBS: calcs.fleteBS, nro: r.nro || '', fecha: r.fecha || '' }); setFleteMetodo('Efectivo Personal'); }}
                                                                        style={{ padding: '3px 8px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                                                                        title={`Registrar flete BS ${calcs.fleteBS.toFixed(2)} como egreso en caja`}
                                                                    >
                                                                        📤 Reg. Flete
                                                                    </button>
                                                                );
                                                            }
                                                            return <span style={{ color: '#ccc', fontSize: '0.7rem' }}>—</span>;
                                                        })()}
                                                    </td>
                                                )}
                                                {!compactMode && (
                                                    <>
                                                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                                                            {calcs.fleteBS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </td>
                                                        <td style={{ backgroundColor: 'rgba(39, 174, 96, 0.05)', textAlign: 'right', fontWeight: 'bold', color: 'var(--ok)' }}>
                                                            {calcs.totalBS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </td>
                                                    </>
                                                )}
                                                <td>
                                                    <input
                                                        type="text"
                                                        value={r.pedido || ''}
                                                        readOnly
                                                        style={{ ...inputStyle, cursor: 'not-allowed', color: '#666', background: 'rgba(0,0,0,0.02)' }}
                                                        title="Se sincroniza automáticamente desde el panel de Distribuidor"
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={r.pago_aprox || ''}
                                                        readOnly
                                                        style={{ ...numInputStyle, cursor: 'not-allowed', color: '#666', background: 'rgba(0,0,0,0.02)' }}
                                                        title="Se sincroniza automáticamente desde el panel de Distribuidor"
                                                    />
                                                </td>
                                                <td style={{ backgroundColor: 'rgba(245, 168, 0, 0.05)' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={r.pagos_dist || ''}
                                                        readOnly
                                                        style={{ ...numInputStyle, color: 'var(--warn)', cursor: 'not-allowed' }}
                                                        title="Se sincroniza automáticamente desde el panel de Distribuidor"
                                                    />
                                                </td>
                                                <td style={{ backgroundColor: 'rgba(245, 168, 0, 0.05)' }}>
                                                    <input
                                                        type="number"
                                                        step="0.0001"
                                                        value={r.tc_dist || ''}
                                                        readOnly
                                                        style={{ ...numInputStyle, color: 'var(--warn)', cursor: 'not-allowed' }}
                                                        title="Se sincroniza automáticamente desde el panel de Distribuidor"
                                                    />
                                                </td>
                                                {!compactMode && (
                                                    <td style={{ backgroundColor: 'rgba(39, 174, 96, 0.05)', textAlign: 'right', fontWeight: 'bold', color: 'var(--ok)' }}>
                                                        {calcs.grandBS ? calcs.grandBS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
                                                    </td>
                                                )}
                                                <td style={{ backgroundColor: 'rgba(156, 39, 176, 0.05)' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={r.skg || ''}
                                                        onChange={e => handleChange(r.id, 'skg', e.target.value)}
                                                        style={{ ...numInputStyle, color: '#9c27b0' }}
                                                        onFocus={e => e.target.select()}
                                                        onWheel={e => e.target.blur()}
                                                    />
                                                </td>
                                                <td style={{ backgroundColor: 'rgba(156, 39, 176, 0.05)' }}>
                                                    <input
                                                        type="number"
                                                        value={r.scaj || ''}
                                                        onChange={e => handleChange(r.id, 'scaj', e.target.value)}
                                                        style={{ ...numInputStyle, color: '#9c27b0' }}
                                                        onFocus={e => e.target.select()}
                                                        onWheel={e => e.target.blur()}
                                                    />
                                                </td>
                                                <td style={{ backgroundColor: 'rgba(156, 39, 176, 0.05)' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={r.smonto || ''}
                                                        onChange={e => handleChange(r.id, 'smonto', e.target.value)}
                                                        style={{ ...numInputStyle, color: '#9c27b0' }}
                                                        onFocus={e => e.target.select()}
                                                        onWheel={e => e.target.blur()}
                                                    />
                                                </td>
                                                {!compactMode && (
                                                    <>
                                                        <td style={{ backgroundColor: 'rgba(156, 39, 176, 0.05)', textAlign: 'right', color: '#9c27b0' }}>
                                                            {r._sEnvBS ? r._sEnvBS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
                                                        </td>
                                                        <td style={{ backgroundColor: 'rgba(156, 39, 176, 0.05)', textAlign: 'right', color: '#9c27b0' }}>
                                                            {r._sFltBS ? r._sFltBS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
                                                        </td>
                                                        <td style={{ backgroundColor: 'rgba(156, 39, 176, 0.05)', textAlign: 'right', color: '#9c27b0' }}>
                                                            {calcs.sPedBS ? calcs.sPedBS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
                                                        </td>
                                                        <td style={{ backgroundColor: 'rgba(39, 174, 96, 0.05)', textAlign: 'right', fontWeight: 'bold', color: '#9c27b0' }}>
                                                            {calcs.sTotBS ? calcs.sTotBS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
                                                        </td>
                                                        <td style={{ backgroundColor: 'rgba(39, 174, 96, 0.05)', textAlign: 'right', fontWeight: 'bold', color: 'var(--ok)' }}>
                                                            {calcs.miPedBS ? calcs.miPedBS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
                                                        </td>
                                                    </>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div >
                    </>
                )
            }

            {/* ========================================== */}
            {/* MÓDULO SOCIO (#page-socio)                 */}
            {/* ========================================== */}
            {
                activeTab === 'socio' && (
                    <div id="page-socio" style={{ marginBottom: '20px', fontFamily: '"DM Sans", sans-serif' }}>
                        <div style={{ background: '#fff', borderRadius: '8px', overflow: 'visible', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginBottom: '1.5rem' }}>
                            <div style={{
                                background: 'var(--navy)',
                                color: '#fff',
                                padding: '10px 16px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                position: 'sticky',
                                top: 0,
                                zIndex: 100,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                            }}>
                                <h3 style={{ margin: 0, fontSize: '0.85rem', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px', color: '#fff' }}>
                                    <span>📦</span> ITEMS DISPONIBLES AL SOCIO
                                </h3>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <div style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', padding: '6px 14px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.1)' }}>
                                        Seleccionado: {fBS(Object.keys(selectedSocioItems).filter(k => selectedSocioItems[k]).reduce((s, k) => {
                                            let item = availSocioItems.find(it => `${it.remId}-${it.type}` === k);
                                            return s + (item ? item.amount : 0);
                                        }, 0))}
                                    </div>
                                    {plans.length > 0 && (
                                        <select
                                            disabled={!Object.keys(selectedSocioItems).some(k => selectedSocioItems[k])}
                                            onChange={e => {
                                                if (e.target.value) handleAddSelectedToExistingPlan(Number(e.target.value));
                                                e.target.value = '';
                                            }}
                                            style={{ 
                                                background: Object.keys(selectedSocioItems).some(k => selectedSocioItems[k]) ? '#fff' : 'rgba(255,255,255,0.5)', 
                                                color: 'var(--navy)', 
                                                border: 'none', 
                                                padding: '6px 12px', 
                                                borderRadius: '6px', 
                                                fontSize: '0.8rem', 
                                                fontWeight: 'bold', 
                                                cursor: Object.keys(selectedSocioItems).some(k => selectedSocioItems[k]) ? 'pointer' : 'not-allowed', 
                                                outline: 'none' 
                                            }}
                                            title="Debes seleccionar al menos un item para agregar a un plan"
                                        >
                                            <option value="">Agregar a plan...</option>
                                            {plans.filter(p => {
                                                let t = p.items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
                                                let pg = (p.pagos || []).reduce((s, px) => s + (parseFloat(px.monto) || 0), 0);
                                                return (t - pg) >= 0.01 || t === 0;
                                            }).map(p => (
                                                <option key={p.id} value={p.id}>+ Plan #{p.id} ({p.fecha})</option>
                                            ))}
                                        </select>
                                    )}
                                    <button onClick={handleGeneratePlan} style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '6px 16px', cursor: 'pointer', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.8rem', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', transition: 'transform 0.2s' }} onMouseOver={e => e.currentTarget.style.transform = 'scale(1.02)'} onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}>+ Generar Plan</button>
                                </div>
                            </div>
                            <div style={{ padding: '16px', overflow: 'visible' }}>
                                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', background: '#f8f9fa', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
                                    <input type="text" value={newSocioExtraDesc} onChange={e => setNewSocioExtraDesc(e.target.value)} placeholder="Descripción (ej: deuda anterior)" style={{ flex: 1, minWidth: '200px', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem' }} />
                                    <input type="number" value={newSocioExtraBs} onChange={e => setNewSocioExtraBs(e.target.value)} placeholder="0.00 BS" style={{ width: '120px', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem' }} />
                                    <button onClick={handleAddManualSocioItem} style={{ background: 'var(--navy)', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem' }}>Agregar Item Extra</button>
                                </div>

                                {availSocioItems.length === 0 ? (
                                    <div style={{ textAlign: 'center', color: 'gray', padding: '20px' }}>No hay ítems disponibles para facturar.</div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '30px' }}>
                                        {Object.entries(availSocioItems.reduce((acc, item) => {
                                            if (!acc[item.nro]) acc[item.nro] = [];
                                            acc[item.nro].push(item);
                                            return acc;
                                        }, {})).map(([groupName, items]) => (
                                            <div key={groupName} style={{ border: '1px solid var(--border)', borderRadius: '6px', background: '#fff', marginBottom: '10px' }}>
                                                <div style={{
                                                    background: groupName === 'OTRO CARGOS / ALQUILER' || groupName === 'Items extra' ? '#fdf8ed' : '#f4f7f9',
                                                    padding: '10px 16px',
                                                    fontSize: '12px',
                                                    fontWeight: 'bold',
                                                    color: 'var(--navy)',
                                                    borderBottom: '1px solid var(--border)',
                                                    position: 'sticky',
                                                    top: '44px',
                                                    zIndex: 80,
                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                                                    borderRadius: '8px 8px 0 0'
                                                }}>
                                                    {groupName === 'OTRO CARGOS / ALQUILER' || groupName === 'Items extra' ? 'OTROS CARGOS / ALQUILER' : `Pedido: ${groupName}`}
                                                </div>
                                                <div>
                                                    {items.map((item, i) => {
                                                        const key = `${item.remId}-${item.type}`;
                                                        const isExtra = item.type === 'extra';
                                                        const extraId = isExtra ? item.remId.replace('extra-', '') : null;
                                                        const isEditing = isExtra && editingExtraId === extraId;
                                                        const tagProps = {
                                                            envio: { bg: '#d4e4f7', color: '#1a3a5f' },
                                                            flete: { bg: '#fdf8ed', color: '#f37021' },
                                                            pedido: { bg: '#fff2cc', color: '#b38600' },
                                                            extra: { bg: '#fde4cc', color: '#cc5500' },
                                                            alq: { bg: '#e0f7fa', color: '#006064' }
                                                        };
                                                        const isRental = item.isAlq || (item.type === 'extra' && item.label.startsWith('Alquiler Mes:'));
                                                        const tprop = isRental ? tagProps.alq : (tagProps[item.type] || { bg: '#eee', color: '#333' });

                                                        return (
                                                            <div key={key} style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                padding: '10px 16px',
                                                                borderBottom: i < items.length - 1 ? '1px solid #f0f0f0' : 'none',
                                                                background: isEditing ? '#fffaf2' : 'transparent',
                                                                border: isEditing ? '1px solid var(--warn)' : 'none'
                                                            }}>
                                                                {!isEditing && (
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={!!selectedSocioItems[key]}
                                                                        onChange={e => setSelectedSocioItems({ ...selectedSocioItems, [key]: e.target.checked })}
                                                                        style={{ marginRight: '16px', width: '16px', height: '16px' }}
                                                                    />
                                                                )}
                                                                <span style={{
                                                                    background: tprop.bg,
                                                                    color: tprop.color,
                                                                    padding: '4px 8px',
                                                                    borderRadius: '4px',
                                                                    fontSize: '10px',
                                                                    fontWeight: 'bold',
                                                                    textTransform: 'uppercase',
                                                                    marginRight: '16px',
                                                                    minWidth: '60px',
                                                                    textAlign: 'center'
                                                                }}>
                                                                    {isRental ? 'Alquiler' : item.type}
                                                                </span>

                                                                {isEditing ? (
                                                                    <div style={{ flex: 1, display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                        <input
                                                                            type="text"
                                                                            value={item.label}
                                                                            onChange={e => handleUpdateExtra(extraId, 'label', e.target.value)}
                                                                            style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--warn)', borderRadius: '4px', fontSize: '12px' }}
                                                                        />
                                                                        <input
                                                                            type="number"
                                                                            value={item.amount}
                                                                            onChange={e => handleUpdateExtra(extraId, 'amount', e.target.value)}
                                                                            style={{ width: '100px', padding: '4px 8px', border: '1px solid var(--warn)', borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace', fontWeight: 'bold' }}
                                                                        />
                                                                        <button onClick={() => setEditingExtraId(null)} style={{ background: 'var(--ok)', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}>OK</button>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        <span style={{ flex: 1, fontSize: '13px', color: '#444' }}>{item.label}</span>
                                                                        <span style={{ fontWeight: 'bold', color: 'var(--navy)', fontFamily: 'monospace', fontSize: '14px', marginRight: '12px' }}>
                                                                            {fBS(item.amount)}
                                                                        </span>
                                                                        {isExtra && (
                                                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                                                {!isRental && (
                                                                                    <button onClick={() => setEditingExtraId(extraId)} style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '12px' }}>✏️</button>
                                                                                )}
                                                                                {!isRental && (
                                                                                    <button onClick={() => handleDeleteManualSocioItem(extraId)} style={{ background: 'transparent', border: 'none', color: '#eb5757', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                                <div style={{ background: groupName === 'Items extra' ? '#fdf8ed' : '#f8f9fa', padding: '10px 16px', fontSize: '11px', display: 'flex', justifyContent: 'space-between', color: '#555', borderTop: '1px solid var(--border)', fontWeight: '600' }}>
                                                    <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.8 }}>Subtotal {groupName === 'Items extra' ? 'Items extra' : 'Pedido'}</span>
                                                    <span style={{ fontWeight: '900', color: 'var(--navy)', fontFamily: 'monospace', fontSize: '14px' }}>
                                                        {fBS(items.reduce((s, it) => s + (it.amount || 0), 0))}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px', borderTop: '1px solid var(--border)', background: '#fdf8ed', marginTop: '10px' }}>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--navy)' }}>
                                        Total disponible: <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', color: 'var(--accent)', marginLeft: '8px' }}>{fBS(availSocioItems.reduce((s, it) => s + (it.amount || 0), 0))}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {plans.length > 0 && (
                            <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginBottom: '1.5rem' }}>
                                <div style={{ background: 'var(--navy)', color: '#fff', padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <h3 style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px', color: '#fff' }}>
                                        <span>📜</span> PLANES GENERADOS AL SOCIO
                                    </h3>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={hidePaidPlans} onChange={e => setHidePaidPlans(e.target.checked)} />
                                        Ocultar Pagados
                                    </label>
                                </div>
                                <div style={{ padding: '16px', background: 'var(--bg)' }}>
                                    {[...plans].reverse().filter(p => {
                                        if (!hidePaidPlans) return true;
                                        let total = p.items.reduce((s, it) => s + it.amount, 0);
                                        let pagado = (p.pagos || []).reduce((s, pg) => s + (pg.monto || 0), 0);
                                        return (total - pagado) >= 0.01 || total === 0;
                                    }).map(p => {
                                        let total = p.items.reduce((s, it) => s + it.amount, 0);
                                        let pagado = (p.pagos || []).reduce((s, pg) => s + (pg.monto || 0), 0);
                                        let resta = total - pagado;
                                        let saldado = resta < 0.01 && total > 0;
                                        const isExpanded = !!expandedPlans[p.id];

                                        return (
                                            <div key={p.id} style={{ background: '#fff', border: '1px solid ' + (saldado ? 'var(--border)' : 'var(--warn)'), borderLeft: saldado ? '1px solid var(--border)' : '4px solid var(--warn)', boxShadow: saldado ? 'none' : '0 4px 12px rgba(245, 168, 0, 0.05)', borderRadius: '8px', marginBottom: '24px', overflow: 'hidden' }}>

                                                <div style={{ background: saldado ? '#f9f9f9' : '#fdf8ed', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => togglePlanExpand(p.id)}>
                                                        <span style={{ color: saldado ? '#2ecc71' : 'var(--navy)', fontWeight: '900', fontSize: '14px' }}>
                                                            {isExpanded ? '▼' : '▶'} Plan #{p.id} {saldado && <span style={{ background: '#2ecc71', color: '#fff', padding: '2px 8px', borderRadius: '12px', fontSize: '9px', marginLeft: '8px', verticalAlign: 'middle' }}>PAGADO</span>}
                                                        </span>
                                                        <span style={{ color: '#999', fontSize: '11px' }}>{p.fecha}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', fontWeight: 'bold' }}>
                                                        <span style={{ color: '#d4af37' }}>{fBS(pagado)} / {fBS(total)}</span>
                                                        <span style={{ color: saldado ? 'green' : '#f37021' }}>{resta < 0 ? 'Saldo a favor: ' : 'Resta: '}{fBS(Math.abs(resta))}</span>
                                                        <button onClick={() => {
                                                            openConfirm('¡ADVERTENCIA CRÍTICA!', '¿Estás seguro de que deseas BORRAR este Plan de Pagos completo?\n\nEsta acción eliminará el plan y todos sus registros asociados. No se puede deshacer.', async () => {
                                                                const nps = plans.filter(x => x.id !== p.id);
                                                                setPlans(nps);
                                                                await savePlans(nps, nplan);
                                                                showToast('Plan de pagos eliminado.', 'success');
                                                            });
                                                        }} style={{ background: '#fff', color: '#eb5757', border: '1px solid #eb5757', borderRadius: '4px', padding: '4px 16px', fontSize: '11px', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 'bold' }}>Borrar Plan</button>
                                                    </div>
                                                </div>

                                                {isExpanded && (
                                                    <div style={{ padding: '0 20px' }}>
                                                        <div style={{ paddingTop: '20px' }}>
                                                            <div style={{ fontSize: '10px', fontWeight: 'bold', color: 'gray', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>ITEMS DEL PLAN</div>
                                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                {p.items.map((it, i) => {
                                                                    const tagProps = {
                                                                        envio: { bg: '#d4e4f7', color: '#1a3a5f' },
                                                                        flete: { bg: '#fdf8ed', color: '#f37021' },
                                                                        pedido: { bg: '#fff2cc', color: '#b38600' },
                                                                        extra: { bg: '#fde4cc', color: '#cc5500' }
                                                                    };
                                                                    const tprop = tagProps[it.type] || { bg: '#eee', color: '#333' };
                                                                    const itemKey = `${it.remId}-${it.type}`;
                                                                    return (
                                                                        <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f9f9f9' }}>
                                                                            <span style={{ background: tprop.bg, color: tprop.color, padding: '4px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', marginRight: '16px', minWidth: '50px', textAlign: 'center' }}>
                                                                                {it.type}
                                                                            </span>
                                                                            <span style={{ flex: 1, fontSize: '13px', color: '#333' }}>{it.label} <span style={{ color: '#999' }}>({it.nro})</span></span>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                                <strong style={{ fontFamily: 'monospace', fontSize: '13px', color: 'var(--purple)' }}>{fBS(it.amount)}</strong>
                                                                                <button onClick={() => deleteItemFromPlan(p.id, itemKey)} style={{ background: 'transparent', border: 'none', color: '#eb5757', cursor: 'pointer', fontSize: '12px' }} title="Quitar item del plan">✕</button>
                                                                            </div>
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0', borderTop: '2px solid var(--border)', marginTop: '8px' }}>
                                                                <strong style={{ fontSize: '14px', color: '#111' }}>Total</strong>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                                    <button onClick={() => { setAddingItemToPlan(p.id); setCheckedItemsToAddToPlan({}); }} style={{ background: 'transparent', border: '1px solid var(--purple)', color: 'var(--purple)', borderRadius: '4px', padding: '4px 12px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}>+ Agregar item</button>
                                                                    <strong style={{ fontFamily: 'monospace', fontSize: '17px', color: 'var(--purple)' }}>{fBS(total)}</strong>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {addingItemToPlan === p.id && (
                                                            <div style={{ padding: '16px', background: '#f4f2ff', border: '1px solid var(--purple)', borderRadius: '8px', marginTop: '10px', marginBottom: '10px' }}>
                                                                <div style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>SELECCIONAR ITEMS A AGREGAR</div>
                                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                    {availSocioItems.length === 0 ? (
                                                                        <div style={{ textAlign: 'center', color: 'gray', padding: '10px', fontSize: '12px' }}>No hay ítems disponibles.</div>
                                                                    ) : (
                                                                        availSocioItems.map(it => {
                                                                            const tagProps = {
                                                                                envio: { bg: '#d4e4f7', color: '#1a3a5f' },
                                                                                flete: { bg: '#fdf8ed', color: '#f37021' },
                                                                                pedido: { bg: '#fff2cc', color: '#b38600' },
                                                                                extra: { bg: '#fde4cc', color: '#cc5500' }
                                                                            };
                                                                            const tprop = tagProps[it.type] || { bg: '#eee', color: '#333' };
                                                                            const key = `${it.remId}-${it.type}`;
                                                                            return (
                                                                                <label key={key} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={!!checkedItemsToAddToPlan[key]}
                                                                                        onChange={e => setCheckedItemsToAddToPlan({ ...checkedItemsToAddToPlan, [key]: e.target.checked })}
                                                                                        style={{ marginRight: '16px', width: '16px', height: '16px' }}
                                                                                    />
                                                                                    <span style={{ background: tprop.bg, color: tprop.color, padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', marginRight: '16px', minWidth: '60px', textAlign: 'center' }}>
                                                                                        {it.type}
                                                                                    </span>
                                                                                    <span style={{ flex: 1, fontSize: '13px', color: '#444' }}>{it.nro ? `${it.nro} ` : ''}{it.label}</span>
                                                                                    <span style={{ fontWeight: 'bold', color: 'var(--navy)', fontFamily: 'monospace', fontSize: '14px' }}>
                                                                                        {fBS(it.amount)}
                                                                                    </span>
                                                                                </label>
                                                                            )
                                                                        })
                                                                    )}
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                                                                    <button onClick={() => setAddingItemToPlan(null)} style={{ background: '#fff', color: '#666', border: '1px solid var(--border)', borderRadius: '4px', padding: '6px 12px', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}>Cancelar</button>
                                                                    <button onClick={() => handleAddExtraToPlan(p.id)} style={{ background: '#673ab7', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 16px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}>Agregar seleccionados</button>
                                                                </div>
                                                            </div>
                                                        )}

                                                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '20px', paddingBottom: '20px' }}>
                                                            <div style={{ fontSize: '10px', fontWeight: 'bold', color: 'gray', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>PAGOS REGISTRADOS</div>
                                                            {(!p.pagos || p.pagos.length === 0) ? (
                                                                <div style={{ textAlign: 'center', fontSize: '12px', color: 'gray', padding: '20px 0' }}>Sin pagos aún.</div>
                                                            ) : (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                                    {(p.pagos || []).map((pg, pidx) => {
                                                                        const key = `${p.id}-${pidx}`;
                                                                        const isEditing = editingPagoPlanKey === key;
                                                                        return (
                                                                            <div key={pidx} style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', padding: '12px', background: isEditing ? '#fffaf2' : '#fcfcfc', border: '1px solid ' + (isEditing ? 'var(--warn)' : (pg.caja_id ? '#c6f0c2' : '#eee')), borderRadius: '6px' }}>
                                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                                    <input type="number" readOnly={!isEditing} value={pg.monto || ''} onChange={e => updatePagoPlan(p.id, pidx, 'monto', e.target.value)} placeholder="0.00" style={{ width: '100px', padding: '8px', fontFamily: 'monospace', border: isEditing ? '1px solid var(--warn)' : '1px solid transparent', borderRadius: '4px', background: isEditing ? '#fff' : 'transparent', fontWeight: 'bold' }} />
                                                                                    <input type="date" readOnly={!isEditing} value={pg.fecha || ''} onChange={e => updatePagoPlan(p.id, pidx, 'fecha', e.target.value)} style={{ padding: '8px', border: isEditing ? '1px solid var(--warn)' : '1px solid transparent', borderRadius: '4px', fontSize: '12px', color: '#666', background: isEditing ? '#fff' : 'transparent' }} />
                                                                                    <select
                                                                                        disabled={!isEditing}
                                                                                        value={pg.banco || 'Banco Unión (QR/Transf)'}
                                                                                        onChange={e => updatePagoPlan(p.id, pidx, 'banco', e.target.value)}
                                                                                        style={{ padding: '8px', border: isEditing ? '1px solid var(--warn)' : '1px solid transparent', borderRadius: '4px', fontSize: '12px', color: '#444', background: isEditing ? '#fff' : 'transparent', fontWeight: 'bold', cursor: isEditing ? 'pointer' : 'default' }}
                                                                                    >
                                                                                        <option value="Banco Unión (QR/Transf)">Banco Unión</option>
                                                                                        <option value="BNB">BNB</option>
                                                                                        <option value="Yasta (QR)">Yasta (QR)</option>
                                                                                        <option value="Efectivo">Efectivo</option>
                                                                                        <option value="Otros">Otros</option>
                                                                                    </select>
                                                                                </div>
                                                                                <input
                                                                                    type="text"
                                                                                    readOnly={!isEditing}
                                                                                    placeholder="Notas del pago..."
                                                                                    value={pg.nota || ''}
                                                                                    onChange={e => updatePagoPlan(p.id, pidx, 'nota', e.target.value)}
                                                                                    style={{ flex: 1, minWidth: '150px', padding: '8px', border: isEditing ? '1px solid var(--warn)' : '1px solid transparent', borderRadius: '4px', fontSize: '12px', background: isEditing ? '#fff' : 'transparent' }}
                                                                                />
                                                                                {pg.caja_id && !isEditing && (
                                                                                    <span style={{ fontSize: '10px', color: '#2e7d32', fontWeight: 'bold', background: '#e8f5e9', padding: '3px 8px', borderRadius: '4px' }}>✓ En contabilidad</span>
                                                                                )}
                                                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                                                    {isEditing ? (
                                                                                        <button onClick={() => handleConfirmarPagoPlan(p.id, pidx)} style={{ background: 'var(--ok)', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>Confirmar</button>
                                                                                    ) : (
                                                                                        <button onClick={() => setEditingPagoPlanKey(key)} style={{ background: '#fff', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', fontSize: '11px' }}>Editar</button>
                                                                                    )}
                                                                                    <button onClick={() => deletePagoPlan(p.id, pidx)} style={{ background: '#fff', color: '#eb5757', border: '1px solid #eb5757', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', fontSize: '11px' }}>✕</button>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderTop: '1px solid var(--border)' }}>
                                                            <div style={{ fontSize: '13px', fontWeight: 'bold', display: 'flex', gap: '16px' }}>
                                                                <span style={{ color: 'green' }}>Pagado: {fBS(pagado)}</span>
                                                                <span style={{ color: saldado ? 'green' : '#f37021' }}>{resta < 0 ? 'Saldo a favor: ' : 'Resta: '}{fBS(Math.abs(resta))}</span>
                                                            </div>
                                                            <button onClick={() => handleAddPagoPlan(p.id)} style={{ background: '#f37021', color: '#fff', border: 'none', padding: '8px 24px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>+ Registrar Pago</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )
            }

            {/* ========================================== */}
            {/* MÓDULO CUENTA CORRIENTE (#page-cta)        */}
            {/* ========================================== */}
            {
                activeTab === 'cuenta' && (
                    <div id="page-cta" style={{ marginBottom: '20px', fontFamily: '"DM Sans", sans-serif' }}>

                        {/* 1. TOP SUMMARY BAR */}
                        <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginBottom: '1.5rem' }}>
                            <div style={{ background: '#fdf8ed', color: 'var(--navy)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                                <h3 style={{ margin: 0, fontSize: '0.85rem', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 'bold' }}>Cuenta Corriente Socio</h3>
                                <span style={{ color: '#d4af37', fontWeight: '900', fontSize: '1rem', fontFamily: 'monospace' }}>
                                    Saldo: {fBS(Math.max(0, ctaSaldo))}
                                </span>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: 'var(--border)' }}>
                                <div style={{ background: '#fff', padding: '20px' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--border)', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Total Deuda</div>
                                    <div style={{ fontSize: '1.3rem', color: 'var(--purple)', fontWeight: '900', fontFamily: 'monospace' }}>
                                        {fBS(ctaDeuda)}
                                    </div>
                                </div>
                                <div style={{ background: '#fff', padding: '20px' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--border)', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Pagado</div>
                                    <div style={{ fontSize: '1.3rem', color: 'var(--ok)', fontWeight: '900', fontFamily: 'monospace' }}>
                                        {fBS(ctaPagado)}
                                    </div>
                                </div>
                                <div style={{ background: '#fff', padding: '20px' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--border)', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Resta</div>
                                    <div style={{ fontSize: '1.3rem', color: ctaSaldo <= 0 ? 'var(--ok)' : 'var(--warn)', fontWeight: '900', fontFamily: 'monospace' }}>
                                        {fBS(Math.max(0, ctaSaldo))}
                                    </div>
                                </div>
                            </div>
                            <div style={{ height: '4px', background: ctaSaldo <= 0 ? 'var(--ok)' : 'var(--warn)', width: '100%' }}></div>
                        </div>

                        {/* 2. DESGLOSE DE DEUDA Panel */}
                        <div style={{ background: '#fff', borderRadius: '8px', overflow: 'visible', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginBottom: '1.5rem' }}>
                            <div style={{
                                background: '#fdf8ed',
                                color: 'var(--navy)',
                                padding: '12px 16px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderBottom: '1px solid var(--border)',
                                position: 'sticky',
                                top: '0',
                                zIndex: 100,
                                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                            }}>
                                <h3 style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 'bold' }}>
                                    DETALLE DE CUENTA (BS)
                                </h3>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    {Object.keys(selectedSocioItems).some(k => selectedSocioItems[k]) && (
                                        <div style={{ marginRight: '10px', display: 'flex', gap: '8px' }}>
                                            <div style={{ background: 'var(--accent)', color: '#fff', padding: '4px 12px', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.75rem', display: 'flex', alignItems: 'center' }}>
                                                Sel: {fBS(Object.keys(selectedSocioItems).filter(k => selectedSocioItems[k]).reduce((s, k) => {
                                                    let item = availSocioItems.find(it => `${it.remId}-${it.type}` === k);
                                                    return s + (item ? item.amount : 0);
                                                }, 0))}
                                            </div>
                                            <button onClick={handleGeneratePlan} style={{ background: 'var(--navy)', color: '#fff', border: '1px solid #fff', padding: '4px 10px', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.7rem' }}>Gen Plan</button>
                                        </div>
                                    )}
                                    <input value={ctaExtraLbl} onChange={e => setCtaExtraLbl(e.target.value)} type="text" placeholder="Desc Extra" style={{ padding: '4px 8px', fontSize: '0.75rem', border: '1px solid var(--border)', borderRadius: '4px', width: '120px', color: '#000' }} />
                                    <input value={ctaExtraAmt} onChange={e => setCtaExtraAmt(e.target.value)} type="number" placeholder="0.00 BS" style={{ width: '80px', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem' }} />
                                    <button onClick={handleSaveExtraCta} style={{ background: 'var(--navy)', border: 'none', color: '#fff', borderRadius: '4px', padding: '4px 12px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>+ Extra</button>
                                </div>
                            </div>

                            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {/* Grouped availSocioItems */}
                                {Object.entries(availSocioItems.reduce((acc, item) => {
                                    if (!acc[item.nro]) acc[item.nro] = [];
                                    acc[item.nro].push(item);
                                    return acc;
                                }, {})).map(([groupName, items], idx) => (
                                    <div key={groupName} style={{ border: '1px solid var(--border)', borderRadius: '8px', background: '#fff', marginBottom: '16px', overflow: 'visible', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
                                        <div style={{
                                            background: groupName === 'OTRO CARGOS / ALQUILER' || groupName === 'Items extra' ? '#fdf8ed' : '#f4f7f9',
                                            padding: '10px 16px',
                                            fontSize: '12px',
                                            fontWeight: 'bold',
                                            color: 'var(--navy)',
                                            borderBottom: '1px solid var(--border)',
                                            position: 'sticky',
                                            top: '44px',
                                            zIndex: 80,
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                                            borderRadius: '8px 8px 0 0'
                                        }}>
                                            {groupName === 'OTRO CARGOS / ALQUILER' || groupName === 'Items extra' ? 'OTROS CARGOS / ALQUILER' : `Pedido: ${groupName}`}
                                        </div>
                                        <div>
                                            {items.map((item, i) => {
                                                const tagProps = {
                                                    envio: { bg: '#d4e4f7', color: '#1a3a5f' },
                                                    flete: { bg: '#fdf8ed', color: '#f37021' },
                                                    pedido: { bg: '#fff2cc', color: '#b38600' },
                                                    extra: { bg: '#fde4cc', color: '#cc5500' }
                                                };
                                                const tprop = tagProps[item.type] || { bg: '#eee', color: '#333' };

                                                return (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: i < items.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={!!selectedSocioItems[`${item.remId}-${item.type}`]}
                                                            onChange={e => setSelectedSocioItems({ ...selectedSocioItems, [`${item.remId}-${item.type}`]: e.target.checked })}
                                                            style={{ marginRight: '12px', width: '15px', height: '15px', cursor: 'pointer' }}
                                                        />
                                                        <span style={{ background: tprop.bg, color: tprop.color, padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 'bold', textTransform: 'uppercase', marginRight: '12px', minWidth: '50px', textAlign: 'center' }}>
                                                            {item.type}
                                                        </span>
                                                        <span style={{ flex: 1, fontSize: '0.8rem', color: '#444' }}>{item.label}</span>
                                                        <span style={{ fontWeight: 'bold', color: 'var(--purple)', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                                            {fBS(item.amount)}
                                                        </span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                ))}

                                { /* Items Extra (cta.extras) */}
                                {(cta.extras || []).length > 0 && (
                                    <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                                        <div style={{ background: '#fdf8ed', padding: '8px 12px', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--navy)', borderBottom: '1px solid var(--border)', textTransform: 'uppercase' }}>
                                            CARGOS MANUALES (CUENTA CORRIENTE)
                                        </div>
                                        <div>
                                            {(cta.extras || []).filter(ex => availSocioItems.some(it => it.remId === `extra-${ex.id}` && it.type === 'extra')).map((ex, idx) => {
                                                const isRental = ex.isAlq || (ex.label || '').startsWith('Alquiler Mes:');
                                                const isEditing = editingExtraId === ex.id;
                                                return (
                                                    <div key={ex.id || idx} style={{
                                                        display: 'flex',
                                                        flexWrap: 'wrap',
                                                        gap: '12px',
                                                        alignItems: 'center',
                                                        padding: '10px 12px',
                                                        background: isEditing ? '#fffaf2' : 'transparent',
                                                        border: isEditing ? '1px solid var(--warn)' : 'none',
                                                        borderBottom: '1px solid var(--border)',
                                                        borderRadius: isEditing ? '8px' : '0'
                                                    }}>
                                                        <div style={{ flex: 1, display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                            <span style={{
                                                                background: isRental ? '#e0f7fa' : '#fde4cc',
                                                                color: isRental ? '#006064' : '#cc5500',
                                                                padding: '2px 6px',
                                                                borderRadius: '4px',
                                                                fontSize: '0.65rem',
                                                                fontWeight: 'bold',
                                                                textTransform: 'uppercase',
                                                                width: '60px',
                                                                textAlign: 'center'
                                                            }}>
                                                                {isRental ? 'Alquiler' : 'Extra'}
                                                            </span>
                                                            <input
                                                                type="text"
                                                                readOnly={!isEditing || isRental}
                                                                value={ex.label || ''}
                                                                onChange={e => handleUpdateExtra(ex.id, 'label', e.target.value)}
                                                                style={{
                                                                    flex: 1,
                                                                    padding: '4px 8px',
                                                                    border: isEditing && !isRental ? '1px solid var(--warn)' : 'none',
                                                                    borderRadius: '4px',
                                                                    fontSize: '0.8rem',
                                                                    background: isEditing && !isRental ? '#fff' : 'transparent'
                                                                }}
                                                            />
                                                            <input
                                                                type="number"
                                                                readOnly={!isEditing || isRental}
                                                                value={ex.amount || ''}
                                                                onChange={e => handleUpdateExtra(ex.id, 'amount', e.target.value)}
                                                                style={{
                                                                    width: '100px',
                                                                    padding: '4px 8px',
                                                                    fontFamily: 'monospace',
                                                                    border: isEditing && !isRental ? '1px solid var(--warn)' : 'none',
                                                                    borderRadius: '4px',
                                                                    fontSize: '0.8rem',
                                                                    background: isEditing && !isRental ? '#fff' : 'transparent',
                                                                    textAlign: 'right',
                                                                    fontWeight: 'bold'
                                                                }}
                                                            />
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '4px' }}>
                                                            {isEditing ? (
                                                                <button onClick={() => setEditingExtraId(null)} style={{ background: 'var(--ok)', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold' }}>Confirmar</button>
                                                            ) : (
                                                                <>
                                                                    {!isRental && (
                                                                        <button onClick={() => setEditingExtraId(ex.id)} style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.8rem' }} title="Editar item">✏️</button>
                                                                    )}
                                                                </>
                                                            )}
                                                            {!isRental && (
                                                                <button onClick={() => handleDeleteManualSocioItem(ex.id)} style={{ background: 'transparent', border: 'none', color: '#eb5757', cursor: 'pointer', fontSize: '0.9rem' }} title="Borrar item">✕</button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div style={{ background: '#fdf8ed', padding: '8px 12px', fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between', color: '#666', borderTop: '1px solid var(--border)' }}>
                                            <span>Subtotal Items Extra</span>
                                            <span style={{ fontWeight: 'bold', color: 'var(--warn)', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                                {fBS((cta.extras || []).reduce((s, ex) => s + (parseFloat(ex.amount) || 0), 0))}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 3. PAGOS REGISTRADOS Panel */}
                        <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                            <div style={{ background: '#fdf8ed', color: 'var(--navy)', padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                                <h3 style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 'bold' }}>
                                    PAGOS REGISTRADOS
                                </h3>
                                <button onClick={handleAddPagoCta} style={{ background: 'var(--navy)', border: 'none', color: '#fff', borderRadius: '4px', padding: '4px 12px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>+ Registrar Pago</button>
                            </div>

                            <div style={{ padding: '16px' }}>
                                {(cta.pagos || []).length === 0 ? (
                                    <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--border)', padding: '20px 0' }}>Sin pagos aún.</div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {(cta.pagos || []).map((pg, pidx) => {
                                            const isEditing = editingPagoCtaIdx === pidx;
                                            return (
                                                <div key={pidx} style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', background: isEditing ? '#fffaf2' : '#f8f9fa', padding: '12px', borderRadius: '8px', border: '1px solid ' + (isEditing ? 'var(--warn)' : 'var(--border)') }}>
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--border)', fontWeight: 'bold', width: '20px' }}>#{pidx + 1}</span>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                        <input type="date" readOnly={!isEditing} value={pg.fecha || ''} onChange={e => updatePagoCta(pidx, 'fecha', e.target.value)} style={{ padding: '6px', border: isEditing ? '1px solid var(--warn)' : '1px solid transparent', borderRadius: '4px', fontSize: '0.75rem', color: '#666', width: '130px', background: isEditing ? '#fff' : 'transparent' }} />
                                                        <input type="number" readOnly={!isEditing} value={pg.monto || ''} onChange={e => updatePagoCta(pidx, 'monto', e.target.value)} style={{ width: '120px', padding: '6px', fontFamily: 'monospace', border: isEditing ? '1px solid var(--warn)' : '1px solid transparent', borderRadius: '4px', fontSize: '0.8rem', background: isEditing ? '#fff' : 'transparent', fontWeight: 'bold' }} placeholder="Monto BS" />
                                                    </div>
                                                    <input
                                                        type="text"
                                                        readOnly={!isEditing}
                                                        placeholder="Notas del pago..."
                                                        value={pg.nota || ''}
                                                        onChange={e => updatePagoCta(pidx, 'nota', e.target.value)}
                                                        style={{ flex: 1, minWidth: '150px', padding: '6px', border: isEditing ? '1px solid var(--warn)' : '1px solid transparent', borderRadius: '4px', fontSize: '12px', background: isEditing ? '#fff' : 'transparent' }}
                                                    />
                                                    <div style={{ display: 'flex', gap: '6px' }}>
                                                        {isEditing ? (
                                                            <button onClick={() => setEditingPagoCtaIdx(null)} style={{ background: 'var(--ok)', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold' }}>Confirmar</button>
                                                        ) : (
                                                            <button onClick={() => setEditingPagoCtaIdx(pidx)} style={{ background: '#fff', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.7rem' }}>Editar</button>
                                                        )}
                                                        <button onClick={() => handleDelPagoCta(pidx)} style={{ background: '#fff', color: '#eb5757', border: '1px solid rgba(235, 87, 87, 0.4)', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.7rem' }}>✕</button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                )
            }

            {/* ========================================== */}
            {/* MÓDULO ALQUILER (#page-alq)                */}
            {/* ========================================== */}
            {
                activeTab === 'alquiler' && (
                    <div id="page-alq" style={{ padding: '24px', marginBottom: '20px', backgroundColor: 'var(--bg)', borderRadius: '8px', border: '1px solid var(--border)', fontFamily: '"DM Sans", sans-serif' }}>

                        {/* Header & Botón Configurar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <div>
                                <h2 style={{ color: 'var(--navy)', margin: 0, fontSize: '1.5rem', fontWeight: '900' }}>Alquiler</h2>
                                <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '0.85rem' }}>Control mensual · Los meses vencidos añaden automáticamente el costo del alquiler a los ítems por cobrar del Socio</p>
                            </div>
                            <button
                                onClick={() => {
                                    setAlqConfigData({
                                        totalBS: alq.config?.totalBS || 1850,
                                        socioBS: alq.config?.socioBS || 600,
                                        mesInicio: alq.config?.mesInicio || ''
                                    });
                                    setShowConfigAlq(true);
                                }}
                                style={{ background: '#f37021', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 8px rgba(243, 112, 33, 0.3)' }}
                            >
                                ⚙ Configurar
                            </button>
                        </div>

                        {/* KPIs Superiores */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
                            <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #f0f0f0', borderLeft: '4px solid #f37021', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
                                <div style={{ fontSize: '0.65rem', color: '#888', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>TOTAL POR MES</div>
                                <div style={{ fontSize: '1.4rem', color: '#f37021', fontWeight: '900', fontFamily: 'monospace' }}>{fBS(alq.config?.totalBS || 1850)}</div>
                            </div>
                            <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #f0f0f0', borderLeft: '4px solid #27ae60', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
                                <div style={{ fontSize: '0.65rem', color: '#888', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>TU PARTE / MES</div>
                                <div style={{ fontSize: '1.4rem', color: '#27ae60', fontWeight: '900', fontFamily: 'monospace' }}>{fBS((alq.config?.totalBS || 1850) - (alq.config?.socioBS || 600))}</div>
                            </div>
                            <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #f0f0f0', borderLeft: '4px solid #673ab7', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
                                <div style={{ fontSize: '0.65rem', color: '#888', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>PARTE SOCIO / MES</div>
                                <div style={{ fontSize: '1.4rem', color: '#673ab7', fontWeight: '900', fontFamily: 'monospace' }}>{fBS(alq.config?.socioBS || 600)}</div>
                            </div>
                            <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #f0f0f0', borderLeft: '4px solid var(--navy)', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
                                <div style={{ fontSize: '0.65rem', color: '#888', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>MESES AL SOCIO</div>
                                <div style={{ fontSize: '1.4rem', color: 'var(--navy)', fontWeight: '900', fontFamily: 'monospace' }}>
                                    {(alq.meses || []).filter(m => m.cargado).length} <span style={{ color: '#ccc', fontWeight: 'normal' }}>/ {(alq.meses || []).length}</span>
                                </div>
                            </div>
                        </div>

                        {/* Botón Añadir Mes Manual y Fechas */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                            <button onClick={handleAddAlq} style={{ background: '#27ae60', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 2px 6px rgba(39, 174, 96, 0.3)' }}>+ Mes</button>
                            <div style={{ color: '#666', fontSize: '0.9rem', fontWeight: 'bold' }}>
                                {alq.meses && alq.meses.length > 0
                                    ? `Desde ${formatMesAlq(alq.meses[0].ym)} hasta ${formatMesAlq(alq.meses[alq.meses.length - 1].ym)}`
                                    : 'Sin meses registrados'}
                            </div>
                        </div>

                        {/* Tabla */}
                        <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '14px' }}>
                                <thead>
                                    <tr style={{ background: 'var(--navy)', color: '#fff' }}>
                                        <th style={{ padding: '16px', textAlign: 'left', width: '18%' }}>MES</th>
                                        <th style={{ padding: '16px', width: '12%' }}>TOTAL BS</th>
                                        <th style={{ padding: '16px', width: '12%' }}>TU PARTE BS</th>
                                        <th style={{ padding: '16px', width: '12%' }}>SOCIO BS</th>
                                        <th style={{ padding: '16px', width: '16%' }}>MI PAGO</th>
                                        <th style={{ padding: '16px', width: '16%' }}>ESTADO SOCIO</th>
                                        <th style={{ padding: '16px', width: '14%' }}>ACCIONES</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(alq.meses || []).map((m, idx) => {
                                        return (
                                            <tr key={idx} style={{ borderBottom: '1px solid #ebebeb' }}>
                                                <td style={{ padding: '16px', textAlign: 'left', fontWeight: 'bold', color: '#111' }}>
                                                    {formatMesAlq(m.ym)}
                                                </td>
                                                <td style={{ padding: '16px', fontWeight: '900', color: '#f37021', fontFamily: 'monospace' }}>
                                                    {fBS(m.totalBS || 0)}
                                                </td>
                                                <td style={{ padding: '16px', fontWeight: '900', color: '#27ae60', fontFamily: 'monospace' }}>
                                                    {fBS(m.tuParteBS || 0)}
                                                </td>
                                                <td style={{ padding: '16px', fontWeight: '900', color: '#673ab7', fontFamily: 'monospace' }}>
                                                    {fBS(m.socioBS || 0)}
                                                </td>
                                                {/* MI PAGO */}
                                                <td style={{ padding: '16px', textAlign: 'center' }}>
                                                    {m.pagadoPorMi ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                                            <span style={{ color: '#27ae60', fontWeight: 'bold', fontSize: '0.8rem' }}>✓ Pagado</span>
                                                            <button
                                                                onClick={() => {
                                                                    openConfirm('Deshacer Pago', `¿Deshacer el pago de ${formatMesAlq(m.ym)}? (El egreso en contabilidad NO se borra automáticamente)`, async () => {
                                                                        const newAlq = { ...alq };
                                                                        newAlq.meses = [...alq.meses];
                                                                        newAlq.meses[idx] = { ...alq.meses[idx], pagadoPorMi: false };
                                                                        setAlq(newAlq);
                                                                        await saveAlq(newAlq);
                                                                    });
                                                                }}
                                                                style={{ background: '#fff', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.4)', padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}
                                                            >
                                                                Deshacer
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => {
                                                                setAlqMetodo('Efectivo Personal');
                                                                setAlqPagoModal({ idx, mes: formatMesAlq(m.ym), totalBS: parseFloat(m.totalBS) || 0, socioBS: parseFloat(m.socioBS) || 0 });
                                                            }}
                                                            style={{ background: '#27ae60', color: 'white', border: 'none', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 6px rgba(39,174,96,0.3)' }}
                                                        >
                                                            💵 Pagar alquiler
                                                        </button>
                                                    )}
                                                </td>
                                                {/* ESTADO SOCIO */}
                                                <td style={{ padding: '16px' }}>
                                                    {m.cargado ? (
                                                        <span style={{ color: '#27ae60', fontWeight: 'bold', fontSize: '0.85rem' }}>✓ Auto - En CTA</span>
                                                    ) : (
                                                        <span style={{ color: '#aaa', fontWeight: 'bold', fontSize: '0.85rem' }}>Pendiente</span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
                                                    {!m.cargado && (
                                                        <button
                                                            onClick={() => {
                                                                openConfirm('Carga Manual', `¿Forzar carga de ${formatMesAlq(m.ym)} a Cuenta Corriente?`, async () => {
                                                                    await cargarAlqToCta(idx);
                                                                });
                                                            }}
                                                            style={{ background: '#2980b9', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                                                        >
                                                            → CTA
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => {
                                                            openConfirm('Borrar Mes', '¿Estás seguro de que deseas borrar este mes de alquiler?', () => {
                                                                deleteAlq(idx);
                                                                showToast('Mes eliminado.', 'success');
                                                            });
                                                        }}
                                                        style={{ background: '#fff', color: '#eb5757', border: '1px solid rgba(235, 87, 87, 0.4)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                                                    >
                                                        ✕
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr style={{ background: 'var(--navy)', color: '#fff', borderTop: '4px solid #f37021' }}>
                                        <td style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold' }}>
                                            TOTAL ({(alq.meses || []).length} meses)
                                        </td>
                                        <td style={{ padding: '16px', fontWeight: '900', fontFamily: 'monospace', color: '#fcdcb4' }}>
                                            {fBS((alq.meses || []).reduce((s, m) => s + (parseFloat(m.totalBS) || 0), 0))}
                                        </td>
                                        <td style={{ padding: '16px', fontWeight: '900', fontFamily: 'monospace', color: '#bcf2cd' }}>
                                            {fBS((alq.meses || []).reduce((s, m) => s + (parseFloat(m.tuParteBS) || 0), 0))}
                                        </td>
                                        <td style={{ padding: '16px', fontWeight: '900', fontFamily: 'monospace', color: '#d9ccfe' }}>
                                            {fBS((alq.meses || []).reduce((s, m) => s + (parseFloat(m.socioBS) || 0), 0))}
                                        </td>
                                        <td colSpan="3"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* Modal Configuración Alquiler */}
                        {showConfigAlq && (
                            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                                <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '350px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                    <h3 style={{ margin: '0 0 16px 0', color: 'var(--navy)' }}>Configuración de Alquiler</h3>
                                    <div style={{ marginBottom: '12px' }}>
                                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>Mes de Inicio</label>
                                        <input type="month" value={alqConfigData.mesInicio} onChange={e => setAlqConfigData({ ...alqConfigData, mesInicio: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', color: '#000' }} title="El mes donde empezará a contar automáticamente el alquiler" />
                                    </div>
                                    <div style={{ marginBottom: '12px' }}>
                                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>Total por mes (BS)</label>
                                        <input type="number" value={alqConfigData.totalBS} onChange={e => setAlqConfigData({ ...alqConfigData, totalBS: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', color: '#000' }} placeholder="Ej: 1850" />
                                    </div>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>Parte del Socio (BS)</label>
                                        <input type="number" value={alqConfigData.socioBS} onChange={e => setAlqConfigData({ ...alqConfigData, socioBS: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', color: '#000' }} placeholder="Ej: 600" />
                                    </div>
                                    <div style={{ background: '#f8f9fa', padding: '12px', borderRadius: '4px', marginBottom: '20px', fontSize: '0.85rem' }}>
                                        <strong>Tu parte calculada:</strong> {fBS((parseFloat(alqConfigData.totalBS) || 0) - (parseFloat(alqConfigData.socioBS) || 0))}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                                        <button onClick={() => setShowConfigAlq(false)} style={{ flex: 1, padding: '10px', background: '#f1f1f1', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>Cancelar</button>
                                        <button onClick={handleSaveAlqConfig} style={{ flex: 1, padding: '10px', background: 'var(--accent)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#fff' }}>Guardar</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )
            }
            {/* 6. TOAST NOTIFICATIONS CONTAINER */}
            <div style={{
                position: 'fixed',
                bottom: '24px',
                right: '24px',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                pointerEvents: 'none'
            }}>
                {toasts.map(t => (
                    <div key={t.id} style={{
                        background: t.type === 'error' ? '#fff1f0' : (t.type === 'success' ? '#f6ffed' : '#e6f7ff'),
                        border: '1px solid ' + (t.type === 'error' ? '#ffa39e' : (t.type === 'success' ? '#b7eb8f' : '#91d5ff')),
                        color: t.type === 'error' ? '#cf1322' : (t.type === 'success' ? '#389e0d' : '#096dd9'),
                        padding: '12px 20px',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        fontSize: '14px',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        minWidth: '280px',
                        animation: 'toastIn 0.3s ease-out forwards',
                        pointerEvents: 'auto'
                    }}>
                        <span style={{ fontSize: '18px' }}>
                            {t.type === 'success' ? '✅' : (t.type === 'error' ? '❌' : 'ℹ️')}
                        </span>
                        {t.msg}
                    </div>
                ))}
            </div>

            {/* MODAL: PAGAR ALQUILER */}
            {alqPagoModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
                    <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '380px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                        <h3 style={{ margin: '0 0 4px 0', color: 'var(--navy)' }}>🏠 Pagar Alquiler</h3>
                        <p style={{ margin: '0 0 16px 0', fontSize: '0.8rem', color: '#666' }}>{alqPagoModal.mes}</p>
                        <div style={{ marginBottom: '12px', padding: '12px', background: '#f8f8f8', borderRadius: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                <span style={{ fontSize: '0.78rem', color: '#666' }}>Total que pagás</span>
                                <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--navy)' }}>{fBS(alqPagoModal.totalBS)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px dashed #ddd' }}>
                                <span style={{ fontSize: '0.75rem', color: '#888' }}>El socio te devuelve</span>
                                <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#673ab7' }}>{fBS(alqPagoModal.socioBS)}</span>
                            </div>
                        </div>
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#666' }}>¿De qué cuenta sale el dinero?</label>
                            <select value={alqMetodo} onChange={e => setAlqMetodo(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', background: '#fff' }}>
                                {['Efectivo', 'Yasta (QR)', 'Banco Unión (QR/Transf)', 'BNB', 'Efectivo Personal', 'Otros'].map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setAlqPagoModal(null)} disabled={alqSaving} style={{ flex: 1, padding: '10px', background: '#f1f1f1', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>Cancelar</button>
                            <button onClick={() => pagarMiParteAlq(alqPagoModal.idx, alqMetodo)} disabled={alqSaving} style={{ flex: 1, padding: '10px', background: alqSaving ? '#aaa' : 'var(--ok)', border: 'none', borderRadius: '4px', cursor: alqSaving ? 'not-allowed' : 'pointer', fontWeight: 'bold', color: '#fff' }}>
                                {alqSaving ? 'Registrando...' : 'Confirmar Pago'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 7. CUSTOM CONFIRMATION MODAL */}
            {confirmModal.show && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10000,
                    backdropFilter: 'blur(4px)',
                    animation: 'fadeIn 0.2s ease-out'
                }}>
                    <div style={{
                        background: '#fff',
                        borderRadius: '12px',
                        width: '90%',
                        maxWidth: '450px',
                        padding: '24px',
                        boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
                        animation: 'slideUp 0.3s ease-out'
                    }}>
                        <h3 style={{ margin: '0 0 16px 0', color: '#1a1a1a', fontSize: '1.2rem', fontWeight: '800' }}>
                            {confirmModal.title}
                        </h3>
                        <p style={{ margin: '0 0 24px 0', color: '#444', lineHeight: '1.5', fontSize: '14px', whiteSpace: 'pre-wrap' }}>
                            {confirmModal.msg}
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button
                                onClick={() => setConfirmModal({ ...confirmModal, show: false })}
                                style={{
                                    background: '#f4f4f4',
                                    color: '#666',
                                    border: 'none',
                                    padding: '10px 20px',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '14px'
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    if (confirmModal.onConfirm) confirmModal.onConfirm();
                                    setConfirmModal({ ...confirmModal, show: false });
                                }}
                                style={{
                                    background: confirmModal.title.includes('BORRAR') || confirmModal.title.includes('CRÍTICA') ? '#ff4d4f' : 'var(--navy)',
                                    color: '#fff',
                                    border: 'none',
                                    padding: '10px 20px',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '14px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                                }}
                            >
                                Aceptar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes toastIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `}</style>

        </div>
    );
}
