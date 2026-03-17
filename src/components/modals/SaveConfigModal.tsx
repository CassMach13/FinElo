import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { ImportConfig } from '../../types';

interface SaveConfigModalProps {
    onClose: () => void;
    existingConfigs: ImportConfig[];
    initialName: string;
    onSave: (name: string, isNew: boolean, existingId?: string) => void;
}

const SaveConfigModal: React.FC<SaveConfigModalProps> = ({ onClose, existingConfigs, initialName, onSave }) => {
    const [mode, setMode] = useState<'new' | 'existing'>('new');
    const [newName, setNewName] = useState(initialName);
    const [selectedConfigId, setSelectedConfigId] = useState('');

    const handleSave = () => {
        if (mode === 'new') {
            if (!newName) return alert("Digite um nome.");
            const exists = existingConfigs.find(c => c.Nome_Fonte.toLowerCase() === newName.trim().toLowerCase());
            if (exists) return alert(`Já existe uma configuração com o nome "${exists.Nome_Fonte}". Selecione "Atualizar Existente" se deseja sobrescrevê-la.`);
            onSave(newName, true);
        } else {
            if (!selectedConfigId) return alert("Selecione uma configuração.");
            const conf = existingConfigs.find(c => c.id === selectedConfigId);
            if (confirm(`Tem certeza que deseja atualizar o mapeamento de "${conf?.Nome_Fonte}"?`)) {
                onSave(conf!.Nome_Fonte, false, selectedConfigId);
            }
        }
    };

    return (
        <Modal isOpen={true} onClose={onClose} title="Salvar Mapeamento" footer={
            <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>Não Salvar</Button>
                <Button onClick={handleSave}>Salvar Configuração</Button>
            </div>
        }>
            <div className="space-y-4">
                <p className="text-gray-300 text-sm">Como você gostaria de salvar este padrão de colunas?</p>
                <div className="flex gap-4 mb-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="mode" checked={mode === 'new'} onChange={() => setMode('new')} className="text-highlight focus:ring-highlight" />
                        <span className="text-white">Criar Nova</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="mode" checked={mode === 'existing'} onChange={() => setMode('existing')} className="text-highlight focus:ring-highlight" />
                        <span className="text-white">Atualizar Existente</span>
                    </label>
                </div>
                {mode === 'new' ? (
                    <Input label="Nome da Nova Configuração" placeholder="Ex: Nubank, Boleto XP..." value={newName} onChange={e => setNewName(e.target.value)} />
                ) : (
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Selecione a Configuração</label>
                        <select className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white focus:ring-2 focus:ring-highlight focus:border-transparent outline-none transition-all" value={selectedConfigId} onChange={e => setSelectedConfigId(e.target.value)}>
                            <option value="">Selecione...</option>
                            {existingConfigs.map(c => (
                                <option key={c.id} value={c.id}>{c.Nome_Fonte}</option>
                            ))}
                        </select>
                        <p className="text-xs text-yellow-400 mt-2">⚠️ Isso substituirá as configurações de colunas anteriores para esta fonte.</p>
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default SaveConfigModal;
