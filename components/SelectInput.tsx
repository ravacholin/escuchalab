import React from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectInputProps {
    label: string;
    value: string;
    options: string[] | { label: string; value: string }[];
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    highlight?: boolean;
    extraAction?: React.ReactNode;
    subLabel?: string;
}

const SelectInput: React.FC<SelectInputProps> = ({ label, value, options, onChange, highlight, extraAction, subLabel }) => (
    <div className="group">
        <div className="flex justify-between items-center mb-2">
            <label className={`block text-xs font-medium tracking-tight ${highlight ? 'text-fg' : 'text-muted'}`}>
                {label}
            </label>
            {extraAction}
        </div>
        <div className="relative">
            <select
                className={`w-full appearance-none cursor-pointer rounded-xl border bg-panel px-4 py-3.5 pr-11 font-sans text-base font-medium outline-none transition-all
                    hover:bg-panel-2 hover:border-faint focus:border-accent focus:ring-2 focus:ring-white/10
                    ${highlight ? 'text-fg border-accent/40' : 'text-fg border-line'}
                `}
                value={value}
                onChange={onChange}
            >
                {options.map((opt: any) => (
                    <option key={opt.value || opt} value={opt.value || opt}>
                        {opt.label || opt}
                    </option>
                ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-faint pointer-events-none group-hover:text-muted transition-colors" size={16} />
        </div>
        {subLabel && (
             <p className="text-xs text-faint mt-2 leading-snug">
                {subLabel}
             </p>
        )}
    </div>
);

export default SelectInput;
