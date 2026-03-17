import React from 'react';

interface SkeletonProps {
    className?: string;
    count?: number;
    width?: string | number;
    height?: string | number;
    circle?: boolean;
}

export const Skeleton: React.FC<SkeletonProps> = ({
    className = '',
    count = 1,
    width,
    height,
    circle = false,
}) => {
    const elements = Array.from({ length: count }, (_, i) => i);

    return (
        <>
            {elements.map((i) => (
                <div
                    key={i}
                    className={`animate-pulse bg-slate-700/50 ${circle ? 'rounded-full' : 'rounded-md'} ${className}`}
                    style={{ width, height }}
                />
            ))}
        </>
    );
};

export const SkeletonCard: React.FC = () => (
    <div className="bg-secondary p-4 rounded-xl shadow-md border border-slate-700/50 flex flex-col gap-3 relative overflow-hidden h-28 w-full">
        <div className="flex justify-between items-start pl-2">
            <div className="flex flex-col gap-2 w-1/2">
                <Skeleton height={20} className="w-full" />
                <Skeleton height={14} className="w-2/3" />
                <Skeleton height={14} className="w-1/2" />
            </div>
            <div className="flex flex-col items-end w-1/3 gap-2 shrink-0">
                <Skeleton height={24} className="w-full" />
                <Skeleton height={12} className="w-2/3" />
            </div>
        </div>
    </div>
);
