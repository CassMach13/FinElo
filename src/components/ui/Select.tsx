
import React from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
  label?: string;
  error?: string;
  helpText?: string;
}

const Select: React.FC<SelectProps> = ({ className, children, label, id, error, helpText, ...props }) => {
  const errorClasses = error ? 'border-danger focus:ring-danger' : 'border-slate-600 focus:ring-highlight';

  const selectElement = (
    <select
      id={id}
      className={`w-full bg-primary border rounded-md px-3 py-2 text-light placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent appearance-none ${errorClasses} ${className}`}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236B7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
        backgroundPosition: 'right 0.5rem center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '1.5em 1.5em',
        paddingRight: '2.5rem',
      }}
      {...props}
    >
      {children}
    </select>
  );

  return (
    label || helpText ? <div>
      {label && <label htmlFor={id} className="block text-sm font-medium text-gray-300 mb-1">{label}</label>}
      {selectElement}
      {helpText && <p className="mt-1 text-xs text-gray-400">{helpText}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div> : selectElement
  );
};

export default Select;
