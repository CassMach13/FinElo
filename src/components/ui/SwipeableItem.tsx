import React, { useRef, useState, useEffect } from 'react';

interface SwipeAction {
    label: string;
    icon?: React.ReactNode;
    colorClass: string;
    onClick: () => void;
}

interface SwipeableItemProps {
    children: React.ReactNode;
    leftActions?: SwipeAction[];
    rightActions?: SwipeAction[];
    className?: string;
    threshold?: number;
}

export const SwipeableItem: React.FC<SwipeableItemProps> = ({
    children,
    leftActions = [],
    rightActions = [],
    className = '',
    threshold = 80 // pixels to swipe before snap
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [startX, setStartX] = useState<number | null>(null);
    const [currentX, setCurrentX] = useState<number>(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const [isOpen, setIsOpen] = useState<'left' | 'right' | null>(null);

    // Maximum swipe distance based on number of actions (approx 80px per action)
    const maxLeftSwipe = leftActions.length * 80;
    const maxRightSwipe = rightActions.length * 80;

    const handleTouchStart = (e: React.TouchEvent) => {
        // Only handle horizontal swipes
        setStartX(e.touches[0].clientX);
        setIsSwiping(true);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!startX || !isSwiping) return;

        const diffX = e.touches[0].clientX - startX;

        // Prevent vertical scrolling while swiping horizontally if intent is clear
        if (Math.abs(diffX) > 10) {
            // Optional: e.preventDefault() if non-passive listener
        }

        // Apply limits and resistance
        let newX = isOpen === 'left' ? diffX + maxLeftSwipe : isOpen === 'right' ? diffX - maxRightSwipe : diffX;

        if (newX > 0 && leftActions.length === 0) newX = 0;
        if (newX < 0 && rightActions.length === 0) newX = 0;

        // Resistance beyond max bounds
        if (newX > maxLeftSwipe) newX = maxLeftSwipe + (newX - maxLeftSwipe) * 0.2;
        if (newX < -maxRightSwipe) newX = -maxRightSwipe + (newX + maxRightSwipe) * 0.2;

        setCurrentX(newX);
    };

    const handleTouchEnd = () => {
        if (!isSwiping) return;
        setIsSwiping(false);
        setStartX(null);

        // Snap logic
        if (currentX > threshold && leftActions.length > 0) {
            setIsOpen('left');
            setCurrentX(maxLeftSwipe);
            triggerHaptic();
        } else if (currentX < -threshold && rightActions.length > 0) {
            setIsOpen('right');
            setCurrentX(-maxRightSwipe);
            triggerHaptic();
        } else {
            setIsOpen(null);
            setCurrentX(0);
        }
    };

    const triggerHaptic = () => {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(10); // Light haptic feedback
        }
    };

    // Close swipe when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (isOpen && containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(null);
                setCurrentX(0);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isOpen]);

    const swipeTransform = `translateX(${currentX}px)`;
    const transitionClass = isSwiping ? '' : 'transition-transform duration-300 ease-out';

    return (
        <div className={`relative overflow-hidden w-full ${className}`} ref={containerRef}>
            {/* Background Actions Layer */}
            <div className="absolute inset-0 flex justify-between select-none z-0">
                {/* Left Actions (revealed when swiping right) */}
                <div className="flex h-full">
                    {leftActions.map((action, i) => (
                        <button
                            key={i}
                            onClick={(e) => {
                                e.stopPropagation();
                                action.onClick();
                                setIsOpen(null);
                                setCurrentX(0);
                            }}
                            className={`flex flex-col items-center justify-center w-[80px] h-full ${action.colorClass} text-white transition-opacity`}
                            style={{ opacity: currentX > 0 ? 1 : 0, transitionDelay: `${i * 50}ms` }}
                        >
                            {action.icon && <div className="mb-1">{action.icon}</div>}
                            <span className="text-[10px] font-bold uppercase">{action.label}</span>
                        </button>
                    ))}
                </div>

                {/* Right Actions (revealed when swiping left) */}
                <div className="flex h-full">
                    {rightActions.map((action, i) => (
                        <button
                            key={i}
                            onClick={(e) => {
                                e.stopPropagation();
                                action.onClick();
                                setIsOpen(null);
                                setCurrentX(0);
                            }}
                            className={`flex flex-col items-center justify-center w-[80px] h-full ${action.colorClass} text-white transition-opacity`}
                            style={{ opacity: currentX < 0 ? 1 : 0, transitionDelay: `${i * 50}ms` }}
                        >
                            {action.icon && <div className="mb-1">{action.icon}</div>}
                            <span className="text-[10px] font-bold uppercase">{action.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Foreground Content Layer */}
            <div
                ref={contentRef}
                className={`w-full relative z-10 bg-transparent ${transitionClass} group`}
                style={{ transform: swipeTransform }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {/* Left Action Hint Placeholder (if needed later) */}
                {leftActions.length > 0 && currentX === 0 && (
                    <div className="absolute top-1/2 -translate-y-1/2 left-2 opacity-30 pointer-events-none z-20 animate-[pulse_2s_ease-in-out_infinite]">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                )}

                {/* Right Action Hint (Pull Left) */}
                {rightActions.length > 0 && currentX === 0 && (
                    <div className="absolute top-1/2 -translate-y-1/2 right-2 opacity-30 pointer-events-none z-20 animate-[pulse_2s_ease-in-out_infinite]">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
                        </svg>
                    </div>
                )}

                {children}
            </div>
        </div>
    );
};
