import React, { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { Category } from '../../types';

interface CategoryModalProps {
    category: Category | null;
    onClose: () => void;
    onSave: (category: Omit<Category, 'id'>) => void;
    overlayClassName?: string;
}

const CategoryModal: React.FC<CategoryModalProps> = ({ category, onClose, onSave, overlayClassName }) => {
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [name, setName] = useState(category?.Nome_Categoria || '');
    const [type, setType] = useState<'Renda' | 'Despesa' | 'Ambos' | ''>(category?.Tipo || '');
    const [isInvestment, setIsInvestment] = useState(category?.is_investment || false);
    const [isEssential, setIsEssential] = useState(category?.is_essential || false);

    useEffect(() => {
        if (category) {
            setName(category.Nome_Categoria);
            setType(category.Tipo);
            setIsInvestment(category.is_investment || false);
            setIsEssential(category.is_essential || false);
        } else {
            setName('');
            setType('');
            setIsInvestment(false);
            setIsEssential(false);
        }
    }, [category]);

    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (!name.trim()) newErrors.name = 'O nome da categoria é obrigatório.';
        if (!type) newErrors.type = 'O tipo é obrigatório.';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validate()) {
            onSave({
                Nome_Categoria: name.trim(),
                Tipo: type as 'Renda' | 'Despesa' | 'Ambos',

                is_investment: isInvestment,
                is_essential: isEssential
            });
        }
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={category ? 'Editar Categoria' : 'Nova Categoria'}
            overlayClassName={overlayClassName}
            footer={
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" form="category-form">Salvar</Button>
                </div>
            }
        >
            <form id="category-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input label="Nome da Categoria" id="category-name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoFocus />
                    <Select label="Tipo" id="category-type" value={type} onChange={(e) => setType(e.target.value as any)} error={errors.type}>
                        <option value="" disabled>Selecione...</option>
                        <option value="Despesa">Saída (Despesa)</option>
                        <option value="Renda">Entrada (Renda)</option>
                        <option value="Ambos">Movimentação (Entrada/Saída)</option>
                    </Select>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id="is-investment"
                        checked={isInvestment}
                        onChange={(e) => setIsInvestment(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-accent focus:ring-accent"
                    />
                    <label htmlFor="is-investment" className="text-sm text-gray-300 select-none cursor-pointer">
                        Esta categoria representa um <strong>Investimento</strong> ou <strong>Retirada</strong>?
                        <span className="block text-xs text-gray-500 font-normal">
                            Transações nesta categoria serão separadas do fluxo operacional no Dashboard.
                        </span>
                    </label>
                </div>

                {!isInvestment && type !== 'Renda' && (
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="is-essential"
                            checked={isEssential}
                            onChange={(e) => setIsEssential(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
                        />
                        <label htmlFor="is-essential" className="text-sm text-gray-300 select-none cursor-pointer">
                            Este é um <strong>Gasto Essencial</strong>? (50-30-20)
                            <span className="block text-xs text-gray-500 font-normal">
                                Marque se for item de sobrevivência (ex: Aluguel, Luz, Mercado). Não marque se for 'Estilo de Vida'.
                            </span>
                        </label>
                    </div>
                )}
            </form>
        </Modal>
    );
};

export default CategoryModal;
