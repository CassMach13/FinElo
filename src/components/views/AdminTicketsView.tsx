import React, { useEffect, useState } from 'react';
import Card from './../ui/Card';
import Button from './../ui/Button';
import { useAppStore } from './../../hooks/useAppStore';
import { SupportTicket } from './../../types';
import { TourButton } from '../TourButton';
import AdminDashboard from '../admin/AdminDashboard';

const AdminTicketsView: React.FC = () => {
    const { fetchAllTickets, supportTickets, updateSupportTicketStatus, sendMessage } = useAppStore();
    const [selectedTab, setSelectedTab] = useState<'tickets' | 'metrics'>('tickets');
    const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'resolved' | 'closed'>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
    const [replyText, setReplyText] = useState('');

    useEffect(() => {
        fetchAllTickets();
    }, []);

    const handleSendMessage = async (ticketId: string, message: string, file?: File | null) => {
        if (!message.trim() && !file) return;
        await sendMessage(ticketId, message, file || undefined);
    };

    const filteredTickets = supportTickets.filter(ticket => {
        const matchesStatus = filterStatus === 'all' || ticket.status === filterStatus;
        const cleanSearch = searchTerm.toLowerCase().replace('#', '').trim();
        const matchesSearch = !searchTerm ||
            (ticket.protocol?.toLowerCase().includes(cleanSearch)) ||
            (ticket.subject.toLowerCase().includes(cleanSearch)) ||
            (ticket.description.toLowerCase().includes(cleanSearch)) ||
            (ticket.id.includes(searchTerm));

        return matchesStatus && matchesSearch;
    });

    // Count pending
    const pendingCount = supportTickets.filter(t =>
        (t.status === 'open' || t.status === 'in_progress') &&
        (!t.messages || t.messages.length === 0 || [...t.messages].sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[t.messages.length - 1]?.sender_id === t.user_id)
    ).length;

    const selectedTicket = supportTickets.find(t => t.id === selectedTicketId);

    return (
        <div className="space-y-6 animate-fade-in-up h-[calc(100vh-100px)] flex flex-col">
            <header className="flex justify-between items-center shrink-0">
                <div>
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                        Gestão da Plataforma (Admin)
                    </h2>
                    <p className="text-gray-400">
                        {pendingCount > 0 ? `${pendingCount} chamados pedindo atenção.` : 'Tudo em dia por aqui!'}
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="bg-slate-800/80 p-1 rounded-xl flex gap-1">
                        <button
                            onClick={() => setSelectedTab('tickets')}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${selectedTab === 'tickets' ? 'bg-purple-600/20 text-purple-400' : 'text-gray-400 hover:text-white hover:bg-slate-700/50'
                                }`}
                        >
                            Chamados
                        </button>
                        <button
                            onClick={() => setSelectedTab('metrics')}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${selectedTab === 'metrics' ? 'bg-purple-600/20 text-purple-400' : 'text-gray-400 hover:text-white hover:bg-slate-700/50'
                                }`}
                        >
                            Métricas
                        </button>
                    </div>
                    <TourButton currentView="admin" />
                </div>
            </header>

            {selectedTab === 'tickets' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                    {/* LIST COLUMN */}
                    <div className="lg:col-span-1 bg-secondary/30 backdrop-blur-md rounded-2xl border border-white/5 p-4 flex flex-col min-h-0">
                        {/* Search & Filter */}
                        <div className="space-y-3 mb-4 shrink-0">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Buscar protocolo, termo..."
                                    className="w-full bg-slate-800/50 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:border-purple-500 outline-none transition-colors"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                                <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
                            </div>
                            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                                {(['all', 'open', 'resolved', 'closed'] as const).map(st => (
                                    <button
                                        key={st}
                                        onClick={() => setFilterStatus(st)}
                                        className={`px-3 py-1 rounded-full text-xs font-bold capitalize whitespace-nowrap transition-colors ${filterStatus === st
                                            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50'
                                            : 'bg-slate-800 text-gray-500 hover:text-gray-300'
                                            }`}
                                    >
                                        {st === 'all' ? 'Todos' : st === 'open' ? 'Abertos' : st === 'resolved' ? 'Resolvidos' : 'Fechados'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Ticket List */}
                        <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-slate-700">
                            {filteredTickets.map(ticket => (
                                <div
                                    key={ticket.id}
                                    onClick={() => setSelectedTicketId(ticket.id)}
                                    className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedTicketId === ticket.id
                                        ? 'bg-purple-500/10 border-purple-500/50'
                                        : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800'
                                        }`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${ticket.type === 'bug' ? 'bg-red-500/20 text-red-400' :
                                                ticket.type === 'feature' ? 'bg-blue-500/20 text-blue-400' :
                                                    'bg-yellow-500/20 text-yellow-400'
                                                }`}>
                                                {ticket.type}
                                            </span>
                                            {ticket.protocol && <span className="text-[10px] font-mono text-cyan-400">#{ticket.protocol}</span>}
                                        </div>
                                        <span className="text-[10px] text-gray-500">
                                            {new Date(ticket.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <h4 className="font-sembold text-sm text-slate-200 line-clamp-1">{ticket.subject}</h4>
                                    <p className="text-xs text-slate-500 line-clamp-2 mt-1">{ticket.description}</p>
                                </div>
                            ))}
                            {filteredTickets.length === 0 && (
                                <div className="text-center py-10 text-gray-500 text-sm">
                                    Nenhum chamado encontrado.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* DETAIL COLUMN */}
                    <div className="lg:col-span-2 bg-secondary/30 backdrop-blur-md rounded-2xl border border-white/5 flex flex-col min-h-0 overflow-hidden">
                        {selectedTicket ? (
                            <>
                                {/* Header */}
                                <div className="p-4 border-b border-white/5 bg-slate-900/40 shrink-0 flex justify-between items-start">
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <h3 className="text-xl font-bold text-white">{selectedTicket.subject}</h3>
                                            <span className={`text-xs px-2 py-0.5 rounded border ${selectedTicket.status === 'open' ? 'border-green-500/30 text-green-400' :
                                                selectedTicket.status === 'resolved' ? 'border-blue-500/30 text-blue-400' :
                                                    selectedTicket.status === 'closed' ? 'border-gray-600 text-gray-500' :
                                                        'border-yellow-500/30 text-yellow-400'
                                                }`}>
                                                {selectedTicket.status.toUpperCase().replace('_', ' ')}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-gray-400">
                                            <span>User ID: {selectedTicket.user_id.slice(0, 8)}...</span>
                                            {selectedTicket.protocol && <span className="text-cyan-400 font-mono">Protocolo: {selectedTicket.protocol}</span>}
                                            <span>{new Date(selectedTicket.created_at).toLocaleString()}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-400">Status:</span>
                                        <select
                                            value={selectedTicket.status}
                                            onChange={(e) => updateSupportTicketStatus(selectedTicket.id, e.target.value as any)}
                                            className="bg-slate-800 border border-slate-700 rounded text-xs px-2 py-1 outline-none focus:border-purple-500"
                                        >
                                            <option value="open">Aberto</option>
                                            <option value="in_progress">Em Progresso</option>
                                            <option value="resolved">Resolvido</option>
                                            <option value="closed">Fechado</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Messages Area */}
                                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/20 scrollbar-thin scrollbar-thumb-slate-700">
                                    {/* OP Description */}
                                    <div className="flex flex-col gap-1 max-w-[85%]">
                                        <span className="text-[10px] uppercase font-bold text-gray-500 ml-1">Descrição Inicial</span>
                                        <div className="bg-slate-800/80 border border-slate-700/50 p-4 rounded-2xl rounded-tl-none">
                                            <p className="text-sm text-slate-300 whitespace-pre-wrap">{selectedTicket.description}</p>
                                            {selectedTicket.attachment_url && (
                                                <div className="mt-3 pt-3 border-t border-slate-700/50">
                                                    <a href={selectedTicket.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-block">
                                                        {selectedTicket.attachment_url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                                                            <img src={selectedTicket.attachment_url} alt="Anexo" className="max-w-xs rounded-lg border border-slate-700" />
                                                        ) : (
                                                            <span className="text-xs text-purple-400 underline flex items-center gap-1">
                                                                📎 Ver arquivo em nova aba
                                                            </span>
                                                        )}
                                                    </a>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Messages */}
                                    {[...(selectedTicket.messages || [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map(msg => {
                                        // In Admin View, "I" am the admin.
                                        // If msg.sender_id == ticket.user_id, it is the USER.
                                        const isUser = msg.sender_id === selectedTicket.user_id;
                                        return (
                                            <div key={msg.id} className={`flex flex-col gap-1 max-w-[85%] ${!isUser ? 'self-end items-end' : ''}`}>
                                                <span className={`text-[10px] uppercase font-bold ${!isUser ? 'text-cyan-500 mr-1' : 'text-gray-500 ml-1'}`}>
                                                    {!isUser ? 'Você (Suporte)' : 'Usuário'}
                                                </span>
                                                <div className={`p-3 rounded-2xl text-sm whitespace-pre-wrap shadow-sm border ${!isUser
                                                    ? 'bg-purple-600 border-purple-500 text-white rounded-tr-none'
                                                    : 'bg-slate-800 border-slate-700 text-slate-300 rounded-tl-none'
                                                    }`}>
                                                    {msg.message}
                                                    {msg.attachment_url && (
                                                        <div className={`mt-2 pt-2 border-t ${!isUser ? 'border-purple-500' : 'border-slate-700'}`}>
                                                            <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-block">
                                                                {msg.attachment_url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                                                                    <img src={msg.attachment_url} alt="Anexo" className="max-w-[200px] rounded-md border border-slate-700" />
                                                                ) : (
                                                                    <span className={`text-xs underline ${!isUser ? 'text-purple-200' : 'text-purple-400'}`}>
                                                                        📎 Ver anexo
                                                                    </span>
                                                                )}
                                                            </a>
                                                        </div>
                                                    )}
                                                </div>
                                                <span className="text-[10px] text-gray-600">{new Date(msg.created_at).toLocaleString()}</span>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Reply Box */}
                                <div className="p-4 bg-slate-900/50 border-t border-white/5 shrink-0">
                                    <div className="flex gap-2">
                                        <div className="flex-1 flex flex-col gap-2">
                                            <textarea
                                                placeholder="Digite sua resposta..."
                                                className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm focus:outline-none focus:border-purple-500 resize-none h-20"
                                                value={replyText}
                                                onChange={(e) => setReplyText(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        const attachmentInput = (e.currentTarget.parentElement?.querySelector('input[type="file"]') as HTMLInputElement);
                                                        const file = attachmentInput?.files?.[0];
                                                        
                                                        handleSendMessage(selectedTicket.id, replyText, file);
                                                        setReplyText('');
                                                        if (attachmentInput) attachmentInput.value = '';
                                                        const label = e.currentTarget.parentElement?.querySelector('.file-label');
                                                        if (label) label.textContent = '📎 Anexar arquivo';
                                                    }
                                                }}
                                            />
                                            <div className="flex items-center gap-3 px-1">
                                                <div className="relative group">
                                                    <input
                                                        type="file"
                                                        className="absolute inset-0 opacity-0 cursor-pointer w-full"
                                                        onChange={(e) => {
                                                            const fileName = e.target.files?.[0]?.name;
                                                            const label = e.target.parentElement?.querySelector('.file-label');
                                                            if (label) label.textContent = fileName ? `📎 ${fileName}` : '📎 Anexar arquivo';
                                                        }}
                                                    />
                                                    <div className="file-label px-3 py-1 bg-slate-800 rounded-lg border border-slate-700 text-[10px] text-gray-400 hover:text-purple-400 transition-colors cursor-pointer">
                                                        📎 Anexar arquivo
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex flex-col justify-end">
                                            <Button
                                                onClick={(e) => {
                                                    const container = e.currentTarget.parentElement?.previousElementSibling;
                                                    const attachmentInput = container?.querySelector('input[type="file"]') as HTMLInputElement;
                                                    const file = attachmentInput?.files?.[0];
                                                    
                                                    handleSendMessage(selectedTicket.id, replyText, file);
                                                    setReplyText('');
                                                    if (attachmentInput) attachmentInput.value = '';
                                                    const label = container?.querySelector('.file-label');
                                                    if (label) label.textContent = '📎 Anexar arquivo';
                                                }}
                                                disabled={!replyText.trim()}
                                            >
                                                Enviar
                                            </Button>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-gray-500 mt-2 text-center">
                                        Pressione Enter para enviar. O usuário será notificado na Central de Ajuda.
                                    </p>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                                <span className="text-4xl mb-4 opacity-20">🎫</span>
                                <p>Selecione um chamado para visualizar ou responder.</p>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <AdminDashboard />
            )}
        </div>
    );
};

export default AdminTicketsView;
