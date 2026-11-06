import { readFileSync } from 'node:fs';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import Input from '../../src/components/ui/Input';
import Select from '../../src/components/ui/Select';
import baseline from './financial-presentation-baseline.json';
import { financialImplementationFingerprint } from './financialPresentationFingerprint';

describe('conversão financeira preserva a implementação da main',()=>{
  it.each(Object.entries(baseline.files))('%s conserva classes, cálculos e operações financeiras',(path,hash)=>{
    expect(financialImplementationFingerprint(path,readFileSync(path,'utf8'))).toBe(hash);
  });
});

describe('associação acessível dos campos compartilhados',()=>{
  it('gera identificadores distintos sem alterar valor e associa erro e ajuda',()=>{
    const html=renderToStaticMarkup(createElement(Fragment,null,
      createElement(Input,{label:'Descrição',value:'Mercado',readOnly:true,error:'Informe a descrição'}),
      createElement(Input,{label:'Valor',value:'123.45',readOnly:true,helpText:'Em reais'}),
      createElement(Select,{label:'Categoria',defaultValue:'Casa',helpText:'Escolha uma categoria'},createElement('option',{value:'Casa'},'Casa')),
    ));
    const labels=[...html.matchAll(/<label[^>]+for="([^"]+)"/g)].map(m=>m[1]);
    expect(labels).toHaveLength(3);
    expect(new Set(labels).size).toBe(3);
    for(const id of labels)expect(html).toContain(`id="${id}"`);
    expect(html).toContain(`aria-describedby="${labels[0]}-error"`);
    expect(html).toContain(`id="${labels[0]}-error"`);
    expect(html).toContain(`aria-describedby="${labels[1]}-help"`);
    expect(html).toContain(`aria-describedby="${labels[2]}-help"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('value="123.45"');
  });
  it('preserva ID explícito e a descrição acessível fornecida pelo consumidor',()=>{
    const html=renderToStaticMarkup(createElement(Input,{id:'original-id',label:'Valor','aria-describedby':'external-help',helpText:'Dica'}));
    expect(html).toContain('for="original-id"');
    expect(html).toContain('aria-describedby="external-help original-id-help"');
  });
});

describe('isolamento dos adaptadores financeiros',()=>{
  const css=postcss.parse(readFileSync('src/components/appearance/financial.css','utf8'));
  it('aplica cada regra somente no escopo Claro e em mídia de tela',()=>{
    css.walkRules(rule=>{
      for(const selector of rule.selectors)expect(selector.trim().startsWith('[data-finelo-theme="light"]')).toBe(true);
      let parent=rule.parent;
      let screen=false;
      while(parent){if(parent.type==='atrule'&&parent.name==='media'&&parent.params==='screen')screen=true;parent=parent.parent;}
      expect(screen).toBe(true);
    });
  });
  it('não modifica tipografia, dimensões, posicionamento ou paginação',()=>{
    const paint=new Set(['color','background-color','background-image','border-color','border-left-color','border-top-color','color-scheme','accent-color','opacity','outline','outline-offset','box-shadow','text-shadow']);
    css.walkDecls(declaration=>expect(declaration.prop.startsWith('--')||paint.has(declaration.prop)).toBe(true));
  });
});
