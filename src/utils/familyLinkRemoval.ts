/**
 * Remoção de um vínculo familiar (dono removendo membro ou membro saindo do plano).
 *
 * O PostgREST responde sem erro quando a RLS filtra o DELETE e nenhuma linha é afetada. Pedir as linhas
 * removidas (`select('id')`) permite distinguir "removeu 1 vínculo" de "nada foi removido".
 */
export type FamilyLinkRemovalResult =
  | { status: 'removed' }
  | { status: 'not_removed' }
  | { status: 'error'; message: string };

interface DeleteReturningBuilder {
  delete(): {
    eq(column: string, value: string): {
      select(columns: string): PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>;
    };
  };
}

export interface FamilyLinkRemovalClient {
  from(table: 'family_members'): DeleteReturningBuilder;
}

export async function removeFamilyLink(client: FamilyLinkRemovalClient, linkId: string): Promise<FamilyLinkRemovalResult> {
  try {
    const { data, error } = await client.from('family_members').delete().eq('id', linkId).select('id');
    if (error) return { status: 'error', message: error.message };
    return Array.isArray(data) && data.length === 1 ? { status: 'removed' } : { status: 'not_removed' };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
