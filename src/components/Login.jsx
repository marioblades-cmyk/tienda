import { useState } from 'react';
import { LogIn, UserPlus, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useAuth } from '../hooks/useAuth';
import { translateError } from '../services/errorTranslations';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(translateError(error));
        setLoading(false);
    };

    return (
        <div className="bg-surface p-8 rounded-xl w-full max-w-md border border-border shadow-md mx-auto">
            <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-text mb-2 tracking-tight">¡Hola de nuevo!</h2>
                <p className="text-muted text-sm font-medium opacity-80">Ingresa a tu panel de control</p>
            </div>

            {error && (
                <div className="bg-danger/10 text-danger border border-danger/20 p-3 rounded-lg mb-6 text-sm flex items-center gap-2">
                    <span className="font-bold">Error:</span> {error}
                </div>
            )}

            <form onSubmit={handleLogin} className="space-y-6">
                <div>
                    <label className="block text-sm font-medium text-muted-2 mb-1.5">Correo Electrónico</label>
                    <div className="relative">
                        <input
                            type="email"
                            placeholder="vendedor@gmail.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="input-field pl-10 h-12"
                            required
                        />
                        <Mail className="absolute left-3 top-3.5 w-5 h-5 text-muted" />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-muted-2 mb-1.5">Contraseña</label>
                    <div className="relative">
                        <input
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="input-field pl-10 h-12"
                            required
                        />
                        <Lock className="absolute left-3 top-3.5 w-5 h-5 text-muted" />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-3.5 text-muted hover:text-text transition-colors"
                        >
                            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full h-12 text-lg shadow-sm"
                >
                    {loading ? 'Ingresando...' : 'Entrar al Sistema'}
                </button>
            </form>

            <div className="mt-8 pt-6 border-t border-border text-center">
                <p className="text-sm text-muted">© 2024 Mangas Comics Bolivia Store</p>
            </div>
        </div>
    );
}
