import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import ImportFeedback from '../../src/components/imports/ImportFeedback';

describe('feedback de importação antes oculto, correção visual aprovada',()=>{
  it('expõe o erro existente como alerta sem interpretar seu conteúdo como HTML',()=>{
    const notification=Object.freeze({type:'error' as const,message:'Erro <arquivo> para pré-visualização.'});
    const html=renderToStaticMarkup(createElement(ImportFeedback,{visible:true,notification}));
    expect(html).toContain('role="alert"');expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('Erro &lt;arquivo&gt; para pré-visualização.');
    expect(html).toContain('no-print');
    expect(notification.message).toBe('Erro <arquivo> para pré-visualização.');
  });
  it('expõe a mensagem de resultado Open Finance como status',()=>{
    const html=renderToStaticMarkup(createElement(ImportFeedback,{visible:true,notification:{type:'success',message:'2 transações importadas, 1 mergeada.'}}));
    expect(html).toContain('role="status"');expect(html).toContain('aria-live="polite"');
    expect(html).toContain('2 transações importadas, 1 mergeada.');
  });
  it('evita duplicar o painel existente quando há importações novas',()=>{
    const notification={type:'success' as const,message:'Importação concluída',summary:{imported:2,ignored:1}};
    expect(renderToStaticMarkup(createElement(ImportFeedback,{visible:true,notification}))).toBe('');
    expect(renderToStaticMarkup(createElement(ImportFeedback,{visible:true,notification:{...notification,summary:{imported:0,ignored:1}}}))).toContain('Importação concluída');
  });
  it('não mostra resultados antigos atrás do contexto ativo ou sem notificação',()=>{
    expect(renderToStaticMarkup(createElement(ImportFeedback,{visible:false,notification:{type:'error',message:'Erro anterior'}}))).toBe('');
    expect(renderToStaticMarkup(createElement(ImportFeedback,{visible:true,notification:null}))).toBe('');
  });
});
