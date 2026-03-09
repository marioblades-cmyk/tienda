import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { User, Mail, Calendar, Package, Edit2, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { translateError } from '../services/errorTranslations';

export default function AdminUserManagement() {
    const [vendedores, setVendedores] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [newName, setNewName] = useState('');

    useEffect(() => {
        fetchVendedores();
    }, []);

    const fetchVendedores = async () => {
        setLoading(true);
        // We join with orders to count them
        const { data, error } = await supabase
            .from('vendedores')
            .select(`
                *,
                pedidos:pedidos(count)
            `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error(error);
            alert('Error: ' + translateError(error));
        } else {
            // Map the count from the nested relation
            const formatted = data.map(v => ({
                ...v,
                pedidosCount: v.pedidos?.[0]?.count || 0
            }));
            setVendedores(formatted);
        }
        setLoading(false);
    };

    const toggleActive = async (id, currentStatus) => {
        const { error } = await supabase
            .from('vendedores')
            .update({ active: !currentStatus })
            .eq('id', id);

        if (error) alert(translateError(error));
        else fetchVendedores();
    };

    const toggleSocio = async (id, currentStatus) => {
        const { error } = await supabase
            .from('vendedores')
            .update({ is_socio: !currentStatus })
            .eq('id', id);

        if (error) alert(translateError(error));
        else fetchVendedores();
    };

    const deleteVendedor = async (v) => {
        if (!window.confirm(`¿Estás seguro de que deseas eliminar permanentemente a ${v.nombre}? Esta acción no se puede deshacer.`)) return;

        const { error } = await supabase
            .from('vendedores')
            .delete()
            .eq('id', v.id);

        if (error) alert(translateError(error));
        else fetchVendedores();
    };

    const updateNombre = async (id) => {
        if (!newName.trim()) return;
        const { error } = await supabase
            .from('vendedores')
            .update({ nombre: newName.trim() })
            .eq('id', id);

        if (error) alert(translateError(error));
        else {
            setEditingId(null);
            setNewName('');
            fetchVendedores();
        }
    };

    if (loading) return <div className="py-12 flex justify-center"><div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin"></div></div>;

    return (
        <div className="space-y-6">
            <div className="glass rounded-2xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                        <tr className="bg-background/50 border-b border-border">
                            <th className="p-4 font-bold text-muted uppercase tracking-widest">Vendedor</th>
                            <th className="p-4 font-bold text-muted uppercase tracking-widest">Contacto</th>
                            <th className="p-4 font-bold text-muted uppercase tracking-widest text-center">Pedidos</th>
                            <th className="p-4 font-bold text-muted uppercase tracking-widest text-center">Estado</th>
                            <th className="p-4 font-bold text-muted uppercase tracking-widest text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {vendedores.map((v) => (
                            <tr key={v.id} className="hover:bg-accent/5 transition-colors">
                                <td className="p-4">
                                    {editingId === v.id ? (
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={newName}
                                                onChange={(e) => setNewName(e.target.value)}
                                                className="bg-background border border-accent p-1 rounded text-xs outline-none w-40"
                                                autoFocus
                                            />
                                            <button onClick={() => updateNombre(v.id)} className="text-success hover:scale-110"><CheckCircle size={16} /></button>
                                            <button onClick={() => setEditingId(null)} className="text-error hover:scale-110"><XCircle size={16} /></button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-[10px] ${v.active ? 'bg-accent/20 text-accent' : 'bg-muted/20 text-muted'}`}>
                                                {v.nombre?.[0] || '?'}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className={`font-display text-xl tracking-wide uppercase ${v.active ? 'text-text' : 'text-muted line-through'}`}>{v.nombre}</p>
                                                    {v.is_socio && (
                                                        <span className="bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5 rounded border border-primary/20">SOCIO</span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-muted flex items-center gap-1 font-medium mt-1">
                                                    <Calendar size={12} className="text-primary" /> {new Date(v.created_at).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </td>
                                <td className="p-4">
                                    <div className="flex flex-col gap-1">
                                        <span className="flex items-center gap-2 text-text font-medium text-sm">
                                            <Mail size={14} className="text-primary" /> {v.email}
                                        </span>
                                    </div>
                                </td>
                                <td className="p-4 text-center">
                                    <span className="bg-surface border border-border px-2 py-1 rounded-full text-[10px] flex items-center gap-1 justify-center w-max mx-auto">
                                        <Package size={10} /> {v.pedidosCount}
                                    </span>
                                </td>
                                <td className="p-4 text-center">
                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${v.active ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
                                        {v.active ? 'ACTIVO' : 'INACTIVO'}
                                    </span>
                                </td>
                                <td className="p-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            onClick={() => { setEditingId(v.id); setNewName(v.nombre); }}
                                            className="p-2 text-muted hover:text-accent transition-colors"
                                            title="Editar nombre"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => toggleActive(v.id, v.active)}
                                            className={`p-2 transition-colors ${v.active ? 'text-muted hover:text-error' : 'text-muted hover:text-success'}`}
                                            title={v.active ? 'Desactivar usuario' : 'Activar usuario'}
                                        >
                                            {v.active ? <XCircle size={16} /> : <CheckCircle size={16} />}
                                        </button>
                                        <button
                                            onClick={() => toggleSocio(v.id, v.is_socio)}
                                            className={`p-2 transition-colors ${v.is_socio ? 'text-primary hover:text-muted' : 'text-muted hover:text-primary'}`}
                                            title={v.is_socio ? 'Quitar rol de Socio' : 'Hacer Socio'}
                                        >
                                            <User size={16} className={v.is_socio ? "fill-primary/20" : ""} />
                                        </button>
                                        <button
                                            onClick={() => deleteVendedor(v)}
                                            className="p-2 text-muted hover:text-error transition-colors"
                                            title="Eliminar usuario"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {vendedores.length === 0 && (
                    <div className="p-12 text-center text-muted italic">
                        No hay vendedores registrados.
                    </div>
                )}
            </div>
        </div>
    );
}
