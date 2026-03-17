
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  children: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', className = '', ...props }) => {
  const baseClasses = 'inline-flex items-center justify-center px-6 py-3.5 rounded-xl font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0f172a]';
  
  const variants = {
    // Degradê Ciano para Azul (Estilo Tech Finance)
    primary: 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 border-0 tracking-wide',
    
    // Secundário mais sóbrio (Cinza escuro, não branco)
    secondary: 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700 shadow-sm hover:text-white',
    
    outline: 'bg-transparent border border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-slate-600 hover:text-white',
    ghost: 'bg-transparent text-slate-400 hover:text-white hover:bg-white/5',
  };

  return (
    <button className={`${baseClasses} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

export default Button;
