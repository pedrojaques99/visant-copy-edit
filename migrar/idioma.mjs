/* Em que língua está um texto curto de interface, pt ou en? Sem IA e sem rede:
 * conta sinais e só responde "en" com folga. O caso que importa é o repo com
 * i18n de dois idiomas em que parte do JSX já foi escrita em inglês ("Reset
 * Password"): o `migrar` manda esse texto pro arquivo en e marca o pt como
 * "traduzir", em vez do contrário.
 *
 * Por que não `franc-min` (MIT, trigramas): em texto de botão ele não decide.
 * Abaixo de 10 caracteres devolve `und`, e com `minLength: 1` + `only: [eng,
 * por]` chamou de inglês 50 dos 473 textos pt-br do board ("Sobre", "Equipe";
 * a medição está no cabeçalho de test/idioma.test.mjs). Trigrama precisa de
 * frase; rótulo de botão tem duas palavras, e o que separa as duas línguas ali são palavras e acentos.
 *
 * Sinais, cada um vale ponto pro seu lado:
 *   · palavra funcional ou de interface que só existe numa das línguas
 *     (the/your/with/password × de/que/não/você/senha) — 2 pontos;
 *   · acento ou cedilha do pt (ç ã õ á é ê í ó ú â ô à) — 2 pontos pro pt;
 *   · terminação típica (-tion/-ing/-ness × -ção/-ões/-mente/-dade) — 1 ponto;
 *   · grafia que o pt quase não tem (th, w, k, y, sh, ck) × a que o en não
 *     tem (nh, lh) — 0,5 ponto.
 * Palavras ambíguas (no, a, as, do, me, ok, email, login, home) não contam.
 *
 * Decide "en" só se: 2+ palavras, en ≥ 2 e en − pt ≥ 2. O acento não veta
 * sozinho (frase inglesa longa com "clichés" é inglês), mas cada palavra
 * acentuada pesa 2 pro pt, então rótulo curto com acento fica no pt.
 * Todo o resto (palavra única, nome próprio, número, empate) é `null`: o
 * chamador trata como o idioma padrão, que era o comportamento de antes. */

const PT_ACENTO = /[çãõáéêíóúâôàÇÃÕÁÉÊÍÓÚÂÔÀ]/;

/* Funcionais + vocabulário de interface. Nada que exista nas duas línguas
   com o mesmo sentido ou grafia (no, a, as, do, me, email, login, home, menu,
   status, design, briefing, feedback, ok). */
const EN = new Set(
  `the and your you with for from this that these those are is was were will
  be been has have had not can't don't won't isn't it's we our us they their
  them what which who where when why how there here into about of to in on at
  by or if then than more less all any some each every new old my his her
  its one only also just very but up out off over under after before again
  password reset sign log forgot save cancel delete remove edit update create
  add search submit send back next previous loading view show hide close open
  upload download select choose enter confirm continue account profile settings
  welcome get started learn read see try sorry found page error something
  went wrong please click here copy copied share yes none empty start stop
  done finish complete completed pending active archived draft review details
  name title description date today yesterday tomorrow week month year
  day days hours minutes ago amount price paid unpaid invoice client
  clients project projects task tasks team member members owner assigned
  column note notes comment comments file files image images contact services about portfolio subscription drag drop rotate
  switch language explore scroll swipe sent received approve approved reject
  rejected filter sort clear apply manage generate generated retry refresh
  available unavailable required optional invalid valid success failed
  user users overview report reports activity history
  attach attachment attachments mark marked read unread free first still
  missing company privacy policy quick phone unique young like answer rush
  preferred preference style group invitation`.split(/\s+/),
);
const PT = new Set(
  `de do da dos das que não você vocês seu sua seus suas para pra pro com por
  um uma uns umas os em na nas nos é e ou mais menos como se ao aos à às mas
  já este esta esse essa isso isto aqui agora ainda quando onde porque quem
  qual quais muito muita pouco tudo todo toda todos todas nada sem sobre até
  entre depois antes também só ser ter está estão foi são fazer faz fica
  senha redefinir entrar sair esqueci salvar cancelar excluir apagar remover
  editar atualizar criar adicionar buscar procurar enviar voltar próximo
  anterior carregando ver mostrar esconder fechar abrir baixar escolher
  confirmar continuar conta perfil configurações bem-vindo vindo começar
  saiba leia desculpe encontrada página erro algo deu errado clique copiar
  copiado compartilhar sim nenhum nenhuma vazio feito concluído concluir
  pendente ativo arquivado rascunho revisar detalhes nome título descrição
  hora hoje ontem amanhã semana mês ano dia dias horas minutos atrás
  valor preço pago pagos fatura cliente clientes projeto projetos tarefa
  tarefas equipe membro membros dono responsável quadro coluna cartão
  nota notas comentário comentários arquivo arquivos imagem imagens contato
  serviços sobre assinatura arraste solte girar trocar idioma explorar
  deslize enviado recebido aprovar aprovado rejeitar filtrar ordenar limpar
  aplicar gerenciar gerar gerado tentar novamente atualizar disponível
  obrigatório opcional inválido válido sucesso falhou usuário usuários papel
  visão geral relatório histórico anexar anexo anexos marcar lido
  novo nova novos novas meu minha nosso nossa eles elas lhe ele ela`.split(/\s+/),
);

const FIM_EN = /(tion|tions|ing|ness|ment|ments|ship|able|ful|less|ed|ity|ize|ized|ies)$/;
const FIM_PT = /(ção|ções|ões|mente|dade|dades|agem|ância|ência|eiro|eira|oso|osa|ado|ada|ido|ida)$/;
const GRAFIA_EN = /(th|w|k|y|sh|ck)/;
const GRAFIA_PT = /(nh|lh)/;

export function pontuar(texto) {
  const limpo = String(texto || '')
    .replace(/\{[^}]*\}/g, ' ') // {nome}, {count, plural, ...}
    .replace(/<[^>]*>/g, ' ') // <b>…</b> do rich text
    .replace(/https?:\/\/\S+/g, ' ');
  const palavras = limpo.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ'’-]*/g) || [];
  let en = 0;
  let pt = 0;
  const acento = PT_ACENTO.test(limpo);
  for (const crua of palavras) {
    const w = crua.replace(/’/g, "'");
    if (PT_ACENTO.test(w)) pt += 2;
    if (EN.has(w)) en += 2;
    else if (PT.has(w)) pt += 2;
    else {
      if (w.length > 4 && FIM_PT.test(w)) pt += 1;
      else if (w.length > 4 && FIM_EN.test(w)) en += 1;
      if (GRAFIA_EN.test(w)) en += 0.5;
      if (GRAFIA_PT.test(w)) pt += 0.5;
    }
  }
  return { en, pt, palavras: palavras.length, acento };
}

/* 'en' com folga, ou null (= trate como o idioma padrão). */
export function detectarIdioma(texto) {
  const s = pontuar(texto);
  if (s.palavras < 2) return null;
  if (s.en >= 2 && s.en - s.pt >= 2) return 'en';
  return null;
}
