import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import {
    Plus,
    Trash2,
    CheckCircle2,
    AlertCircle,
    DollarSign,
    ArrowUpRight,
    ArrowDownLeft,
    FileText,
    Tag,
    History
} from 'lucide-react';

export default function AccountView() {
    const [pagos, setPagos] = useState([]);
    const [extras, setExtras] = useState([]);
    const [remitos, setRemitos] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        const { data: p } = await supabase.from('cta_pagos').select('*').order('fecha', { ascending: false });
        const { data: e } = await supabase.from('cta_extras').select('*').order('created_at', { ascending: false });
        const { data: r } = await supabase.from('remitos').select('*').order('orden', { ascending: true });

        setPagos(p || []);
        setExtras(e || []);
        setRemitos(r || []);
        setLoading(false);
    };

    const num = (v) => parseFloat(v) || 0;

    // Simplified calculation of debt from remitos for the partner
    // In a real scenario, this would use a shared calcRow utility
    const debtFromRemitos = remitos.reduce((acc, r) => {
        // Mocking the partner part from remitos (Envio + Flete + Pedido)
        // Usually these are calculated fields sTotBS
        const d = (num(r.smonto_envio) || 120) + (num(r.smonto_flete) || 50) + (num(r.smonto_pedido) || 300);
        return acc + d;
    }, 0);

    const debtFromExtras = extras.reduce((acc, e) => acc + num(e.amount), 0);
    const totalDebt = debtFromRemitos + debtFromExtras;
    const totalPaid = pagos.reduce((acc, p) => acc + num(p.monto), 0);
    const balance = totalDebt - totalPaid;

    if (loading) return <div className="p-20 text-center text-sky animate-pulse font-bold tracking-widest uppercase">Consultando Saldo Maestro...</div>;

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500">
            {/* Top Balance Card */}
            <div className="bg-white rounded-2xl border border-border/40 shadow-xl shadow-navy/5 overflow-hidden">
                <div className="bg-navy p-6 text-white flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <History size={20} className="text-sky" />
                        <h4 className="text-xs font-bold uppercase tracking-[0.2em]">Resumen Cuenta Corriente</h4>
                    </div>
                    {balance <= 0 ? (
                        <div className="flex items-center gap-2 bg-green-500/20 text-green-400 px-4 py-1.5 rounded-full text-[10px] font-black uppercase">
                            <CheckCircle2 size={12} /> Cuenta al día!
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 bg-accent/20 text-accent px-4 py-1.5 rounded-full text-[10px] font-black uppercase">
                            <AlertCircle size={12} /> Saldo Pendiente: BS {balance.toLocaleString()}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/20">
                    <div className="p-8 text-center sm:text-left">
                        <p className="text-[10px] font-bold text-sky uppercase tracking-widest mb-1">Total Deuda</p>
                        <p className="text-2xl font-black text-navy font-mono-numbers">BS {totalDebt.toLocaleString()}</p>
                    </div>
                    <div className="p-8 text-center sm:text-left">
                        <p className="text-[10px] font-bold text-sky uppercase tracking-widest mb-1">Total Pagado</p>
                        <p className="text-2xl font-black text-green-600 font-mono-numbers">BS {totalPaid.toLocaleString()}</p>
                    </div>
                    <div className="p-8 text-center sm:text-left bg-cream/30">
                        <p className="text-[10px] font-bold text-sky uppercase tracking-widest mb-1">Saldo Final</p>
                        <p className={`text-2xl font-black font-mono-numbers ${balance > 0 ? 'text-accent' : 'text-green-600'}`}>BS {balance.toLocaleString()}</p>
                    </div>
                </div>

                {/* Visual Balance Bar */}
                <div className="h-2 bg-background w-full">
                    <div
                        className={`h-full transition-all duration-1000 ${balance <= 0 ? 'bg-green-500' : 'bg-accent'}`}
                        style={{ width: `${Math.min(100, (totalPaid / (totalDebt || 1)) * 100)}%` }}
                    ></div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Desglose de Deuda */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                        <h5 className="text-[10px] font-black text-navy uppercase tracking-widest flex items-center gap-2">
                            <ArrowUpRight size={14} className="text-red-400" /> Desglose de Deuda
                        </h5>
                        <button className="text-[10px] font-bold text-sky hover:text-navy uppercase border border-sky/30 px-3 py-1 rounded-full transition-all flex items-center gap-1">
                            <Plus size={10} /> Ítem Extra
                        </button>
                    </div>

                    <div className="space-y-3">
                        {remitos.map(r => (
                            <div key={r.id} className="bg-white p-4 rounded-xl border border-border/40 shadow-sm flex justify-between items-center group hover:border-sky/40 transition-all">
                                <div className="flex items-center gap-4">
                                    <div className="bg-sky/5 p-2.5 rounded-xl text-sky group-hover:bg-navy group-hover:text-white transition-all">
                                        <FileText size={16} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-sky uppercase tracking-widest truncate max-w-[120px]">{r.nro}</p>
                                        <p className="text-xs font-bold text-navy">{r.pedido || 'Gasto operativo remito'}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-bold text-navy font-mono-numbers">BS {((num(r.smonto_envio) || 120) + (num(r.smonto_flete) || 50) + (num(r.smonto_pedido) || 300)).toLocaleString()}</p>
                                </div>
                            </div>
                        ))}
                        {extras.map(e => (
                            <div key={e.id} className="bg-cream/50 p-4 rounded-xl border border-yellow/20 shadow-sm flex justify-between items-center">
                                <div className="flex items-center gap-4">
                                    <div className="bg-yellow/10 p-2.5 rounded-xl text-yellow-600">
                                        <Tag size={16} />
                                    </div>
                                    <p className="text-xs font-bold text-navy uppercase">{e.label}</p>
                                </div>
                                <div className="text-right flex items-center gap-3">
                                    <span className="text-sm font-bold text-navy font-mono-numbers">BS {num(e.amount).toLocaleString()}</span>
                                    <button className="text-red-300 hover:text-red-600 transition-colors"><Trash2 size={14} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Historial de Pagos */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                        <h5 className="text-[10px] font-black text-navy uppercase tracking-widest flex items-center gap-2">
                            <ArrowDownLeft size={14} className="text-green-400" /> Registro de Pagos
                        </h5>
                        <button className="bg-green-600 text-white text-[10px] font-bold uppercase px-4 py-1.5 rounded-full hover:bg-green-700 shadow-lg shadow-green-600/20 transition-all flex items-center gap-1">
                            <Plus size={10} /> Nuevo Pago
                        </button>
                    </div>

                    <div className="space-y-3 max-h-[500px] overflow-y-auto px-1 custom-scrollbar">
                        {pagos.map(p => (
                            <div key={p.id} className="bg-white p-4 rounded-xl border border-border/40 shadow-sm flex justify-between items-center group hover:border-green-200 transition-all">
                                <div className="flex items-center gap-4">
                                    <div className="bg-green-50 p-2.5 rounded-xl text-green-500 group-hover:bg-green-500 group-hover:text-white transition-all">
                                        <DollarSign size={16} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-sky uppercase tracking-widest">{p.fecha}</p>
                                        <p className="text-xs font-bold text-navy uppercase">Abono recibido</p>
                                    </div>
                                </div>
                                <div className="text-right flex items-center gap-3">
                                    <span className="text-sm font-bold text-green-600 font-mono-numbers">BS {num(p.monto).toLocaleString()}</span>
                                    <button className="text-red-100 hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
                                </div>
                            </div>
                        ))}
                        {pagos.length === 0 && (
                            <div className="p-12 text-center border-2 border-dashed border-border/40 rounded-2xl">
                                <DollarSign size={32} className="mx-auto text-border mb-3" />
                                <p className="text-xs font-bold text-sky uppercase tracking-widest">Sin pagos registrados</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
