-- 009_add_ticket_response.sql
-- Adiciona campo para resposta do admin

alter table support_tickets 
add column if not exists admin_response text;

-- Garante que o Admin possa fazer UPDATE nesse campo (já coberto pela policy 008, mas bom saber)
