/** Test-only inverse of an exact unified diff; fails on any unexpected changed line. */
export function reverseSessionPatch(source: string, patch: string, file: string): string {
 const marker=`--- a/${file}\n+++ b/${file}\n`;
 const section=patch.replaceAll('\r\n','\n').split(marker)[1]?.split('\n--- a/')[0];
 if(!section)throw new Error('Approved patch section missing');
 const lines=source.replaceAll('\r\n','\n').split('\n'),out:string[]=[];let cursor=0;
 for(const hunk of section.split(/^@@ /m).slice(1)){
  const rows=hunk.split('\n'),header=rows.shift()!;const start=Number(header.match(/\+(\d+)/)![1])-1;
  out.push(...lines.slice(cursor,start));cursor=start;
  for(const row of rows){
   if(!row||row.startsWith('\\'))continue;
   if(row[0]===' '||row[0]==='+'){if(lines[cursor++]!==row.slice(1))throw new Error('Unexpected line outside the authorized exception');}
   if(row[0]===' '||row[0]==='-')out.push(row.slice(1));
  }
 }
 out.push(...lines.slice(cursor));return out.join('\n');
}
