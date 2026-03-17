import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { supabase } from '../../supabaseClient';
import { useAppStore } from '../../hooks/useAppStore';

interface InviteMemberModalProps {
    onClose: () => void;
    currentMembers: any[];
}

const InviteMemberModal: React.FC<InviteMemberModalProps> = ({ onClose, currentMembers }) => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const { isPremium, subscription, setCurrentView } = useAppStore(); // Add store usage

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Usuário não autenticado');

            if (!isPremium) {
                alert('Recurso exclusivo para assinantes Premium.');
                setLoading(false);
                return;
            }

            const slots = subscription?.family_slots || 0;
            if (currentMembers.length >= slots) {
                alert(`Você atingiu o limite de vagas na sua conta (Total: ${slots}). Faça um upgrade para adicionar mais membros.`);
                setLoading(false);
                return;
            }

            // Check duplicates
            if (currentMembers.some(m => m.member_email === email)) {
                alert('Este email já faz parte da sua família.');
                setLoading(false);
                return;
            }

            if (email.toLowerCase().trim() === user.email?.toLowerCase().trim()) {
                alert('Você não pode convidar a si mesmo para o plano família.');
                setLoading(false);
                return;
            }

            const { error } = await supabase
                .from('family_members')
                .insert({
                    owner_id: user.id,
                    owner_email: user.email,
                    member_email: email.toLowerCase().trim(),
                    status: 'pending'
                });

            if (error) throw error;

            alert(`Convite enviado para ${email}! Agora basta essa pessoa criar uma conta (ou logar) com este email para ver seus dados.`);
            onClose();

        } catch (err: any) {
            console.error(err);
            alert('Erro ao adicionar membro: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title="Adicionar Membro da Família"
            footer={<div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                {isPremium && currentMembers.length >= (subscription?.family_slots || 0) ? (
                    <Button onClick={() => { setCurrentView('pricing'); onClose(); }}>
                        Comprar + Vagas
                    </Button>
                ) : (
                    <Button onClick={handleInvite} disabled={loading || !isPremium}>{loading ? 'Adicionando...' : 'Adicionar'}</Button>
                )}
            </div>}
        >
            <div className="space-y-4">
                <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 p-3 rounded text-sm mb-2">
                    <strong>⚠️ Atenção:</strong> Ao adicionar um membro, ele terá acesso <u>TOTAL</u> para ver, editar e excluir suas transações e contas. Use com cuidado.
                </div>

                <div className="flex justify-between items-center bg-slate-800/50 p-3 rounded-lg border border-slate-700/50 mb-4">
                    <span className="text-gray-300 text-sm">Vagas em uso:</span>
                    <span className="font-bold text-white">
                        {currentMembers.length} / {subscription?.family_slots || 0}
                    </span>
                </div>

                <Input
                    label="Email do Familiar"
                    type="email"
                    placeholder="exemplo@gmail.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                />

                <p className="text-xs text-gray-400">
                    A pessoa deve usar exatamente este email para acessar o FinElo. Se ela já tiver conta, os dados dela serão mesclados visualmente com os seus.
                </p>

                <div className="bg-primary/50 p-3 rounded border border-slate-700 text-xs text-gray-400">
                    <p className="font-bold text-gray-300 mb-1">Valores por vaga adicional:</p>
                    <ul className="list-disc pl-4 space-y-1">
                        <li>Plano PRO: R$ 4,50 / mês</li>
                        <li>Plano WEALTH: R$ 9,00 / mês</li>
                    </ul>
                    <p className="mt-2 leading-relaxed">O convidado herda o seu nível de plano (PRO ou WEALTH) automaticamente.</p>
                </div>
            </div>
        </Modal>
    );
};

export default InviteMemberModal;
