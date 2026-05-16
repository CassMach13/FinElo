
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

const Input: React.FC<InputProps> = ({ className = '', label, id, error, helpText, ...props }) => {
  // Estado de erro vs Estado normal
  const borderColor = error 
    ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20' 
    : 'border-slate-700 focus:border-cyan-500 focus:ring-cyan-500/20'; // Mudado para Ciano (Cyan)

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-400 mb-1 ml-1">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          className={`
            w-full 
            bg-slate-950/60 
            text-slate-100 
            placeholder-slate-500 
            rounded-xl 
            border ${borderColor}
            px-4 py-2.5 
            outline-none 
            transition-all duration-300
            hover:border-slate-600
            focus:bg-slate-950
            focus:ring-4 
            shadow-inner
            ${className}
          `}
          {...props}
        />
      </div>
      {helpText && !error && <p className="mt-1.5 ml-1 text-xs text-slate-400">{helpText}</p>}
      {error && <p className="mt-1.5 ml-1 text-xs text-red-400 font-medium animate-pulse">{error}</p>}
    </div>
  );
};

export default Input;
