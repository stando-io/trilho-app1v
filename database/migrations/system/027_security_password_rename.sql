-- 027_security_password_rename.sql
-- Renomeia "Senha de escopo" para "Senha de Seguranca": colunas do schema
-- e dados gravados (permissoes, chaves de notificacao e acoes de auditoria).

-- Colunas de system_settings
ALTER TABLE system_settings RENAME COLUMN scope_password_hash TO security_password_hash;
ALTER TABLE system_settings RENAME COLUMN scope_password_hint TO security_password_hint;
ALTER TABLE system_settings RENAME COLUMN scope_gate_all TO security_gate_all;
ALTER TABLE system_settings RENAME COLUMN scope_gate_base TO security_gate_base;
ALTER TABLE system_settings RENAME COLUMN scope_gate_users TO security_gate_users;
ALTER TABLE system_settings RENAME COLUMN scope_gate_settings TO security_gate_settings;
ALTER TABLE system_settings RENAME COLUMN scope_gate_integrations TO security_gate_integrations;
ALTER TABLE system_settings RENAME COLUMN scope_gate_home TO security_gate_home;
ALTER TABLE system_settings RENAME COLUMN scope_gate_dashboard TO security_gate_dashboard;
ALTER TABLE system_settings RENAME COLUMN scope_gate_board TO security_gate_board;

-- Permissoes gravadas nos perfis (array de strings, preservando a ordem)
UPDATE profiles
SET permissions = (
  SELECT jsonb_agg(
    CASE
      WHEN value = to_jsonb('settings.escopo'::text)
        THEN to_jsonb('settings.seguranca'::text)
      ELSE value
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(permissions) WITH ORDINALITY AS item(value, ord)
)
WHERE permissions ? 'settings.escopo';

-- Chave da preferencia global de notificacao
UPDATE system_settings
SET notification_prefs =
  (notification_prefs - 'scope_password_changed')
  || jsonb_build_object(
    'security_password_changed',
    COALESCE(notification_prefs -> 'scope_password_changed', 'true')
  )
WHERE notification_prefs ? 'scope_password_changed';

-- Tipo das notificacoes ja registradas (titulo/corpo antigos sao preservados)
UPDATE notifications
SET type = 'security_password_changed'
WHERE type = 'scope_password_changed';

-- Acoes de auditoria (labels exibidos no modulo de Auditoria)
UPDATE audit_logs SET action = 'security_password_set' WHERE action = 'scope_password_set';
UPDATE audit_logs SET action = 'security_password_deleted' WHERE action = 'scope_password_deleted';
UPDATE audit_logs SET action = 'security_gate_toggled' WHERE action = 'scope_gate_toggled';
UPDATE audit_logs SET action = 'security_gate_all_toggled' WHERE action = 'scope_gate_all_toggled';
