/** Exact UI lifetime exceptions; every other handler and legacy class remains fingerprinted. */
export function remainingSessionPresentation(file: string, source: string): string {
 if(file==='src/App.tsx')return source.replace('<MainLayout key={user?.id} />','<MainLayout />');
 if(file==='src/components/help/HelpCenterBrowse.tsx')return source
  .replace('aria-controls={`help-topic-body-${topic.id}`}','')
  .replace('aria-controls="help-credit-card-guide-body"','');
 if(file==='src/components/modals/TermsModal.tsx'){
  const pairs: Array<[string,string]>=[["import React, { useEffect, useRef, useState }", "import React, { useEffect, useState }"], ["import { persistUserMetadata, supabase }", "import { supabase }"], ["\n    // The account-keyed shell owns this consent dialog and its pending return.\n    const mounted = useRef(true);\n    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);", ""], ["            const { data: { session }, error } = await supabase.auth.getSession();\n            if (error) throw error;\n            if (!mounted.current || session?.user.id !== user.id || useAppStore.getState().user?.id !== user.id) return;\n            await persistUserMetadata(session.access_token, { terms_accepted_version: CURRENT_TERMS_VERSION });\n            if (!mounted.current || useAppStore.getState().user?.id !== user.id) return;\n            const currentUser = useAppStore.getState().user!;\n            useAppStore.getState().setUser({ ...currentUser, user_metadata: { ...currentUser.user_metadata, terms_accepted_version: CURRENT_TERMS_VERSION } });", "            const { error } = await supabase.auth.updateUser({\n                data: { terms_accepted_version: CURRENT_TERMS_VERSION }\n            });\n\n            if (error) throw error;"], ["            if (!mounted.current) return;\n            console.error('Error accepting terms:', err);", "            console.error('Error accepting terms:', err);"], ["            if (mounted.current) setLoading(false);", "            setLoading(false);"]];
  let result=source.replaceAll('\r\n','\n');for(const[after,before]of pairs){if(result.split(after).length!==2)throw new Error('Unexpected consent ownership change');result=result.replace(after,before)}return result;
 }
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
