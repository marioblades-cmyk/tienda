import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import {
    Plus,
    Trash2,
    Settings,
    CheckCircle2,
    AlertCircle,
    Home,
    Search,
    ChevronRight,
    Calendar,
    ArrowRight
} from 'lucide-react';

export default function RentView() {
    const [config, setConfig] = useState({ total_mes: 0, socio_mes: 0, mes_inicio: '' });
    const [meses, setMeses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showConfig, setShowConfig] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        const { data: cfg } = await supabase.from('alquiler_config').select('*').single();
        const { data: m } = await supabase.from('alquiler_meses').select('*').order('ym', { ascending: false });

        if (cfg) setConfig(cfg);
        setMeses(m || []);
        setLoading(false);
    };

    const ymLabel = (ym) => {
        if (!ym) return '';
        const [y, m] = ym.split('-');
        const nombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        return `${nombres[parseInt(m) - 1]} ${y}`;
    };

    const handleSaveConfig = async () => {
        await supabase.from('alquiler_config').upsert({ id: 1, ...config });
        setShowConfig(false);
        fetchData();
    };

    if (loading) return <div className="p-20 text-center text-sky animate-pulse font-bold tracking-widest uppercase">Gestionando Inmuebles...</div>;

    const hoy = new Date();
    const ymActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500">
            {/* Header / Config Toggle */}
            <div className="flex items-center justify-between">
                <div>
                    <h4 className="text-xl font-bold text-navy">Control de Alquiler</h4>
                    <p className="text-xs text-sky font-bold uppercase tracking-widest mt-1">Local & Socios</p>
                </div>
                <button
                    onClick={() => setShowConfig(!showConfig)}
                    className="flex items-center gap-2 bg-white border border-border/40 p-3 rounded-xl text-xs font-bold text-navy hover:text-accent hover:border-accent transition-all shadow-sm"
                >
                    <Settings size={18} /> {showConfig ? 'Cerrar Ajustes' : 'Configurar Tarifas'}
                </button>
            </div>

            {/* Config Panel */}
            {showConfig && (
                <div className="bg-[#f8f9fa] p-8 rounded-[2rem] border-2 border-dashed border-sky/30 grid grid-cols-1 md:grid-cols-4 gap-6 animate-in slide-in-from-top-4 duration-500">
                    <div>
                        <label className="text-[10px] font-black text-sky uppercase mb-2 block tracking-widest">Total Alquiler BS</label>
                        <input
                            type="number"
                            className="w-full bg-white border border-border/40 p-3 rounded-xl text-sm font-bold text-navy focus:ring-2 focus:ring-accent"
                            value={config.total_mes} onChange={e => setConfig({ ...config, total_mes: parseFloat(e.target.value) })}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-sky uppercase mb-2 block tracking-widest">Parte del Socio BS</label>
                        <input
                            type="number"
                            className="w-full bg-white border border-border/40 p-3 rounded-xl text-sm font-bold text-navy focus:ring-2 focus:ring-accent"
                            value={config.socio_mes} onChange={e => setConfig({ ...config, socio_mes: parseFloat(e.target.value) })}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-sky uppercase mb-2 block tracking-widest">Mes de Inicio</label>
                        <input
                            type="month"
                            className="w-full bg-white border border-border/40 p-3 rounded-xl text-sm font-bold text-navy focus:ring-2 focus:ring-accent"
                            value={config.mes_inicio} onChange={e => setConfig({ ...config, mes_inicio: e.target.value })}
                        />
                    </div>
                    <div className="flex items-end">
                        <button
                            onClick={handleSaveConfig}
                            className="w-full bg-navy text-white p-3 rounded-xl text-xs font-bold hover:bg-accent transition-all shadow-lg active:scale-95 uppercase tracking-widest"
                        >
                            Guardar Cambios
                        </button>
                    </div>
                </div>
            )}

            {/* KPI Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                    { label: 'Costo Local', value: `BS ${config.total_mes.toLocaleString()}`, color: 'border-navy' },
                    { label: 'Tu Parte', value: `BS ${(config.total_mes - config.socio_mes).toLocaleString()}`, color: 'border-green-500' },
                    { label: 'Parte Socio', value: `BS ${config.socio_mes.toLocaleString()}`, color: 'border-accent' },
                    { label: 'Meses Pendientes', value: meses.filter(m => !m.cargado).length, color: 'border-red-400' },
                ].map((stat, i) => (
                    <div key={i} className={`bg-white p-6 rounded-2xl border-l-4 ${stat.color} shadow-sm`}>
                        <p className="text-[10px] font-bold text-sky uppercase tracking-widest mb-1">{stat.label}</p>
                        <p className="text-xl font-bold font-mono-numbers text-navy">{stat.value}</p>
                    </div>
                ))}
            </div>

            {/* Meses Table */}
            <div className="bg-white rounded-3xl border border-border/40 shadow-xl shadow-navy/5 overflow-hidden">
                <div className="bg-navy p-4 text-white flex justify-between items-center">
                    <h5 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2 px-2">
                        <Calendar size={14} className="text-sky" /> Línea de Tiempo de Alquiler
                    </h5>
                    <button className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all">
                        <Plus size={14} /> Cargar Mes Manual
                    </button>
                </div>

                <table className="w-full border-collapse">
                    <thead className="bg-[#f8f9fa] text-[10px] font-black text-sky uppercase tracking-[0.2em]">
                        <tr className="border-b border-border/20">
                            <th className="p-6 text-left">Mes</th>
                            <th className="p-6 text-right">Total Local</th>
                            <th className="p-6 text-right">Socio (Dato)</th>
                            <th className="p-6 text-center">Estado CTA</th>
                            <th className="p-6 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                        {meses.map(m => {
                            const isVencido = m.ym < ymActual && !m.cargado;
                            return (
                                <tr key={m.id} className={`hover:bg-cream/20 transition-all ${m.cargado ? 'bg-green-50/20' : ''} ${isVencido ? 'bg-red-50/30' : ''}`}>
                                    <td className="p-6">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs ${m.cargado ? 'bg-green-100 text-green-700' : (isVencido ? 'bg-red-100 text-red-700' : 'bg-navy/5 text-navy')}`}>
                                                {m.ym.split('-')[1]}
                                            </div>
                                            <span className="text-sm font-black text-navy uppercase tracking-widest">{ymLabel(m.ym)}</span>
                                        </div>
                                    </td>
                                    <td className="p-6 text-right font-mono-numbers text-navy text-sm">BS {config.total_mes.toLocaleString()}</td>
                                    <td className="p-6 text-right font-mono-numbers text-accent font-bold text-sm">BS {config.socio_mes.toLocaleString()}</td>
                                    <td className="p-6 text-center">
                                        {m.cargado ? (
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 text-green-600 text-[10px] font-black uppercase">
                                                <CheckCircle2 size={12} /> {m.auto_cargado ? 'Auto · En Cuenta' : 'Socio Cargado'}
                                            </span>
                                        ) : (
                                            isVencido ? (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 text-red-600 text-[10px] font-black uppercase animate-pulse">
                                                    <AlertCircle size={12} /> Vencido
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-background text-muted text-[10px] font-black uppercase">
                                                    Próximo
                                                </span>
                                            )
                                        )}
                                    </td>
                                    <td className="p-6 text-right space-x-2">
                                        {!m.cargado && (
                                            <button className="bg-navy text-white text-[10px] font-black uppercase px-4 py-2 rounded-xl hover:bg-accent hover:scale-105 transition-all shadow-lg active:scale-95 flex items-center gap-2 ml-auto">
                                                Cargar a Cuenta <ArrowRight size={14} />
                                            </button>
                                        )}
                                        {m.cargado && (
                                            <button className="text-muted hover:text-red-500 transition-colors p-2"><Trash2 size={16} /></button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>

                {meses.length === 0 && (
                    <div className="p-20 text-center opacity-40">
                        <Home size={40} className="mx-auto text-sky mb-2" />
                        <p className="text-xs font-black uppercase tracking-widest text-navy">Sin historial de alquiler</p>
                    </div>
                )}
            </div>
        </div>
    );
}
