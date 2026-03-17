import React, { useState, useEffect } from 'react';

interface AppLockProps {
    children: React.ReactNode;
}

export const AppLock: React.FC<AppLockProps> = ({ children }) => {
    const [isLocked, setIsLocked] = useState(false);
    const [pin, setPin] = useState('');
    const [error, setError] = useState(false);
    const [configuredPin, setConfiguredPin] = useState<string | null>(null);

    useEffect(() => {
        // Check if user has enabled App Lock in settings
        const savedPin = localStorage.getItem('finelo_app_pin');
        if (savedPin) {
            setConfiguredPin(savedPin);
            setIsLocked(true);
            // Attempt biometric unlock if available
            attemptBiometricUnlock();
        }
    }, []);

    const attemptBiometricUnlock = async () => {
        // Basic WebAuthn abstraction placeholder
        if (window.PublicKeyCredential && localStorage.getItem('finelo_biometric_enabled')) {
            try {
                // In a real scenario, you'd call navigator.credentials.get(...)
                // Since we are mocking the local hardware flow:
                console.log("Biometria detectada, mas fluxo completo requer backend/registro.");
            } catch (err) {
                console.error("Erro na biometria", err);
            }
        }
    };

    const handlePinSubmit = () => {
        if (pin === configuredPin) {
            setIsLocked(false);
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([30, 50, 30]);
        } else {
            setError(true);
            setPin('');
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([100, 50, 100]);
            setTimeout(() => setError(false), 500);
        }
    };

    const handleNumberClick = (num: string) => {
        if (pin.length < 4) {
            const newPin = pin + num;
            setPin(newPin);
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);

            if (newPin.length === 4) {
                // Auto submit when 4 digits are entered
                setTimeout(() => {
                    if (newPin === configuredPin) {
                        setIsLocked(false);
                        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([30, 50, 30]);
                    } else {
                        setError(true);
                        setPin('');
                        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([100, 50, 100]);
                        setTimeout(() => setError(false), 500);
                    }
                }, 100);
            }
        }
    };

    if (!isLocked) {
        return <>{children}</>;
    }

    return (
        <div className="fixed inset-0 bg-primary z-[9999] flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-900 to-primary">
            <div className="absolute top-1/4 flex flex-col items-center">
                <div className="w-16 h-16 bg-highlight/10 rounded-full flex items-center justify-center mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-highlight" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">FinElo Bloqueado</h1>
                <p className="text-gray-400 text-sm mb-8 text-center">Insira seu PIN de 4 dígitos para acessar suas finanças.</p>

                {/* PIN Indicators */}
                <div className={`flex gap-4 mb-12 ${error ? 'animate-bounce text-danger' : ''}`}>
                    {[...Array(4)].map((_, i) => (
                        <div
                            key={i}
                            className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${i < pin.length
                                    ? error ? 'bg-danger border-danger' : 'bg-highlight border-highlight shadow-[0_0_10px_rgba(56,189,248,0.5)]'
                                    : 'border-slate-600 bg-transparent'
                                }`}
                        />
                    ))}
                </div>
            </div>

            {/* Numpad */}
            <div className="absolute bottom-10 w-full max-w-xs grid grid-cols-3 gap-y-6 gap-x-4">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <button
                        key={num}
                        onClick={() => handleNumberClick(num.toString())}
                        className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center text-3xl font-medium text-white mx-auto active:bg-slate-700 active:scale-95 transition-all"
                    >
                        {num}
                    </button>
                ))}
                <div /> {/* Empy slot for grid alignment */}
                <button
                    onClick={() => handleNumberClick('0')}
                    className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center text-3xl font-medium text-white mx-auto active:bg-slate-700 active:scale-95 transition-all"
                >
                    0
                </button>
                <button
                    onClick={() => {
                        setPin(pin.slice(0, -1));
                        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10);
                    }}
                    className="w-16 h-16 rounded-full flex items-center justify-center text-white mx-auto active:bg-slate-800/50 active:scale-95 transition-all"
                    disabled={pin.length === 0}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
                    </svg>
                </button>
            </div>
        </div>
    );
};
