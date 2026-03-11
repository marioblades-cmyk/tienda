import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

export function useCatalogStatus() {
    const [hasPendingChanges, setHasPendingChanges] = useState(false);
    const [latestWeek, setLatestWeek] = useState(null);
    const [loading, setLoading] = useState(true);

    const checkStatus = async () => {
        setLoading(true);
        try {
            // 1. Obtener la semana más reciente con archivo
            const { data: weeks, error: weekError } = await supabase
                .from('semanas')
                .select('*')
                .not('archivo_url', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1);

            if (weekError) throw weekError;
            if (!weeks || weeks.length === 0) {
                setHasPendingChanges(false);
                setLoading(false);
                return;
            }

            const currentWeek = weeks[0];
            setLatestWeek(currentWeek);

            // 2. Buscar si hay algún log de sincronización para este archivo exacto
            const { data: logs, error: logError } = await supabase
                .from('catalogo_sync_logs')
                .select('*')
                .eq('filename', currentWeek.archivo_nombre)
                .order('created_at', { ascending: false })
                .limit(1);

            if (logError) throw logError;

            // 3. Decidir si está pendiente
            // Si no hay log, o si el log es más antiguo que la semana (por si se re-subió el archivo)
            if (!logs || logs.length === 0) {
                setHasPendingChanges(true);
            } else {
                // Heurística: Si la semana se creó/actualizó después del último log exitoso
                const lastSync = new Date(logs[0].created_at);
                const weekUpdated = new Date(currentWeek.created_at); // Idealmente tendríamos updated_at
                
                // Si el log es más viejo que la carga del archivo, consideramos que hay cambios
                // (Sumamos un pequeño margen por latencias de red)
                setHasPendingChanges(lastSync.getTime() < weekUpdated.getTime());
            }
        } catch (err) {
            console.error('Error checking catalog status:', err);
            setHasPendingChanges(false);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        checkStatus();

        // Escuchar eventos personalizados para refrescar
        const handleRefresh = () => checkStatus();
        window.addEventListener('catalog-status-changed', handleRefresh);
        window.addEventListener('week-file-uploaded', handleRefresh);

        return () => {
            window.removeEventListener('catalog-status-changed', handleRefresh);
            window.removeEventListener('week-file-uploaded', handleRefresh);
        };
    }, []);

    return { hasPendingChanges, latestWeek, loading, refresh: checkStatus };
}
