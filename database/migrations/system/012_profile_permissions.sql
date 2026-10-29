-- Permissoes granulares por acao nos niveis de acesso.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: perfis existentes ganham todas as acoes dos modulos que ja possuem
-- (comportamento anterior: quem tem a tela pode executar todas as acoes dela).
DO $$
DECLARE
  prof RECORD;
  leaves jsonb;
BEGIN
  FOR prof IN SELECT id, screens FROM profiles LOOP
    leaves := '[]'::jsonb;
    IF prof.screens ? 'home' THEN
      leaves := leaves || '["home.novo_projeto","home.registrar_calendario","home.registrar_agenda"]'::jsonb;
    END IF;
    IF prof.screens ? 'dashboard' THEN
      leaves := leaves || '["dashboard.ver_relatorio_detalhado","dashboard.projetos_recentes.editar","dashboard.projetos_recentes.excluir"]'::jsonb;
    END IF;
    IF prof.screens ? 'base' THEN
      leaves := leaves || '["base.novo_registro","base.acoes.editar","base.acoes.excluir"]'::jsonb;
    END IF;
    IF prof.screens ? 'kanban' THEN
      leaves := leaves || '["kanban.visualizar","kanban.criar_cards","kanban.editar_cards","kanban.mover_cards","kanban.excluir_cards"]'::jsonb;
    END IF;
    IF prof.screens ? 'reports' THEN
      leaves := leaves || '["reports.visualizar","reports.filtrar","reports.exportar"]'::jsonb;
    END IF;
    IF prof.screens ? 'settings' THEN
      leaves := leaves || '["settings.minha_conta","settings.usuarios.novo","settings.usuarios.editar","settings.usuarios.excluir","settings.cargos.novo","settings.cargos.editar","settings.cargos.excluir","settings.niveis.novo","settings.niveis.editar","settings.niveis.excluir","settings.temas","settings.escopo","settings.integracoes","settings.auditoria"]'::jsonb;
    END IF;
    UPDATE profiles SET permissions = leaves WHERE id = prof.id;
  END LOOP;
END $$;
