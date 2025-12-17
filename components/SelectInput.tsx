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
    <div className="group relative">
        <div className="flex justify-between items-end mb-1">
            <label className={`block text-[10px] font-mono uppercase tracking-widest transition-colors ${highlight ? 'text-white font-bold' : 'text-zinc-500 group-hover:text-white'}`}>
                {label}
            </label>
            {extraAction}
        </div>
        <div className="relative">
            <select 
                className={`w-full bg-transparent border-b py-3 pr-8 font-display text-xl sm:text-2xl uppercase font-medium appearance-none outline-none transition-all cursor-pointer hover:bg-zinc-900/50
                    ${highlight ? 'text-white border-white' : 'text-zinc-300 border-zinc-800 focus:border-white focus:text-white'}
                `}
                value={value}
                onChange={onChange}
            >
                {options.map((opt: any) => (
                    <option key={opt.value || opt} value={opt.value || opt} className="bg-black text-sm text-white">
                        {opt.label || opt}
                    </option>
                ))}
            </select>
            <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none group-hover:text-white" size={16} />
        </div>
        {subLabel && (
             <p className="font-mono text-[10px] text-zinc-600 mt-1 leading-tight">
                {subLabel}
             </p>
        )}
    </div>
);

export default SelectInput;