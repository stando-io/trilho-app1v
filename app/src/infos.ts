export type ReleaseNoteKind = 'novo' | 'melhoria' | 'correcao';

export interface ReleaseNote {
  kind: ReleaseNoteKind;
  text: string;
}

export interface Release {
  version: string;
  date: string;
  notes: ReleaseNote[];
}

export const APP_BADGE = 'Trilho App — v1.0.7 (Build 2026.10)';

export const RELEASE_NOTE_LABELS: Record<ReleaseNoteKind, string> = {
  novo: 'Novo',
  melhoria: 'Melhoria',
  correcao: 'Correção',
};

export const RELEASES: Release[] = [
  {
    version: '1.0.7',
    date: 'Outubro de 2026',
    notes: [
      {
        kind: 'melhoria',
        text: 'Card de criação na Base com formulário próprio de setor/departamento, conteúdo centralizado e mais espaço para os textos.',
      },
      {
        kind: 'melhoria',
        text: 'Senha de Escopo renomeada para Senha de Segurança em todo o sistema.',
      },
      {
        kind: 'correcao',
        text: 'Olho duplicado removido e olho nativo alinhado à direita nos campos de senha.',
      },
    ],
  },
  {
    version: '1.0.6',
    date: 'Outubro de 2026',
    notes: [
      {
        kind: 'novo',
        text: 'Gráfico do Dashboard com escala semanal, cobrindo as semanas do projeto até hoje.',
      },
      {
        kind: 'melhoria',
        text: 'Barra de progresso com gradiente.',
      },
      {
        kind: 'melhoria',
        text: 'Painel de Índice de Aprendizado com título simplificado e balão de ajuda ao passar o mouse.',
      },
    ],
  },
  {
    version: '1.0.5',
    date: 'Outubro de 2026',
    notes: [
      {
        kind: 'novo',
        text: 'Assistente de novo projeto com salvar como rascunho, montagem manual da base e importação de planilha XLSX/CSV.',
      },
      {
        kind: 'novo',
        text: 'Botão Baixar planilha modelo na tela Início, com permissão própria em Níveis de Acesso.',
      },
      {
        kind: 'novo',
        text: 'Concluir, reabrir e excluir projetos com justificativa registrada na auditoria e avisos de confirmação.',
      },
      {
        kind: 'novo',
        text: 'Papel no projeto separado do cargo global, editável no modal do projeto por membro da equipe.',
      },
      {
        kind: 'melhoria',
        text: 'Toast de confirmação ao criar projeto e escolhas do assistente em uma única linha.',
      },
    ],
  },
  {
    version: '1.0.4',
    date: 'Outubro de 2026',
    notes: [
      {
        kind: 'novo',
        text: 'Senha de escopo pedida por ação nas áreas Início, Dashboard e Quadro, sem guardar a senha entre ações.',
      },
      {
        kind: 'novo',
        text: 'Limites de caracteres configuráveis para título e descrição dos cards, com contador e bloqueio no modal.',
      },
      {
        kind: 'novo',
        text: 'Sub-tarefa mostra a linha do pai com navegação direta e alerta de pendência.',
      },
      {
        kind: 'novo',
        text: 'Tela de carregamento animada (trem no trilho) nos carregamentos de dados.',
      },
      {
        kind: 'melhoria',
        text: 'Controle de notificações em Parâmetros: escolha quais eventos geram notificação.',
      },
      {
        kind: 'melhoria',
        text: 'Carregamento só exibe a tela quando passa de 350ms, sem piscadas em trocas rápidas de aba e filtros.',
      },
      {
        kind: 'melhoria',
        text: 'Painéis do Dashboard com altura de 450px.',
      },
    ],
  },
  {
    version: '1.0.3',
    date: 'Outubro de 2026',
    notes: [
      {
        kind: 'novo',
        text: 'Central de notificações com sino no cabeçalho: menções e atualizações chegam em tempo real, com navegação direta pela menção.',
      },
      {
        kind: 'novo',
        text: 'Chave global em Parâmetros para ativar ou desativar a exigência de senha de escopo em ações sensíveis.',
      },
      {
        kind: 'correcao',
        text: 'Modo mobile ativado a partir de 1050px, corrigindo a exibição em telas de iPad.',
      },
    ],
  },
  {
    version: '1.0.2',
    date: 'Outubro de 2026',
    notes: [
      {
        kind: 'novo',
        text: 'Galeria de imagens no card: anexar, renomear, excluir e reordenar arrastando as miniaturas.',
      },
      {
        kind: 'novo',
        text: 'Menção #Imagem na descrição e @pessoa nos comentários: cite a imagem com # ou mencione uma pessoa com @ para notificá-la.',
      },
      {
        kind: 'novo',
        text: 'Relatório de Índice de Aprendizado em Relatórios, com notas por setor e faixas de desempenho.',
      },
      {
        kind: 'novo',
        text: 'Seletor de itens por página nas tabelas do Dashboard, Relatórios e Configurações.',
      },
      {
        kind: 'melhoria',
        text: 'Card de avaliações ajustado e relatório de avaliações incluído na exportação.',
      },
      {
        kind: 'melhoria',
        text: 'Toolbar dos Relatórios padronizada com a do Quadro.',
      },
      {
        kind: 'melhoria',
        text: 'Novo visual nos cabeçalhos das colunas do Quadro.',
      },
      {
        kind: 'melhoria',
        text: 'Área de anexos do card liberada após o primeiro salvamento, com aviso para salvar antes de anexar.',
      },
      {
        kind: 'correcao',
        text: 'Contador de anexos do card sincronizado ao adicionar ou remover imagens.',
      },
      {
        kind: 'correcao',
        text: 'Menção citada preservada após salvar e reabrir o card.',
      },
    ],
  },
  {
    version: '1.0.1',
    date: 'Outubro de 2026',
    notes: [
      { kind: 'novo', text: 'Card rico no Kanban com responsáveis, anexos, comentários e contadores.' },
      { kind: 'novo', text: 'Índice de aprendizado por setor no Dashboard.' },
      { kind: 'melhoria', text: 'Espaçamento reduzido entre cards e painéis em todo o sistema.' },
      { kind: 'melhoria', text: 'Cabeçalho com menu centralizado e ajustes no layout mobile.' },
      { kind: 'correcao', text: 'Avatares removidos dos modais e cabeçalhos corrigidos em Configurações.' },
    ],
  },
  {
    version: '1.0.0',
    date: 'Outubro de 2026',
    notes: [
      { kind: 'novo', text: 'Gestão de projetos com quadro Kanban, base de dados e relatórios.' },
      {
        kind: 'novo',
        text: 'Permissões por níveis de acesso, cargos, usuários e auditoria.',
      },
      {
        kind: 'novo',
        text: 'Preferências globais de visualização: quadro, lista, calendário e tabela.',
      },
      { kind: 'novo', text: 'Opção Sem atalho para ocultar o bloco Acesso rápido.' },
      { kind: 'melhoria', text: 'Acesso rápido compacto na coluna do calendário do Início.' },
      { kind: 'correcao', text: 'Cabeçalho do calendário do Início alinhado às colunas de tarefas.' },
    ],
  },
];

export interface ManualItem {
  id: string;
  title: string;
}

export const MANUALS: ManualItem[] = [
  { id: 'kanban', title: 'Manual do Quadro' },
  { id: 'base', title: 'Manual da Base de Dados' },
  { id: 'relatorios', title: 'Manual de Relatórios' },
  { id: 'permissoes', title: 'Manual de Permissões' },
  { id: 'configuracoes', title: 'Manual de Configurações' },
];

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'Como redefino minha senha?',
    answer:
      'Em Configurações > Minha Conta, use Alterar senha informando a senha atual e a nova senha.',
  },
  {
    question: 'Como vincular projetos a um usuário?',
    answer: 'Em Configurações > Usuários, edite o usuário e selecione os projetos dele.',
  },
  {
    question: 'Como configuro permissões?',
    answer:
      'Em Configurações > Níveis de Acesso, edite um nível e marque as telas e ações liberadas; depois atribua o nível ao usuário em Usuários.',
  },
  {
    question: 'Como crio um novo card no Quadro?',
    answer:
      'Na tela Quadro, clique em "+ Novo Card" no topo da coluna ou no botão "Novo Card" à direita da barra de ferramentas.',
  },
  {
    question: 'O que faz o botão Assumir em um card?',
    answer:
      'Marca você como responsável pelo card. Clique novamente para remover sua atribuição.',
  },
  {
    question: 'Como filtro cards no Quadro?',
    answer:
      'Use o campo "Buscar card" para pesquisa rápida ou o botão "Filtros" para refinar por responsável, prioridade e outros critérios.',
  },
  {
    question: 'O que é o Índice de Aprendizado?',
    answer:
      'Métrica de 0 a 10 exibida no Dashboard que mostra a média das notas por setor, com legenda de faixas (crítico, parcial, bom).',
  },
  {
    question: 'Como altero a visualização dos cards?',
    answer:
      'No topo do Quadro, use os botões Kanban, Lista, Calendário e Gantt para alternar entre as visões.',
  },
  {
    question: 'Como anexo imagens em um card?',
    answer:
      'Abra um card salvo e arraste a imagem para a área de envio ou clique no botão Imagem da barra de ferramentas. As imagens ficam na galeria abaixo, com opções para abrir, renomear e excluir cada uma.',
  },
  {
    question: 'Como cito uma imagem ou menciono alguém no card?',
    answer:
      'Digite # na descrição ou no comentário e escolha a imagem na lista. Para mencionar uma pessoa e notificá-la, digite @ e escolha o membro do projeto.',
  },
  {
    question: 'Como reordeno as imagens anexadas?',
    answer:
      'Arraste a miniatura na galeria até a posição desejada. A numeração #Imagem N e as menções já criadas são atualizadas automaticamente.',
  },
];
