
import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  title?: string;
}

const Card: React.FC<CardProps> = ({ children, className = '', title, ...props }) => {
  return (
    <div className={`
      relative overflow-hidden
      bg-secondary/30 backdrop-blur-md 
      border border-white/5 
      rounded-2xl shadow-xl 
      hover:border-white/10 transition-colors duration-300
      p-4 sm:p-6
      ${className}
    `} {...props}>
      {/* Subtle shine effect */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-50" />

      {title && (
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
        </div>
      )}
      {children}
    </div>
  );
};

export default Card;
