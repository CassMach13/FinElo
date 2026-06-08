import React from 'react';
import Card from './Card';
import { InformationCircleIcon } from './icons';

export interface SummaryCardComparison {
    periodLabel: string;
    value: string;
    deltaLabel: string;
    deltaTone?: 'positive' | 'negative' | 'neutral';
}

interface SummaryCardProps {
    title: string;
    value: string;
    subValue?: string;
    icon?: React.ReactNode;
    variant?: 'default' | 'accent' | 'danger' | 'success' | 'warning';
    className?: string;
    tooltip?: string;
    compare?: SummaryCardComparison;
}

const SummaryCard: React.FC<SummaryCardProps> = ({
    title,
    value,
    subValue,
    icon,
    variant = 'default',
    className = '',
    tooltip,
    compare,
}) => {
    const getVariantColor = () => {
        switch (variant) {
            case 'accent': return 'text-accent';
            case 'danger': return 'text-danger';
            case 'success': return 'text-green-500';
            case 'warning': return 'text-yellow-500';
            default: return 'text-light';
        }
    };

    const getDeltaToneColor = () => {
        if (!compare?.deltaTone || compare.deltaTone === 'neutral') return 'text-gray-500';
        if (compare.deltaTone === 'positive') return 'text-accent';
        return 'text-danger';
    };

    return (
        <Card className={`flex flex-col justify-between h-full min-h-[140px] group !overflow-visible hover:bg-secondary/40 transition-all duration-300 ${className}`}>
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                    <h3 className="text-gray-400 text-[10px] font-bold uppercase tracking-widest opacity-80 group-hover:opacity-100 transition-opacity">{title}</h3>
                    {tooltip && (
                        <div className="group/tooltip relative">
                            <InformationCircleIcon className="h-3.5 w-3.5 text-gray-600 hover:text-gray-300 cursor-help transition-colors" />
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden w-48 p-3 bg-slate-950/98 backdrop-blur-2xl text-[10px] leading-relaxed text-gray-300 rounded-xl shadow-2xl border border-white/10 group-hover/tooltip:block z-[9999] pointer-events-none">
                                {tooltip}
                                <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-white/10"></div>
                            </div>
                        </div>
                    )}
                </div>
                {icon && (
                    <div className={`
                        p-2.5 rounded-xl 
                        bg-gradient-to-br from-white/5 to-white/10 
                        border border-white/5 
                        shadow-inner
                        group-hover:scale-110 group-hover:shadow-lg transition-all duration-500
                        ${getVariantColor()}
                    `}>
                        {React.cloneElement(icon as React.ReactElement, { className: "w-4 h-4" })}
                    </div>
                )}
            </div>

            <div className="mt-auto pt-4">
                <div className={`
                    font-bold tracking-tight 
                    group-hover:scale-[1.02] 
                    origin-left transition-transform duration-300 
                    whitespace-nowrap 
                    ${value.length > 15 ? 'text-lg' : value.length > 12 ? 'text-xl' : 'text-2xl'}
                    ${getVariantColor()}
                `}>
                    {value}
                </div>
                <div className="min-h-[1.25rem] h-auto flex items-center pb-1">
                    {subValue ? (
                        <div className="text-[10px] font-medium text-gray-500 mt-1 whitespace-normal">
                            {subValue}
                        </div>
                    ) : (
                        <div className="text-[10px] invisible mt-1">spacer</div>
                    )}
                </div>
                {compare && (
                    <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[10px]">
                        <span className="text-gray-500">
                            vs <span className="font-semibold text-gray-400">{compare.periodLabel}</span>:{' '}
                            <span className="text-gray-300">{compare.value}</span>
                        </span>
                        <span className={`font-semibold ${getDeltaToneColor()}`}>
                            {compare.deltaLabel}
                        </span>
                    </div>
                )}
            </div>
        </Card>
    );
};

export default SummaryCard;
