import { useEffect, useState, createContext, useContext } from 'react';
import { supabase } from '../services/supabase';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Fallback de seguridad: Si pasan 5 segundos y Supabase no responde, quitamos el loading.
        const timeoutId = setTimeout(() => {
            if (loading) {
                console.warn("Tiempo de espera de Supabase agotado. Forzando salida de pantalla de carga.");
                setLoading(false);
            }
        }, 5000);

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
            if (session?.user) fetchProfile(session.user.id);
            else setLoading(false);
        }).catch(err => {
            console.error("Error crítico de Supabase al arrancar:", err);
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
            if (session?.user) fetchProfile(session.user.id);
            else {
                setProfile(null);
                setLoading(false);
            }
        });

        return () => {
            subscription.unsubscribe();
            clearTimeout(timeoutId);
        };
    }, []);

    const fetchProfile = async (id) => {
        try {
            const { data, error } = await supabase
                .from('vendedores')
                .select('*')
                .eq('id', id)
                .maybeSingle();

            if (error) console.error('Error fetching profile:', error);
            else setProfile(data);
        } finally {
            setLoading(false);
        }
    };

    const isAdmin = profile?.email === 'admin@gmail.com' || 
                    profile?.email === 'testadmin@mangascomics.bo' || 
                    profile?.email === 'admin-tester@example.com' ||
                    profile?.nombre === 'Admin Tester' ||
                    profile?.is_admin === true;
    const isSocio = profile?.is_socio === true;

    return (
        <AuthContext.Provider value={{ user, profile, loading, isAdmin, isSocio }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
