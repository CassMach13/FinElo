import React, { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { MappingRule, Category, Asset, Transaction } from '../../types';

interface MappingRuleModalProps {
    rule: MappingRule | null;
    transaction?: Transaction | null;
    categories: Category[];
    assets: Asset[];
    onClose: () => void;
    onSave: (rule: Omit<MappingRule, 'id'>) => void;
}

const MappingRuleModal: React.FC<MappingRuleModalProps> = ({ rule, transaction, categories, assets, onClose, onSave }) => {
    const [text, setText] = useState(rule?.Texto_Contido_Descricao || transaction?.Descricao_Original || '');
    const [suggestedName, setSuggestedName] = useState(rule?.Nome_Fantasia_Sugerido || transaction?.Nome_Fantasia || '');
    const [suggestedCategory, setSuggestedCategory] = useState(rule?.Categoria_Sugerida || '');
    const [linkedAssetId, setLinkedAssetId] = useState(rule?.linked_asset_id || transaction?.linked_asset_id || '');
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (rule) {
            setText(rule.Texto_Contido_Descricao);
            setSuggestedName(rule.Nome_Fantasia_Sugerido);
            setSuggestedCategory(rule.Categoria_Sugerida);
            setLinkedAssetId(rule.linked_asset_id || '');
        } else if (transaction) {
            setText(transaction.Descricao_Original);
            setSuggestedName(transaction.Nome_Fantasia);
            setSuggestedCategory('');
            setLinkedAssetId(transaction.linked_asset_id || '');
        } else {
            setText('');
            setSuggestedName('');
            setSuggestedCategory('');
            setLinkedAssetId('');
        }
    }, [rule, transaction]);

    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (!text.trim()) newErrors.text = 'O texto a ser buscado é obrigatório.';
        if (!suggestedName.trim()) newErrors.suggestedName = 'O nome sugerido é obrigatório.';
        if (!suggestedCategory) newErrors.suggestedCategory = 'A categoria sugerida é obrigatória.';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validate()) {
            onSave({
                Texto_Contido_Descricao: text.trim(),
                Nome_Fantasia_Sugerido: suggestedName.trim(),
                Categoria_Sugerida: suggestedCategory,
                linked_asset_id: linkedAssetId || undefined
            });
        }
    };

    const sortedCategories = [...categories].sort((a, b) => a.Nome_Categoria.localeCompare(b.Nome_Categoria));

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={rule ? 'Editar Regra de Mapeamento' : 'Nova Regra de Mapeamento'}
            footer={
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" form="mapping-rule-form">Salvar</Button>
                </div>
            }
        >
            <form id="mapping-rule-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <Input
                        label="Se a descrição contiver o texto:"
                        id="rule-text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Ex: Uber"
                        error={errors.text}
                        autoFocus
                    />
                    <p className="text-xs text-gray-500 mt-1">O sistema buscará este texto nas transações importadas (ignora maiúsculas/minúsculas).</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                        label="Alterar Descrição Para:"
                        id="rule-name"
                        value={suggestedName}
                        onChange={(e) => setSuggestedName(e.target.value)}
                        placeholder="Ex: Uber Viagem"
                        error={errors.suggestedName}
                    />
                    <Select
                        label="Classificar Como:"
                        id="rule-category"
                        value={suggestedCategory}
                        onChange={(e) => setSuggestedCategory(e.target.value)}
                        error={errors.suggestedCategory}
                    >
                        <option value="" disabled>Selecione...</option>
                        {sortedCategories.map(c => (
                            <option key={c.id} value={c.Nome_Categoria}>{c.Nome_Categoria}</option>
                        ))}
                    </Select>
                    <Select
                        label="Vincular a Patrimônio (Opcional):"
                        id="rule-asset"
                        value={linkedAssetId}
                        onChange={(e) => setLinkedAssetId(e.target.value)}
                    >
                        <option value="">-</option>
                        {assets
                            .filter(a => a.is_financed)
                            .map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                            ))
                        }
                    </Select>
                </div>
            </form>
        </Modal>
    );
};

export default MappingRuleModal;
