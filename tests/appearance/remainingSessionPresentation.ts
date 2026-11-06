/** Exact UI lifetime exceptions; every other handler and legacy class remains fingerprinted. */
export function remainingSessionPresentation(file: string, source: string): string {
 if(file==='src/App.tsx')return source.replace('<MainLayout key={user?.id} />','<MainLayout />');
 if(file==='src/components/help/HelpCenterBrowse.tsx')return source
  .replace('aria-controls={`help-topic-body-${topic.id}`}','')
  .replace('aria-controls="help-credit-card-guide-body"','');
 if(file!=='src/components/support/SupportAttachmentLink.tsx')return source;
 const pairs=[
  ["import React, { useEffect, useMemo, useRef, useState } from 'react';","import React, { useMemo, useState } from 'react';"],
  ["  // The authenticated shell remounts by account. Only a pending blank window is owned here.\n  const mounted = useRef(true);\n  const pendingWindow = useRef<Window | null>(null);\n  useEffect(() => {\n    mounted.current = true;\n    return () => { mounted.current = false; pendingWindow.current?.close(); };\n  }, []);\n",''],
  ['    pendingWindow.current = targetWindow;\n',''],
  ['      if (!mounted.current) { targetWindow?.close(); return; }\n',''],
  ['      if (!mounted.current) return;\n',''],
  ['      pendingWindow.current = null;\n      if (mounted.current) setIsOpening(false);','      setIsOpening(false);'],
 ];
 let original=source.replaceAll('\r\n','\n');
 for(const [addition,before]of pairs){
  if(original.split(addition).length!==2)throw new Error('Unexpected attachment session guard change');
  original=original.replace(addition,before);
 }
 return original;
}
