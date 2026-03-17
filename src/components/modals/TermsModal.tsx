import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { supabase } from '../../supabaseClient';
import { useAppStore } from '../../hooks/useAppStore';

// Versioning - Change this to force re-acceptance
const CURRENT_TERMS_VERSION = 'v_2026_03_17_consumer_rights';

const TermsText = `
# Termos e Condições de Uso - FinElo

**Última Atualização:** 17 de Março de 2026

Bem-vindo ao **FinElo**. Por favor, leia estes Termos e Condições ("Termos", "Termos de Uso") cuidadosamente antes de utilizar o aplicativo FinElo (o "Serviço") operado por FinElo ("nós", "nosso").

O seu acesso e uso do Serviço estão condicionados à sua aceitação e cumprimento destes Termos. Estes Termos aplicam-se a todos os visitantes, usuários e outras pessoas que acessam ou usam o Serviço.

**Ao acessar ou usar o Serviço, você concorda em ficar vinculado a estes Termos. Se você não concordar com qualquer parte dos termos, então você não pode acessar o Serviço.**

---

## 1. Natureza do Serviço e Isenção de Consultoria Financeira

**1.1. Ferramenta de Gestão, Não Consultoria.**
O FinElo é uma ferramenta tecnológica destinada a auxiliar na organização, visualização e gestão de finanças pessoais através da importação de dados e inputs manuais. **O FinElo NÃO é um consultor financeiro, banco, corretora ou instituição financeira.**

**1.2. Sem Recomendação de Investimento.**
Qualquer conteúdo, gráfico, relatório ou "insight" gerado pelo Serviço tem fins meramente informativos e educacionais. Nenhuma informação contida no Serviço deve ser interpretada como uma recomendação de compra ou venda de ativos, consultoria de investimentos ou aconselhamento jurídico/tributário. Você é o único responsável por suas decisões financeiras.

**1.3. Precisão dos Dados.**
Embora nos esforcemos para processar seus arquivos (CSV, OFX, etc.) com precisão, não garantimos que a importação de dados estará livre de erros. Discrepâncias podem ocorrer devido a formatos de arquivo de terceiros, falhas de leitura ou erros de input manual. É sua responsabilidade verificar a precisão dos dados antes de tomar decisões baseadas neles.

## 2. Contas e Segurança

**2.1. Criação de Conta.**
Ao criar uma conta conosco, você deve fornecer informações que sejam precisas, completas e atuais. O não cumprimento desta obrigação constitui uma violação dos Termos, o que pode resultar no encerramento imediato da sua conta.

**2.2. Segurança da Senha.**
Você é responsável por proteger a senha que usa para acessar o Serviço e por quaisquer atividades ou ações sob sua senha. Você concorda em não divulgar sua senha a terceiros. Você deve nos notificar imediatamente ao tomar conhecimento de qualquer violação de segurança ou uso não autorizado de sua conta.

## 3. Propriedade Intelectual

O Serviço e seu conteúdo original (excluindo o Conteúdo fornecido pelos usuários), características e funcionalidades são e permanecerão de propriedade exclusiva do FinElo e seus licenciadores. O Serviço é protegido por direitos autorais, marcas registradas e outras leis do Brasil e de outros países. Nossas marcas registradas e identidade visual não podem ser usadas em conexão com qualquer produto ou serviço sem o consentimento prévio por escrito do FinElo.

## 4. Conteúdo do Usuário e Privacidade

**4.1. Propriedade dos Dados.**
Você mantém todos os direitos sobre os dados financeiros, arquivos e informações que você envia, publica ou exibe no ou através do Serviço ("Conteúdo do Usuário").

**4.2. Licença para Processamento.**
Ao enviar Conteúdo, você concede ao FinElo uma licença mundial, não exclusiva e isenta de royalties para usar, reproduzir, modificar e adaptar esse Conteúdo apenas na medida necessária para fornecer e melhorar o Serviço para você (ex: gerar seus gráficos).

**4.3. Privacidade e Proteção de Dados (LGPD e GDPR).**

O FinElo está comprometido com a proteção dos seus dados pessoais e financeiros, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 - "LGPD") e, na medida aplicável, com o Regulamento Geral sobre a Proteção de Dados (GDPR).

**a. Seus Direitos:**
Você tem o direito de solicitar a qualquer momento:
- A confirmação da existência de tratamento de seus dados;
- O acesso aos dados mantidos por nós;
- A correção de dados incompletos, inexatos ou desatualizados;
- A anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade;
- A portabilidade dos dados a outro fornecedor de serviço (exportação de CSV/Backup);
- A eliminação dos dados pessoais tratados com o seu consentimento (ex: exclusão da conta).

**b. Base Legal para Tratamento:**
Tratamos seus dados principalmente com base na execução do contrato (para fornecer o serviço de gestão financeira que você contratou ao criar a conta) e no legítimo interesse (para melhorar o serviço, prevenir fraudes e garantir a segurança).

**c. Transferência Internacional de Dados:**
Como um serviço baseado na internet, seus dados podem ser processados e armazenados em servidores localizados fora do Brasil (ex: infraestrutura de nuvem como AWS, Vercel ou Supabase). Ao utilizar o Serviço, você consente com essa transferência, reconhecendo que adotamos salvaguardas contratuais e técnicas adequadas para garantir que seus dados recebam nível de proteção condizente com a LGPD.

**d. Segurança:**
Implementamos medidas técnicas e administrativas (como criptografia em trânsito e repouso) para proteger seus dados contra acessos não autorizados e situações acidentais ou ilícitas de destruição, perda ou alteração.

**e. Encarregado de Dados (DPO):**
Para exercer seus direitos ou tirar dúvidas sobre privacidade, você pode contatar nosso Encarregado de Proteção de Dados através do canal de suporte do aplicativo.

## 5. Limitação de Responsabilidade (Cláusula Robusta)

**5.1. Uso "Como Está" (As-Is).**
O Serviço é fornecido "no estado em que se encontra" e "conforme disponível", sem garantias de qualquer tipo, expressas ou implícitas, incluindo, mas não se limitando a, garantias implícitas de comercialização, adequação a um fim específico ou não violação.

**5.2. Limitação de Danos.**
Em nenhuma circunstância o FinElo, seus diretores, funcionários, parceiros, agentes, fornecedores ou afiliados serão responsáveis por quaisquer danos indiretos, incidentais, especiais, consequenciais ou punitivos, incluindo, sem limitação, perda de lucros, dados, uso, boa vontade ou outras perdas intangíveis, resultantes de:
(i) seu acesso ou uso ou incapacidade de acessar ou usar o Serviço;
(ii) qualquer conduta ou conteúdo de terceiros no Serviço;
(iii) qualquer conteúdo obtido do Serviço; e
(iv) acesso não autorizado, uso ou alteração de suas transmissões ou conteúdo.

**5.3. Teto de Responsabilidade.**
A responsabilidade total do FinElo para quaisquer reivindicações sob estes termos, incluindo por quaisquer garantias implícitas, limita-se ao valor que você nos pagou para usar o Serviço nos últimos 12 meses (se houver) ou R$ 100,00 (cem reais), o que for maior.

## 6. Links Para Outros Sites

Nosso Serviço pode conter links para sites ou serviços de terceiros que não são de propriedade ou controlados pelo FinElo (ex: links para sites de bancos). O FinElo não tem controle e não assume responsabilidade pelo conteúdo, políticas de privacidade ou práticas de quaisquer sites ou serviços de terceiros.

## 7. Assinatura "Founder's Pack" (Acesso Vitalício)

**7.1. Definição de Vitalício e Titularidade.**
A assinatura "Founder's Pack" concede acesso vitalício à versão Pro do Serviço. Para fins destes Termos, "Vitalício" é definido como a duração da vida útil do Serviço FinElo. **Importante:** A garantia de acesso vitalício aplica-se exclusiva e estritamente ao endereço de e-mail original cadastrado no momento da compra. O benefício é pessoal e intransferível, não sendo válida a transferência, repasse ou extensão do acesso vitalício para nenhum outro endereço de e-mail, ainda que pertença ou seja cadastrado pela mesma pessoa física ou jurídica.

**7.2. Direito de Arrependimento e Reembolso (Art. 49 CDC).**
Em conformidade com o Artigo 49 do Código de Defesa do Consumidor, o usuário tem o direito de desistir da compra de qualquer plano (Mensal, Anual ou Founder's Pack) no prazo de 7 (sete) dias corridos a contar da data da contratação. Caso o arrependimento seja exercido dentro deste prazo, o reembolso será integral e efetuado através do mesmo método de pagamento utilizado na compra. Após esse período, os reembolsos seguirão a regra de cancelamento padrão de cada plano.

**7.3. Descontinuidade do Serviço.**
Caso o Serviço FinElo seja descontinuado, encerrado ou deixe de ser operado por qualquer motivo (técnico, comercial ou legal), o acesso "Vitalício" será encerrado simultaneamente, sem direito a reembolso total ou parcial após o período de garantia legal de 7 dias previsto no Código de Defesa do Consumidor.

## 8. Encerramento

Podemos encerrar ou suspender sua conta imediatamente, sem aviso prévio ou responsabilidade, por qualquer motivo, inclusive, sem limitação, se você violar os Termos (ex: tentar realizar engenharia reversa, onerar excessivamente nossos servidores, ou usar o serviço para atividades ilícitas).

## 9. Alterações

Reservamo-nos o direito, a nosso critério exclusivo, de modificar ou substituir estes Termos a qualquer momento. Se uma revisão for material, tentaremos fornecer um aviso com pelo menos 30 dias de antecedência antes que quaisquer novos termos entrem em vigor. O que constitui uma mudança material será determinado a nosso critério exclusivo.

## 10. Legislação Aplicável e Foro

Estes Termos serão regidos e interpretados de acordo com as leis do Brasil, sem levar em conta suas disposições sobre conflitos de leis.
Fica eleito o Foro da Comarca de São Paulo/SP para dirimir quaisquer questões oriundas destes Termos, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

---

**Contato**
Se você tiver alguma dúvida sobre estes Termos, entre em contato conosco através do canal de suporte no aplicativo.
`;

interface TermsModalProps {
    isOpen?: boolean; // Controlled mode
    onClose?: () => void;
}

const TermsModal: React.FC<TermsModalProps> = ({ isOpen: controlledIsOpen, onClose }) => {
    const { user } = useAppStore();
    const [internalIsOpen, setInternalIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [hasRead, setHasRead] = useState(false);

    // Determine effective open state
    // If controlledIsOpen is undefined, we use internal state (Automatic mode)
    const isModalOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;

    // Is this strictly a "Force Accept" mode?
    // Only if it's open automatically due to version mismatch.
    // If passed via props (controlled), it's "Read Only".
    const isReadOnly = controlledIsOpen !== undefined;

    useEffect(() => {
        // Only run automatic check if NOT controlled
        if (controlledIsOpen === undefined && user) {
            const acceptedVersion = user.user_metadata?.terms_accepted_version;
            // If version mismatch, open modal
            if (acceptedVersion !== CURRENT_TERMS_VERSION) {
                setInternalIsOpen(true);
            }
        }
    }, [user, controlledIsOpen]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        // Simple logic: if scrolled to bottom setHasRead(true)
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        if (scrollHeight - scrollTop <= clientHeight + 50) { // +50px tolerance
            setHasRead(true);
        }
    };

    const handleAccept = async () => {
        // If read-only, this button shouldn't exist or just closes.
        if (isReadOnly) {
            onClose?.();
            return;
        }

        if (!user) return;
        setLoading(true);

        try {
            const { error } = await supabase.auth.updateUser({
                data: { terms_accepted_version: CURRENT_TERMS_VERSION }
            });

            if (error) throw error;

            // Success
            setInternalIsOpen(false);

        } catch (err: any) {
            console.error('Error accepting terms:', err);
            alert('Erro ao aceitar os termos. Por favor, tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    if (!isModalOpen) return null;

    return (
        <Modal
            isOpen={isModalOpen}
            onClose={() => {
                if (isReadOnly && onClose) onClose();
                // If not read-only (enforcement), block closing.
            }}
            title={isReadOnly ? "Termos e Condições" : `Atualização de Termos de Uso (${CURRENT_TERMS_VERSION})`}
            hideCloseButton={!isReadOnly} // Show close button if read-only
            className="max-w-4xl h-[90vh]"
            footer={
                <div className="flex flex-col sm:flex-row justify-between items-center w-full gap-4">
                    <p className="text-xs text-gray-400">
                        {isReadOnly ? '' : 'Você precisa ler até o final para aceitar.'}
                    </p>
                    <Button
                        onClick={handleAccept}
                        disabled={(!isReadOnly && !hasRead) || loading}
                        isLoading={loading}
                    >
                        {loading ? 'Processando...' : (isReadOnly ? 'Fechar' : 'Li e Concordo com os Termos')}
                    </Button>
                </div>
            }
        >
            <div
                className="text-gray-300 space-y-4 text-justify pr-2 overflow-y-auto max-h-[60vh] border border-slate-700/50 p-4 rounded bg-slate-800/20"
                onScroll={handleScroll}
            >
                <div className="whitespace-pre-wrap font-sans">
                    {TermsText}
                </div>
            </div>
        </Modal>
    );
};

export default TermsModal;
