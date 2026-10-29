-- 028_security_audit_fix.sql
-- Complementa a 027: acao historica de auditoria ainda nao renomeada e
-- protecao idempotente da chave de notificacao (ambientes contaminados
-- por versoes antigas do frontend em hot-reload).

UPDATE audit_logs
SET action = 'security_password_toggled'
WHERE action = 'scope_password_toggled';

UPDATE system_settings
SET notification_prefs =
  (notification_prefs - 'scope_password_changed')
  || jsonb_build_object(
    'security_password_changed',
    COALESCE(notification_prefs -> 'scope_password_changed', 'true')
  )
WHERE notification_prefs ? 'scope_password_changed';
