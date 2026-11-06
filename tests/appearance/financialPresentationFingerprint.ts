import { createHash } from 'node:crypto';
import ts from 'typescript';

/** Normalize only the reviewed presentation additions, keeping the original implementation. */
export function financialImplementationFingerprint(path: string, source: string, additionalAttributes: readonly string[] = [], additionalComponents: readonly string[] = []) {
  if(path==='src/layouts/MainLayout.tsx')additionalComponents=[...additionalComponents,'RemainingAppearanceBridge'];
  const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const presentation=new Set(['manageFocus','tabIndex','role','aria-label','onKeyDown','onFocus',...additionalAttributes]);
  const result=ts.transform(ast,[context=>root=>{
    const visit:ts.Visitor=node=>{
      if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&(node.moduleSpecifier.text.endsWith('/appearance/financial.css')||node.moduleSpecifier.text.endsWith('/appearance/remaining.css')))return undefined;
      if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&additionalComponents.some(name=>(node.moduleSpecifier as ts.StringLiteral).text.endsWith('/'+name)))return undefined;
      if(ts.isJsxSelfClosingElement(node)&&additionalComponents.includes(node.tagName.getText(ast)))return undefined;
      if(ts.isJsxAttribute(node)&&(node.name.getText(ast).startsWith('data-finance')||presentation.has(node.name.getText(ast))))return undefined;
      return ts.visitEachChild(node,visit,context);
    };
    return ts.visitNode(root,visit) as ts.SourceFile;
  }]);
  const normalized=ts.createPrinter({removeComments:true}).printFile(result.transformed[0]).replace(/\s+/g,'');
  result.dispose();
  return createHash('sha256').update(normalized).digest('hex');
}
