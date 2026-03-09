import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import {
    Plus,
    Trash2,
    TrendingUp,
    TrendingDown,
    DollarSign,
    AlertCircle,
    CheckCircle2,
    Clock,
    ArrowRight,
    Settings,
    X
} from 'lucide-react';

export default function DistributorView() {
    const [pedidos, setPedidos] = useState([]);
    const [pagos, setPagos] = useState([]);
    const [ajustes, setAjustes] = useState([]);
    const [saldoIni, setSaldoIni] = useState({ monto: 0, tipo: 'deuda' });
    const [fifoData, setFifoData] = useState({ debitos: [], saldoARS: 0, saldoTC: 0, saldoBS: 0 });
    const [loading, setLoading] = useState(true);

    // Form states
    const [newPedido, setNewPedido] = useState({ nombre: '', monto: '' });
    const [newPago, setNewPago] = useState({ fecha: new Date().toISOString().split('T')[0], monto: '', tc: '', nota: '' });
    const [showConfig, setShowConfig] = useState(false);
    const [configSaldoIni, setConfigSaldoIni] = useState({ monto: '', tipo: 'deuda' });
    const [newAjuste, setNewAjuste] = useState({ monto: '', nota: '', tipo: 'favor' });

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        const { data: p } = await supabase.from('dist_pedidos').select('*').order('orden', { ascending: true });
        const { data: pg } = await supabase.from('dist_pagos').select('*').order('fecha', { ascending: true });
        const { data: aj } = await supabase.from('dist_ajustes').select('*').order('created_at', { ascending: true });
        const { data: si } = await supabase.from('dist_saldo_inicial').select('*').single();

        setPedidos(p || []);
        setPagos(pg || []);
        setAjustes(aj || []);
        if (si) {
            setSaldoIni(si);
            setConfigSaldoIni({ monto: si.monto, tipo: si.tipo });
        }

        calculateFIFO(p || [], pg || [], aj || [], si || { monto: 0, tipo: 'deuda' });
        setLoading(false);
    };

    const calculateFIFO = (pedidosArr, pagosArr, ajustesArr, si) => {
        // Simple FIFO logic for UI
        const pool = [];
        if (si.monto > 0 && si.tipo === 'favor') {
            pool.push({ restante: parseFloat(si.monto), tc: 0, nota: 'Saldo inicial' });
        }
        pagosArr.forEach(p => pool.push({ restante: parseFloat(p.monto), tc: parseFloat(p.tc), nota: p.nota }));

        // Adjustments
        ajustesArr.forEach(a => {
            const m = parseFloat(a.monto);
            if (m > 0) pool.push({ restante: m, tc: 0, nota: a.nota });
            else {
                let resta = Math.abs(m);
                for (let i = pool.length - 1; i >= 0 && resta > 0; i--) {
                    const quitar = Math.min(pool[i].restante, resta);
                    pool[i].restante -= quitar;
                    resta -= quitar;
                }
            }
        });

        const debitos = [];
        if (si.monto > 0 && si.tipo === 'deuda') {
            debitos.push({ nombre: 'Saldo Inicial', monto: parseFloat(si.monto), remId: -1 });
        }
        pedidosArr.forEach(p => debitos.push({ nombre: p.nombre, monto: parseFloat(p.monto), remId: p.id }));

        const resultado = debitos.map(d => {
            let pendiente = d.monto;
            let cubierto = 0;
            let sp = 0, sm = 0;
            for (let i = 0; i < pool.length && pendiente > 0; i++) {
                if (pool[i].restante <= 0) continue;
                const usar = Math.min(pool[i].restante, pendiente);
                pool[i].restante -= usar;
                pendiente -= usar;
                cubierto += usar;
                if (pool[i].tc > 0) { sp += usar * pool[i].tc; sm += usar; }
            }
            const tcPond = sm > 0 ? sp / sm : 0;
            return { ...d, cubierto, pendiente, tcPond, status: (cubierto >= d.monto) ? 'pagado' : (cubierto > 0 ? 'parcial' : 'pendiente') };
        });

        const saldoARS = pool.reduce((acc, p) => acc + p.restante, 0);
        let sp_s = 0, sm_s = 0;
        pool.forEach(p => { if (p.restante > 0 && p.tc > 0) { sp_s += p.restante * p.tc; sm_s += p.restante; } });
        const saldoTC = sm_s > 0 ? sp_s / sm_s : 0;

        setFifoData({ debitos: resultado, saldoARS, saldoTC, saldoBS: saldoARS * saldoTC });
    };

    const handleAddPedido = async () => {
        if (!newPedido.nombre || !newPedido.monto) return;
        const newOrden = pedidos.length > 0 ? Math.max(...pedidos.map(p => p.orden)) + 1 : 1;
        await supabase.from('dist_pedidos').insert([{ nombre: newPedido.nombre, monto: parseFloat(newPedido.monto), orden: newOrden }]);
        setNewPedido({ nombre: '', monto: '' });
        fetchData();
    };

    const handleDeletePedido = async (id) => {
        if (!window.confirm('¿Eliminar este registro de deuda?')) return;
        const { error } = await supabase.from('dist_pedidos').delete().eq('id', id);
        if (error) alert('Error: ' + error.message);
        else fetchData();
    };

    const [editingPedido, setEditingPedido] = useState(null);
    const handleStartEdit = (p) => setEditingPedido({ ...p });
    const handleSaveEdit = async () => {
        if (!editingPedido) return;
        const { error } = await supabase.from('dist_pedidos').update({
            nombre: editingPedido.nombre,
            monto: parseFloat(editingPedido.monto)
        }).eq('id', editingPedido.id);
        if (error) alert('Error: ' + error.message);
        else {
            setEditingPedido(null);
            fetchData();
        }
    };

    const handleAddPago = async () => {
        if (!newPago.monto || !newPago.tc) return;
        await supabase.from('dist_pagos').insert([{
            fecha: newPago.fecha,
            monto: parseFloat(newPago.monto),
            tc: parseFloat(newPago.tc),
            nota: newPago.nota
        }]);
        setNewPago({ fecha: new Date().toISOString().split('T')[0], monto: '', tc: '', nota: '' });
        fetchData();
    };

    const handleUpdateSaldoInicial = async () => {
        if (configSaldoIni.monto === '') return;
        const upsertData = { id: 1, monto: parseFloat(configSaldoIni.monto), tipo: configSaldoIni.tipo };
        await supabase.from('dist_saldo_inicial').upsert([upsertData]);
        alert('Saldo inicial actualizado correctamente.');
        fetchData();
    };

    const handleAddAjuste = async () => {
        if (!newAjuste.monto || !newAjuste.nota) return;
        let finalMonto = parseFloat(newAjuste.monto);
        if (newAjuste.tipo === 'deuda') finalMonto = -finalMonto; // Negative for debt adj

        await supabase.from('dist_ajustes').insert([{ monto: finalMonto, nota: newAjuste.nota }]);
        setNewAjuste({ monto: '', nota: '', tipo: 'favor' });
        fetchData();
    };

    if (loading) return <div className="p-20 text-center text-sky animate-pulse">Analizando Flujo de Caja...</div>;

    const handleDeleteAjuste = async (id) => {
        if (!window.confirm('¿Eliminar este ajuste?')) return;
        const { error } = await supabase.from('dist_ajustes').delete().eq('id', id);
        if (error) alert('Error: ' + error.message);
        else fetchData();
    };

    const totalPedidos = pedidos.reduce((acc, p) => acc + parseFloat(p.monto), 0) + (saldoIni.tipo === 'deuda' ? parseFloat(saldoIni.monto) : 0);
    const totalPagado = pagos.reduce((acc, p) => acc + parseFloat(p.monto), 0);

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-2xl border-l-4 border-accent shadow-sm">
                    <p className="text-[10px] font-bold text-sky uppercase tracking-widest mb-1">Total Pedidos</p>
                    <p className="text-xl font-bold font-mono-numbers">ARS {totalPedidos.toLocaleString()}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl border-l-4 border-green-500 shadow-sm">
                    <p className="text-[10px] font-bold text-sky uppercase tracking-widest mb-1">Total Pagado</p>
                    <p className="text-xl font-bold font-mono-numbers">ARS {totalPagado.toLocaleString()}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl border-l-4 border-blue-500 shadow-sm">
                    <p className="text-[10px] font-bold text-sky uppercase tracking-widest mb-1">Saldo a Favor</p>
                    <p className="text-xl font-bold font-mono-numbers text-blue-600">ARS {fifoData.saldoARS.toLocaleString()}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl border-l-4 border-navy shadow-sm">
                    <p className="text-[10px] font-bold text-sky uppercase tracking-widest mb-1">TC Ponderado Saldo</p>
                    <p className="text-xl font-bold font-mono-numbers">{fifoData.saldoTC.toFixed(7)}</p>
                </div>
            </div>

            {/* Configuración Toggle */}
            <div className="flex justify-end mb-2">
                <button
                    onClick={() => setShowConfig(!showConfig)}
                    className="text-xs font-bold text-navy bg-navy/5 hover:bg-navy/10 px-4 py-2 rounded-xl transition-colors flex items-center gap-2"
                >
                    ⚙️ Configuración de Cuenta y Saldos Anteriores {showConfig ? '▲' : '▼'}
                </button>
            </div>

            {/* Configuración Panel */}
            {showConfig && (
                <div className="bg-navy/5 rounded-2xl p-6 border border-navy/10 animate-in slide-in-from-top-4 mb-8">
                    <h4 className="font-bold text-sm text-navy mb-4 uppercase tracking-widest">Ajustes Especiales</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Saldo Inicial */}
                        <div className="space-y-3">
                            <p className="text-xs font-bold text-navy/70 uppercase">Establecer Punto de Partida (Saldo Inicial)</p>
                            <div className="flex items-center gap-2">
                                <select
                                    className="bg-white border border-border/50 p-2 rounded-lg text-xs"
                                    value={configSaldoIni.tipo} onChange={e => setConfigSaldoIni({ ...configSaldoIni, tipo: e.target.value })}
                                >
                                    <option value="deuda">Comencé con Deuda</option>
                                    <option value="favor">Comencé con Saldo a Favor</option>
                                </select>
                                <input
                                    type="number" placeholder="Monto ARS"
                                    className="bg-white border border-border/50 p-2 rounded-lg text-xs flex-1"
                                    value={configSaldoIni.monto} onChange={e => setConfigSaldoIni({ ...configSaldoIni, monto: e.target.value })}
                                />
                                <button onClick={handleUpdateSaldoInicial} className="bg-navy text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-navy/80">Guardar</button>
                            </div>
                            <p className="text-[10px] text-muted italic">Define con cuánto saldo arrancaste el sistema para que las matemáticas cuadren perfectamente.</p>
                        </div>

                        {/* Ajustes Manuales */}
                        <div className="space-y-3 border-l border-border/40 pl-8">
                            <p className="text-xs font-bold text-navy/70 uppercase">Ingresar Nuevo Ajuste Manual</p>
                            <div className="flex items-center gap-2">
                                <select
                                    className="bg-white border border-border/50 p-2 rounded-lg text-xs"
                                    value={newAjuste.tipo} onChange={e => setNewAjuste({ ...newAjuste, tipo: e.target.value })}
                                >
                                    <option value="favor">Quitar deuda (A tu favor)</option>
                                    <option value="deuda">Agregar deuda (En tu contra)</option>
                                </select>
                                <input
                                    type="text" placeholder="Concepto"
                                    className="bg-white border border-border/50 p-2 rounded-lg text-xs flex-1"
                                    value={newAjuste.nota} onChange={e => setNewAjuste({ ...newAjuste, nota: e.target.value })}
                                />
                                <input
                                    type="number" placeholder="ARS"
                                    className="bg-white border border-border/50 p-2 rounded-lg text-xs w-24"
                                    value={newAjuste.monto} onChange={e => setNewAjuste({ ...newAjuste, monto: e.target.value })}
                                />
                                <button onClick={handleAddAjuste} className="bg-accent text-white px-3 py-2 rounded-lg hover:bg-accent/90"><Plus size={16} /></button>
                            </div>
                        </div>
                    </div>

                    {/* Historial de Ajustes */}
                    <div className="md:col-span-2 space-y-2 pt-4 border-t border-border/40">
                        <p className="text-xs font-bold text-navy/70 uppercase">Historial de Ajustes Manuales</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                            {ajustes.map(aj => (
                                <div key={aj.id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-border/40 shadow-sm">
                                    <div className="flex flex-col">
                                        <span className={`text-[10px] font-bold uppercase ${aj.tipo === 'favor' ? 'text-green-600' : 'text-red-500'}`}>
                                            {aj.tipo === 'favor' ? '↓ Descuento / Favor' : '↑ Cargo / Deuda'}
                                        </span>
                                        <span className="text-xs font-bold text-navy truncate max-w-[180px]">{aj.nota || 'Ajuste sin nota'}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className={`text-xs font-mono font-bold ${aj.tipo === 'favor' ? 'text-green-600' : 'text-red-500'}`}>
                                            {aj.tipo === 'favor' ? '-' : '+'} ARS {Math.round(Math.abs(aj.monto)).toLocaleString()}
                                        </span>
                                        <button
                                            onClick={() => handleDeleteAjuste(aj.id)}
                                            className="p-1.5 text-error/40 hover:text-error hover:bg-error/10 rounded-lg transition-all"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {ajustes.length === 0 && (
                                <div className="md:col-span-2 py-4 text-center border-2 border-dashed border-border/20 rounded-xl">
                                    <p className="text-xs text-muted/40 italic">No hay ajustes manuales registrados para esta cuenta.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Pedidos Column */}
                <div className="bg-white rounded-2xl border border-border/40 shadow-sm overflow-hidden">
                    <div className="bg-navy p-4 text-white flex justify-between items-center">
                        <h4 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                            <TrendingDown size={14} className="text-accent" /> Pedidos (Argentina)
                        </h4>
                    </div>
                    <div className="p-6 space-y-4">
                        <div className="flex gap-2">
                            <input
                                type="text" placeholder="Nombre Pedido"
                                className="flex-1 bg-background border border-border/40 p-2 rounded-lg text-xs"
                                value={newPedido.nombre} onChange={e => setNewPedido({ ...newPedido, nombre: e.target.value })}
                            />
                            <input
                                type="number" placeholder="Monto ARS"
                                className="w-32 bg-background border border-border/40 p-2 rounded-lg text-xs text-right font-mono"
                                value={newPedido.monto} onChange={e => setNewPedido({ ...newPedido, monto: e.target.value })}
                            />
                            <button onClick={handleAddPedido} className="bg-accent text-white p-2 rounded-lg hover:bg-accent/90 transition-all">
                                <Plus size={16} />
                            </button>
                        </div>
                        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {pedidos.map(p => (
                                <div key={p.id} className="flex items-center justify-between p-3 bg-background/50 border border-border/40 rounded-xl group transition-all hover:border-accent/40">
                                    {editingPedido?.id === p.id ? (
                                        <div className="flex gap-2 w-full">
                                            <input
                                                className="flex-1 bg-white border border-accent p-1 rounded text-xs"
                                                value={editingPedido.nombre} onChange={e => setEditingPedido({ ...editingPedido, nombre: e.target.value })}
                                            />
                                            <input
                                                className="w-24 bg-white border border-accent p-1 rounded text-xs font-mono"
                                                type="number"
                                                value={editingPedido.monto} onChange={e => setEditingPedido({ ...editingPedido, monto: e.target.value })}
                                            />
                                            <button onClick={handleSaveEdit} className="text-green-600 hover:scale-110"><CheckCircle2 size={16} /></button>
                                            <button onClick={() => setEditingPedido(null)} className="text-error hover:scale-110"><X size={16} /></button>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-navy/5 flex items-center justify-center text-navy font-bold text-[10px]">#{p.orden}</div>
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-bold text-navy uppercase truncate max-w-[200px] md:max-w-none">{p.nombre}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className="text-xs font-mono font-bold text-accent">ARS {p.monto.toLocaleString()}</span>
                                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => handleStartEdit(p)} className="p-1 text-sky hover:bg-sky/10 rounded"><Settings size={14} /></button>
                                                    <button onClick={() => handleDeletePedido(p.id)} className="p-1 text-error hover:bg-error/10 rounded"><Trash2 size={14} /></button>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Pagos Column */}
                <div className="bg-white rounded-2xl border border-border/40 shadow-sm overflow-hidden">
                    <div className="bg-navy p-4 text-white flex justify-between items-center">
                        <h4 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                            <TrendingUp size={14} className="text-green-400" /> Pagos & Créditos
                        </h4>
                    </div>
                    <div className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-2">
                            <input
                                type="date"
                                className="bg-background border border-border/40 p-2 rounded-lg text-xs"
                                value={newPago.fecha} onChange={e => setNewPago({ ...newPago, fecha: e.target.value })}
                            />
                            <input
                                type="text" placeholder="Nota/Ref"
                                className="bg-background border border-border/40 p-2 rounded-lg text-xs"
                                value={newPago.nota} onChange={e => setNewPago({ ...newPago, nota: e.target.value })}
                            />
                            <input
                                type="number" placeholder="Monto ARS"
                                className="bg-background border border-border/40 p-2 rounded-lg text-xs text-right font-mono"
                                value={newPago.monto} onChange={e => setNewPago({ ...newPago, monto: e.target.value })}
                            />
                            <div className="flex gap-2">
                                <input
                                    type="number" step="0.0001" placeholder="TC"
                                    className="flex-1 bg-background border border-border/40 p-2 rounded-lg text-xs text-right font-mono"
                                    value={newPago.tc} onChange={e => setNewPago({ ...newPago, tc: e.target.value })}
                                />
                                <button onClick={handleAddPago} className="bg-green-600 text-white p-2 rounded-lg hover:bg-green-700 transition-all">
                                    <Plus size={16} />
                                </button>
                            </div>
                        </div>
                        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {pagos.map(p => (
                                <div key={p.id} className="flex items-center justify-between p-3 bg-green-50/30 border border-green-100 rounded-xl">
                                    <div>
                                        <p className="text-[10px] font-bold text-green-700">{p.fecha}</p>
                                        <p className="text-xs font-bold text-navy truncate max-w-[150px]">{p.nota || 'Pago registrado'}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-mono font-bold text-green-600">ARS {p.monto.toLocaleString()}</p>
                                        <p className="text-[10px] font-mono text-muted">TC: {parseFloat(p.tc).toFixed(4)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* FIFO Section */}
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-1 bg-accent rounded-full"></div>
                    <h4 className="text-xs font-bold text-sky uppercase tracking-[0.3em]">Estado de Liquidación (FIFO)</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {fifoData.debitos.map((d, i) => (
                        <div key={i} className="bg-white p-5 rounded-2xl border border-border/40 shadow-sm relative group overflow-hidden">
                            {/* Progress Bar background */}
                            <div
                                className={`absolute bottom-0 left-0 h-1 transition-all duration-1000 ${d.status === 'pagado' ? 'bg-green-500' : (d.status === 'parcial' ? 'bg-orange-400' : 'bg-red-400')}`}
                                style={{ width: `${(d.cubierto / d.monto) * 100}%` }}
                            ></div>

                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <p className="text-[10px] font-bold text-sky uppercase tracking-widest">{d.nombre}</p>
                                    <p className="text-sm font-bold text-navy font-mono-numbers">ARS {d.monto.toLocaleString()}</p>
                                </div>
                                {d.status === 'pagado' ? <CheckCircle2 size={16} className="text-green-500" /> : <Clock size={16} className="text-orange-400 animate-pulse" />}
                            </div>

                            <div className="flex items-center gap-2 mb-2">
                                <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden border border-border/20">
                                    <div
                                        className={`h-full transition-all duration-1000 ${d.status === 'pagado' ? 'bg-green-500' : (d.status === 'parcial' ? 'bg-orange-400' : 'bg-red-400')}`}
                                        style={{ width: `${(d.cubierto / d.monto) * 100}%` }}
                                    ></div>
                                </div>
                                <span className="text-[10px] font-black font-mono text-navy">{Math.round((d.cubierto / d.monto) * 100)}%</span>
                            </div>

                            <div className="flex justify-between items-end border-t border-border/20 pt-3">
                                <div className="text-[10px] text-muted font-bold uppercase">TC Ponderado</div>
                                <div className="text-xs font-mono-numbers font-bold text-navy">{d.tcPond.toFixed(7)}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div >
    );
}
