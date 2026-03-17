import React from 'react';

interface NavItemProps {
  view: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  badge?: number;
}

export const NavItem: React.FC<NavItemProps> = ({ view, label, icon, isActive, onClick, badge }) => (
  <button
    onClick={onClick}
    className={`relative flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 sm:gap-2 px-2 py-1.5 sm:px-3 sm:py-3 text-xs sm:text-sm font-medium rounded-lg transition-colors ${isActive ? 'bg-accent text-white' : 'text-gray-300 hover:bg-secondary hover:text-white'
      }`}
  >
    {icon}
    <span className="text-[10px] sm:text-xs lg:text-sm text-center leading-none mt-1 sm:mt-0 font-normal sm:font-medium block landscape:max-lg:hidden lg:block">{label}</span>
    {badge !== undefined && badge > 0 && (
      <span className="absolute top-1 right-1 lg:top-auto lg:right-3 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-lg animate-pulse">
        {badge}
      </span>
    )}
  </button>
);