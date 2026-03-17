import React from 'react';
import { startTour } from '../services/tourService';
import { LightBulbIcon } from './ui/icons'; // Using LightBulb as a generic icon or replace with specific tutorial icon

interface TourButtonProps {
    className?: string;
    currentView: string;
}

export const TourButton: React.FC<TourButtonProps> = ({ className, currentView }) => {
    const handleStartTour = () => {
        startTour(currentView, () => {
            console.log('Tour completed');
        });
    };

    return (
        <button
            onClick={handleStartTour}
            className={`no-print flex items-center gap-2 px-4 py-2 text-sm font-medium text-light bg-accent/20 hover:bg-accent/30 rounded-lg transition-colors border border-accent/50 ${className}`}
        >
            <LightBulbIcon className="w-5 h-5 text-accent" />
            <span>Iniciar Tutorial</span>
        </button>
    );
};
