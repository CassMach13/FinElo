import React, { useState, useRef, useEffect } from 'react';

interface Option {
    label: string;
    value: string;
}

interface MultiSelectProps {
    label?: string;
    options: Option[];
    value: string[];
    onChange: (value: string[]) => void;
    placeholder?: string;
    className?: string;
}

const MultiSelect: React.FC<MultiSelectProps> = ({ label, options, value, onChange, placeholder = 'Selecione...', className }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleToggleOption = (optionValue: string) => {
        const newValue = value.includes(optionValue)
            ? value.filter(v => v !== optionValue)
            : [...value, optionValue];
        onChange(newValue);
    };

    const handleSelectAll = () => {
        if (value.length === options.length) {
            onChange([]); // Deselect all
        } else {
            onChange(options.map(o => o.value)); // Select all
        }
    };

    const displayText = value.length === 0
        ? placeholder
        : value.length === options.length
            ? 'Todas selecionadas'
            : `${value.length} selecionada(s)`;

    return (
        <div className={`relative ${className}`} ref={containerRef}>
            {label && <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>}

            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full bg-primary border border-slate-600 rounded-md px-3 py-2 text-left text-light focus:outline-none focus:ring-2 focus:ring-highlight focus:border-transparent flex justify-between items-center"
            >
                <span className="truncate">{displayText}</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute z-10 mt-1 w-full bg-slate-800 border border-slate-600 rounded-md shadow-lg max-h-60 overflow-auto">
                    <div className="p-2 border-b border-slate-700">
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-slate-700 p-1 rounded">
                            <input
                                type="checkbox"
                                checked={value.length === options.length && options.length > 0}
                                onChange={handleSelectAll}
                                className="form-checkbox h-4 w-4 text-highlight rounded border-gray-500 bg-primary focus:ring-highlight"
                            />
                            <span className="text-sm text-light font-medium">Selecionar Todas</span>
                        </label>
                    </div>
                    <div className="p-1">
                        {options.map((option) => (
                            <label key={option.value} className="flex items-center space-x-2 cursor-pointer hover:bg-slate-700 p-2 rounded">
                                <input
                                    type="checkbox"
                                    checked={value.includes(option.value)}
                                    onChange={() => handleToggleOption(option.value)}
                                    className="form-checkbox h-4 w-4 text-highlight rounded border-gray-500 bg-primary focus:ring-highlight"
                                />
                                <span className="text-sm text-light">{option.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MultiSelect;
