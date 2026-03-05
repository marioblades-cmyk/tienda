import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from '../hooks/useAuth';
import { readExcelRaw } from '../services/excelProcessor';
import { Download, Upload, CheckCircle, Clock, AlertCircle, FileText } from 'lucide-react';
import { translateError } from '../services/errorTranslations';
import AdminConsolidatedView from './AdminConsolidatedView';

export default function SellerDashboard() {
    const { user, profile } = useAuth();
    const [semanaActual, setSemanaActual] = useState(null);
    const [pedidosRealizados, setPedidosRealizados] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [isDragging, setIsDragging] = useState({ personal: false, tienda: false });

    useEffect(() => {
        fetchSemanaYPedidos();
    }, []);

    const fetchSemanaYPedidos = async () => {
        setLoading(true);
        try {
            const { data: semanadata, error: semanaError } = await supabase
                .from('semanas')
                .select('*')
                .eq('abierta', true)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (semanaError) console.error('Error fetching week:', semanaError);
            setSemanaActual(semanadata);

            if (semanadata && user) {
                const { data: pedidosdata, error: pedidosError } = await supabase
                    .from('pedidos')
                    .select('*')
                    .eq('semana_id', semanadata.id)
                    .eq('vendedor_id', user.id);

                if (pedidosError) console.error('Error fetching orders:', pedidosError);
                setPedidosRealizados(pedidosdata || []);
            }
        } catch (err) {
            console.error('Crash in fetchSemanaYPedidos:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async () => {
        if (!semanaActual?.archivo_url) return;
        try {
            const response = await fetch(semanaActual.archivo_url);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const nombreVendedor = (profile?.nombre || user?.user_metadata?.nombre || 'Vendedor').split(' ')[0];
            let fecha = semanaActual.nombre || 'Semana';
            fecha = fecha.replace(/ENTELEQUIA DISTRIBUCIÓN/i, '').trim().replace(/\//g, '-');

            a.download = `Entelequia_Distribución_${fecha}_${nombreVendedor}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error descargando:', error);
            alert('Error: ' + translateError(error));
        }
    };

    const handleUpload = async (file, tipo) => {
        if (!semanaActual || !user) return;
        if (!file.name.match(/\.(xlsx|xls)$/)) {
            alert('Por favor, sube un archivo Excel válido (.xlsx o .xls)');
            return;
        }
        setUploading(true);

        try {
            const items = await readExcelRaw(file);
            if (items.length === 0) {
                alert('El archivo no contiene items con cantidades > 0 o el formato es incorrecto.');
                setUploading(false);
                return;
            }

            const { data: pedido, error: pedidoError } = await supabase
                .from('pedidos')
                .upsert({
                    semana_id: semanaActual.id,
                    vendedor_id: user.id,
                    vendedor_nombre: profile.nombre || user.user_metadata?.nombre,
                    archivo_nombre: file.name,
                    tipo: tipo
                }, { onConflict: 'semana_id, vendedor_id, tipo' })
                .select()
                .single();

            if (pedidoError) throw pedidoError;

            await supabase.from('pedido_items').delete().eq('pedido_id', pedido.id);

            const { error: itemsError } = await supabase
                .from('pedido_items')
                .insert(items.map(i => ({ ...i, pedido_id: pedido.id })));

            if (itemsError) throw itemsError;

            alert(`Pedido de tipo ${tipo.toUpperCase()} cargado con éxito (${items.length} items).`);
            fetchSemanaYPedidos();
        } catch (err) {
            console.error(err);
            alert('Error: ' + translateError(err));
        } finally {
            setUploading(false);
        }
    };

    const onDragOver = (e, tipo) => {
        e.preventDefault();
        setIsDragging(prev => ({ ...prev, [tipo]: true }));
    };

    const onDragLeave = (tipo) => {
        setIsDragging(prev => ({ ...prev, [tipo]: false }));
    };

    const onDrop = (e, tipo) => {
        e.preventDefault();
        setIsDragging(prev => ({ ...prev, [tipo]: false }));
        const file = e.dataTransfer.files[0];
        if (file) handleUpload(file, tipo);
    };

    if (loading) return <div className="py-12 flex justify-center"><div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin"></div></div>;

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {!semanaActual ? (
                <div className="glass p-12 text-center rounded-2xl border-dashed border-2">
                    <Clock size={48} className="mx-auto text-muted mb-4 opacity-20" />
                    <h2 className="text-xl font-bold mb-2 text-muted">No hay semanas abiertas</h2>
                    <p className="text-xs font-mono text-muted/60 max-w-sm mx-auto">
                        El administrador aún no ha abierto la recepción de pedidos para esta semana.
                    </p>
                </div>
            ) : (
                <div className="space-y-8">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-1 space-y-6">
                            <div className="glass p-6 rounded-2xl bg-accent/5 border-accent/20">
                                <h3 className="text-xs font-mono text-accent uppercase tracking-widest mb-4">Semana en curso</h3>
                                <h2 className="text-2xl font-bold mb-2">{semanaActual.nombre}</h2>
                                <p className="text-xs font-mono text-muted mb-6">Estado: ABIERTA PARA CARGA</p>

                                {semanaActual.archivo_url ? (
                                    <button
                                        onClick={handleDownload}
                                        className="flex items-center justify-center gap-3 w-full bg-accent text-black font-bold py-3 rounded hover:bg-accent/90 transition-colors"
                                    >
                                        <Download size={18} /> DESCARGAR EXCEL BASE
                                    </button>
                                ) : (
                                    <div className="bg-warning/10 text-warning p-4 rounded text-xs font-mono flex items-start gap-3">
                                        <AlertCircle size={16} className="shrink-0" />
                                        <span>El admin aún no ha subido el Excel base para esta semana.</span>
                                    </div>
                                )}
                            </div>

                            <div className="glass p-6 rounded-2xl">
                                <h3 className="text-xs font-mono text-muted uppercase tracking-widest mb-4">Estado de envío</h3>
                                <div className="space-y-4">
                                    {['personal', 'tienda'].map(tipo => {
                                        const pedido = pedidosRealizados.find(p => p.tipo === tipo);
                                        return (
                                            <div key={tipo} className="flex items-center justify-between p-3 border border-border rounded-lg bg-background/50">
                                                <div>
                                                    <span className="text-xs font-mono text-muted uppercase tracking-tighter block mb-1">TIPO: {tipo}</span>
                                                    <span className="text-xs font-bold">{pedido ? 'ENVIADO' : 'PENDIENTE'}</span>
                                                </div>
                                                {pedido ? <CheckCircle size={20} className="text-success" /> : <Clock size={20} className="text-muted" />}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="lg:col-span-2 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {['personal', 'tienda'].map(tipo => (
                                    <div
                                        key={tipo}
                                        onDragOver={(e) => onDragOver(e, tipo)}
                                        onDragLeave={() => onDragLeave(tipo)}
                                        onDrop={(e) => onDrop(e, tipo)}
                                        className={`glass p-8 rounded-2xl border-2 border-dashed transition-all group relative overflow-hidden ${isDragging[tipo] ? 'border-accent bg-accent/5 scale-[1.02]' : 'border-border hover:border-accent'
                                            }`}
                                    >
                                        {uploading && <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10"><div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin"></div></div>}

                                        <div className="relative z-0">
                                            <div className="text-3xl mb-4 group-hover:scale-110 transition-transform">
                                                {tipo === 'personal' ? '👤' : '🏪'}
                                            </div>
                                            <h3 className="text-xl font-bold mb-1 uppercase tracking-tight">
                                                PEDIDO {tipo === 'personal' ? 'MI PEDIDO' : 'DE TIENDA'}
                                            </h3>
                                            <p className="text-xs font-mono text-muted mb-6">
                                                {tipo === 'personal' ? 'Tus unidades para clientes.' : 'Unidades para stock de tienda Física.'}
                                            </p>

                                            <label className="flex items-center justify-center gap-3 w-full bg-surface border border-border group-hover:border-accent group-hover:text-accent font-bold py-3 rounded cursor-pointer transition-all">
                                                <Upload size={18} />
                                                SUBIR O ARRASTRAR EXCEL
                                                <input
                                                    type="file"
                                                    className="hidden"
                                                    accept=".xlsx,.xls"
                                                    onChange={(e) => e.target.files[0] && handleUpload(e.target.files[0], tipo)}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="glass p-6 rounded-2xl text-center">
                                <h3 className="text-xs font-mono text-muted uppercase tracking-widest mb-2 italic">Instrucciones de carga</h3>
                                <p className="text-xs font-mono text-muted/60 leading-relaxed max-w-md mx-auto">
                                    Puedes seleccionar el archivo o simplemente **arrastrarlo** sobre las zonas punteadas de arriba.
                                    Solo items con cantidades &gt; 0 serán procesados.
                                </p>
                            </div>
                        </div>
                    </div>

                    <section className="pt-8 border-t border-border">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center text-accent">
                                <FileText size={18} />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold">Resumen de mi Carga</h3>
                                <p className="text-xs font-mono text-muted">Vista previa de lo que has enviado esta semana</p>
                            </div>
                        </div>

                        <div className="glass rounded-2xl p-6">
                            <AdminConsolidatedView sellerIdFilter={user?.id} />
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
