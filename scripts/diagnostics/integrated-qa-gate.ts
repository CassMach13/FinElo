/** Diagnostic entry only. The normal index/App never imports this module. */
export function isIntegratedQaAllowed(mode:string,flag:string|undefined,hostname:string,backend:string){
 return mode==='staging'&&flag==='true'&&['127.0.0.1','localhost','[::1]'].includes(hostname)&&backend==='https://integrated-fixture.invalid';
}
