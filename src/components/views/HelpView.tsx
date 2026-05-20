
import React, { useState, useEffect } from 'react';
import Card from './../ui/Card';
import Button from './../ui/Button';
import Input from './../ui/Input';
import Select from './../ui/Select';
import { useAppStore } from './../../hooks/useAppStore';
import { TourButton } from '../TourButton';
import HelpCenterBrowse from '../help/HelpCenterBrowse';

const HelpView: React.FC = () => {
    const { createSupportTicket, fetchSupportTickets, supportTickets, sendMessage, user } = useAppStore();
    const [activeTab, setActiveTab] = useState<'topics' | 'new' | 'history'>('topics');
    const [isLoading, setIsLoading] = useState(false);

    const [type, setType] = useState<'question' | 'bug' | 'feature'>('question');
    const [subject, setSubject] = useState('');
    const [description, setDescription] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [hasFileAcceptance, setHasFileAcceptance] = useState(false);

    useEffect(() => {
        fetchSupportTickets();
    }, [fetchSupportTickets]);

    const handleSendMessage = async (ticketId: string, message: string, file?: File | null) => {
        if (!message.trim() && !file) return;
        await sendMessage(ticketId, message, file || undefined);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            await createSupportTicket({
                type,
                subject,
                description
            }, file || undefined);
            setSubject('');
            setDescription('');
            setType('question');
            setFile(null);
            setHasFileAcceptance(false);
            setActiveTab('history');
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const unreadCount = supportTickets.filter(t => {
        if (!t.messages || t.messages.length === 0) return false;
        const sortedMessages = [...t.messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const lastMsg = sortedMessages[sortedMessages.length - 1];
        return lastMsg.sender_id !== user?.id;
    }).length;

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex justify-between items-center flex-wrap gap-3">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                        Central de Ajuda
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Busque por palavra-chave ou navegue pelos tópicos de cada área do FinElo.
                    </p>
                </div>
                <TourButton currentView="help" />
            </div>

            <div className="flex flex-wrap bg-slate-800/50 p-1 rounded-lg w-fit gap-1">
                <button
                    id="help-tab-topics"
                    onClick={() => setActiveTab('topics')}
                    className={`px-4 py-2 rounded-md transition-all ${activeTab === 'topics' ? 'bg-cyan-500/20 text-cyan-400 font-bold' : 'text-slate-400 hover:text-white'}`}
                >
                    Tópicos
                </button>
                <button
                    id="help-tab-new"
                    onClick={() => setActiveTab('new')}
                    className={`px-4 py-2 rounded-md transition-all ${activeTab === 'new' ? 'bg-cyan-500/20 text-cyan-400 font-bold' : 'text-slate-400 hover:text-white'}`}
                >
                    Novo Chamado
                </button>
                <button
                    id="help-tab-history"
                    onClick={() => setActiveTab('history')}
                    className={`px-4 py-2 rounded-md transition-all relative ${activeTab === 'history' ? 'bg-cyan-500/20 text-cyan-400 font-bold' : 'text-slate-400 hover:text-white'}`}
                >
                    Meus Chamados
                    {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
                        </span>
                    )}
                </button>
            </div>

            <div className="min-h-[400px]">
                {activeTab === 'topics' && (
                    <HelpCenterBrowse onOpenSupport={() => setActiveTab('new')} />
                )}

                {activeTab === 'new' && (
                    <Card className="max-w-2xl mx-auto">
                        <h2 className="text-xl font-bold mb-4">Abrir Novo Chamado</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Tipo de Solicitação</label>
                                <Select
                                    value={type}
                                    onChange={(e) => setType(e.target.value as 'question' | 'bug' | 'feature')}
                                >
                                    <option value="question">Dúvida Geral</option>
                                    <option value="bug">Reportar Problema (Bug)</option>
                                    <option value="feature">Sugestão de Melhoria</option>
                                </Select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Assunto</label>
                                <Input
                                    value={subject}
                                    onChange={(e) => setSubject(e.target.value)}
                                    placeholder="Resumo do problema..."
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Descrição Detalhada</label>
                                <textarea
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-cyan-500 transition-colors min-h-[150px]"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Descreva o que aconteceu, passos para reproduzir, etc..."
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Anexar Imagem ou Arquivo (Opcional)</label>
                                <input
                                    type="file"
                                    className="w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-cyan-500/10 file:text-cyan-400 hover:file:bg-cyan-500/20 transition-all"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    accept="image/*,.pdf,.doc,.docx"
                                />
                                {file && (
                                    <div className="mt-4 p-4 bg-slate-800/80 border border-slate-700/80 rounded-lg shadow-inner">
                                        <p className="text-xs text-cyan-400 bg-cyan-900/30 border border-cyan-500/20 px-3 py-2 rounded-md w-fit mb-3 flex items-center gap-2">
                                            <span>📎</span> <span className="font-semibold">{file.name}</span>
                                        </p>
                                        <label className="flex items-start gap-3 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                className="mt-0.5 w-4 h-4 rounded border-slate-600 text-cyan-500 focus:ring-cyan-500 bg-slate-900 cursor-pointer"
                                                checked={hasFileAcceptance}
                                                onChange={(e) => setHasFileAcceptance(e.target.checked)}
                                                required
                                            />
                                            <span className="text-[11px] leading-relaxed text-slate-400 group-hover:text-slate-300 transition-colors">
                                                <strong className="text-slate-200 block mb-1">Termo de Consentimento e Isenção de Responsabilidade (LGPD)</strong>
                                                Ao anexar este documento, declaro expressamente que estou enviando informações confidenciais ou sensíveis por minha livre e espontânea vontade, exclusivamente com a finalidade de viabilizar o suporte técnico. Adicionalmente, concordo em <strong>isentar a FinElo e seus controladores</strong> de toda e qualquer responsabilidade civil ou criminal por eventuais perdas, danos ou vazamentos decorrentes do envio voluntário desta documentação específica no ambiente de atendimento.
                                            </span>
                                        </label>
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-end pt-4">
                                <Button type="submit" disabled={isLoading || (file !== null && !hasFileAcceptance)}>
                                    {isLoading ? 'Enviando...' : 'Abrir Chamado'}
                                </Button>
                            </div>
                        </form>
                    </Card>
                )}

                {activeTab === 'history' && (
                    <div className="space-y-4 max-w-4xl mx-auto">
                        {supportTickets.length === 0 ? (
                            <p className="text-center text-slate-500 py-10">Você ainda não tem chamados abertos.</p>
                        ) : (
                            supportTickets.map(ticket => {
                                const hasMessages = ticket.messages && ticket.messages.length > 0;
                                const sortedMessages = hasMessages ? [...ticket.messages!].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) : [];
                                const lastMsg = sortedMessages.length > 0 ? sortedMessages[sortedMessages.length - 1] : null;
                                const hasNewReply = hasMessages && lastMsg && lastMsg.sender_id !== ticket.user_id;

                                return (
                                    <Card key={ticket.id} className={`transition-all cursor-default border-l-4 ${hasNewReply ? 'border-l-cyan-400 bg-cyan-900/10 border-cyan-500/30' : 'border-l-slate-600 hover:bg-slate-800/50'}`}>
                                        <div className="flex justify-between items-center mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs px-2 py-1 rounded font-bold uppercase ${ticket.type === 'bug' ? 'bg-red-500/20 text-red-400' :
                                                    ticket.type === 'feature' ? 'bg-purple-500/20 text-purple-400' :
                                                        'bg-blue-500/20 text-blue-400'
                                                    }`}>
                                                    {ticket.type === 'bug' ? 'Bug' : ticket.type === 'feature' ? 'Sugestão' : 'Dúvida'}
                                                </span>
                                                <span className="text-xs text-slate-500">{new Date(ticket.created_at).toLocaleString()}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {ticket.protocol && (
                                                    <span className="text-[10px] bg-cyan-900/30 text-cyan-400 px-2 py-1 rounded border border-cyan-500/20 font-mono">
                                                        #{ticket.protocol}
                                                    </span>
                                                )}
                                                <div className={`px-2 py-1 rounded text-xs border ${ticket.status === 'open' ? 'border-green-500 text-green-400' :
                                                    ticket.status === 'in_progress' ? 'border-yellow-500 text-yellow-400' :
                                                        ticket.status === 'resolved' ? 'border-blue-500 text-blue-400' :
                                                            'border-gray-500 text-gray-400'
                                                    }`}>
                                                    {ticket.status === 'open' ? 'Em Aberto' :
                                                        ticket.status === 'in_progress' ? 'Em Análise' :
                                                            ticket.status === 'resolved' ? 'Respondido' : 'Fechado'}
                                                </div>
                                            </div>
                                        </div>

                                        <h3 className="font-bold text-lg mb-2">{ticket.subject}</h3>

                                        <div className="bg-slate-900/50 p-4 rounded-lg text-sm text-slate-300 mb-4 whitespace-pre-wrap border border-slate-700/50">
                                            {ticket.description}
                                            {ticket.attachment_url && (
                                                <div className="mt-4 pt-4 border-t border-slate-700">
                                                    <p className="text-xs text-slate-500 mb-2 uppercase font-bold">Anexo:</p>
                                                    <a href={ticket.attachment_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 transition-colors w-fit">
                                                        {ticket.attachment_url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                                                            <img src={ticket.attachment_url} alt="Anexo" className="max-w-xs rounded-lg border border-slate-700 shadow-lg" />
                                                        ) : (
                                                            <>
                                                                <span className="text-xl">📄</span>
                                                                <span className="underline">Ver arquivo anexado</span>
                                                            </>
                                                        )}
                                                    </a>
                                                </div>
                                            )}
                                        </div>

                                        {ticket.messages && ticket.messages.length > 0 && (
                                            <div className="space-y-3 mb-4 pl-4 border-l-2 border-slate-700">
                                                {[...(ticket.messages || [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map(msg => {
                                                    const isMe = msg.sender_id === user?.id;
                                                    return (
                                                        <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                                            <span className="text-[10px] text-gray-500 mb-1">{isMe ? 'Você' : 'Suporte FinElo'} - {new Date(msg.created_at).toLocaleString()}</span>
                                                            <div className={`p-3 rounded-xl max-w-[90%] text-sm ${isMe ? 'bg-slate-700 text-slate-200 rounded-tr-none' : 'bg-cyan-900/40 border border-cyan-500/30 text-cyan-100 rounded-tl-none'
                                                                }`}>
                                                                {msg.message}
                                                                {msg.attachment_url && (
                                                                    <div className={`mt-2 pt-2 border-t ${isMe ? 'border-slate-600' : 'border-cyan-500/20'}`}>
                                                                        <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
                                                                            {msg.attachment_url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                                                                                <img src={msg.attachment_url} alt="Anexo" className="max-w-[200px] rounded-md border border-slate-700" />
                                                                            ) : (
                                                                                <>
                                                                                    <span>📎</span>
                                                                                    <span className="underline line-clamp-1">Anexo</span>
                                                                                </>
                                                                            )}
                                                                        </a>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}

                                        <div className="mt-4 flex gap-2">
                                            {(ticket.status === 'closed' || ticket.status === 'resolved') ? (
                                                <div className="w-full bg-slate-800/50 border border-slate-700 p-3 rounded-lg flex justify-between items-center">
                                                    <span className="text-sm text-gray-400">
                                                        Este chamado está encerrado. (Protocolo: {ticket.protocol})
                                                    </span>
                                                    <button
                                                        onClick={() => {
                                                            setSubject(`Referência ao Protocolo ${ticket.protocol || 'N/A'}`);
                                                            setDescription(`Referente ao chamado anterior de protocolo #${ticket.protocol || 'N/A'}.\n\nContexto:\n`);
                                                            setActiveTab('new');
                                                        }}
                                                        className="text-xs text-cyan-400 hover:text-cyan-300 underline"
                                                    >
                                                        Abrir Novo Chamado
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex-1 flex flex-col gap-2">
                                                        <input
                                                            type="text"
                                                            placeholder="Responder..."
                                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    const val = e.currentTarget.value;
                                                                    const attachmentInput = (e.currentTarget.parentElement?.nextElementSibling?.querySelector('input[type="file"]') as HTMLInputElement);
                                                                    const fileAtt = attachmentInput?.files?.[0];

                                                                    if (val.trim() || fileAtt) {
                                                                        handleSendMessage(ticket.id, val, fileAtt);
                                                                        e.currentTarget.value = '';
                                                                        if (attachmentInput) attachmentInput.value = '';
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                        <div className="flex items-center justify-between px-1">
                                                            <div className="relative group">
                                                                <input
                                                                    type="file"
                                                                    className="absolute inset-0 opacity-0 cursor-pointer w-8 h-8"
                                                                    onChange={(e) => {
                                                                        const fileName = e.target.files?.[0]?.name;
                                                                        const label = e.target.parentElement?.querySelector('.file-label');
                                                                        if (label) label.textContent = fileName ? `📎 ${fileName}` : '📎';
                                                                    }}
                                                                />
                                                                <div className="file-label h-8 flex items-center px-3 bg-slate-800 rounded-md border border-slate-700 text-[10px] text-slate-400 hover:text-cyan-400 transition-colors cursor-pointer">
                                                                    📎 Anexar imagem
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <Button size="sm" className="h-fit mt-1" onClick={(e) => {
                                                        const container = e.currentTarget.previousElementSibling;
                                                        const input = container?.querySelector('input[type="text"]') as HTMLInputElement;
                                                        const attachmentInput = container?.querySelector('input[type="file"]') as HTMLInputElement;
                                                        const fileObj = attachmentInput?.files?.[0];

                                                        if (input && (input.value.trim() || fileObj)) {
                                                            handleSendMessage(ticket.id, input.value, fileObj);
                                                            input.value = '';
                                                            if (attachmentInput) attachmentInput.value = '';
                                                            const label = container?.querySelector('.file-label');
                                                            if (label) label.textContent = '📎 Anexar documento';
                                                        }
                                                    }}>
                                                        Enviar
                                                    </Button>
                                                    <div className="w-full mt-2 pl-1">
                                                        <p className="text-[9px] text-slate-500 leading-tight">
                                                            <strong>Aviso de Privacidade:</strong> Ao optar por anexar e enviar arquivos nesta conversa, você consente com o compartilhamento e isenta a FinElo de responsabilidade sobre o tráfego destes dados sensíveis de suporte (LGPD).
                                                        </p>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </Card>
                                );
                            })
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default HelpView;
