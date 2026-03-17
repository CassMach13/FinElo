-- Add DELETE policy for import_logs
create policy "Users can delete their own import logs"
  on public.import_logs for delete
  using (auth.uid() = user_id);
