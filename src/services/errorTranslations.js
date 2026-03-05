export const translateError = (error) => {
    if (!error) return null;
    const msg = (typeof error === 'string' ? error : error.message) || '';
    const lower = msg.toLowerCase();

    if (lower.includes('invalid login credentials')) return 'Email o contraseña incorrectos.';
    if (lower.includes('user already registered')) return 'Este email ya está registrado.';
    if (lower.includes('password should be at least 6 characters')) return 'La contraseña debe tener al menos 6 caracteres.';
    if (lower.includes('row-level security policy')) return 'No tienes permisos para realizar esta acción (Error de política RLS).';
    if (lower.includes('network error')) return 'Error de conexión. Revisa tu internet.';
    if (lower.includes('email not confirmed')) return 'Debes confirmar tu email antes de ingresar.';
    if (lower.includes('email rate limit exceeded')) return 'Has intentado registrarte demasiadas veces. Por favor, espera unos minutos e intenta de nuevo.';

    return msg;
};
