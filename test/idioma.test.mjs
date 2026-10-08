/* Detecção de texto em inglês no JSX (migrar/idioma.mjs), medida em casos
 * reais curtos do board e do Club: botão, rótulo, título, placeholder.
 *
 * O que importa é a ASSIMETRIA: chamar pt de "en" manda o texto da casa pro
 * en.ts e pede tradução do que já está certo (pior que hoje); não reconhecer
 * um "en" só repete o comportamento antigo. Por isso a régua é: zero pt
 * marcado como en, e acerto em inglês de 2+ palavras acima do piso.
 *
 * Medição de 2026-10-08 com as 473 duplas en/pt que diferem nos locales do
 * board + 986 textos do Club (copy/*.json): heurística 0 pt→en errado, 85,9%
 * do en de 2+ palavras; franc-min 6.2 (only eng/por, minLength 1) marcou 50 dos
 * 473 pt como inglês ("Sobre", "Equipe", "Ver a nota"), e com o minLength
 * padrão (10) devolve `und` pra quase todo botão. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarIdioma } from '../migrar/idioma.mjs';

/* Inglês que existe no JSX ou no en.ts do board. */
const EN = [
  'Reset Password', 'Forgot your password?', 'Sign in with Google', 'Back to Home', 'Show details',
  'Page not found', "Sorry, we couldn't find the page you're looking for.", 'Loading 3D Universe...',
  'Click the arrows to navigate between projects', 'Drag to rotate', 'Switch language', 'Scroll or swipe to explore',
  'Save changes', 'Delete project', 'Add new task', 'No tasks yet', 'Upload a file', 'Mark as paid',
  'Search clients...', 'Create invoice', 'Something went wrong', 'Try again', 'Privacy Policy', 'Quick Links',
  'Still missing:', 'No rush', 'free, no signup', 'Preferred logo style', 'Company Data', 'Final refinement',
  'Every project requires market research, competitor analysis, target audience study, and current trends.',
  'Assigned to me', 'Due this week', 'Open in a new tab', 'Copy link', 'Send invitation',
];
/* pt da casa, inclusive o que parece inglês por estrangeirismo. */
const PT = [
  'Esqueci a senha', 'Redefinir senha', 'Voltar pro início', 'Ver detalhes', 'Página não encontrada',
  'Carregando Universo 3D...', 'Sobre', 'Sobre Nós', 'Nossa História', 'Equipe', 'Marcas', 'Ver a nota',
  'Você cresce', 'Começar Briefing', 'Ex: Visant Digital', 'WhatsApp / Telefone', 'Salvar alterações',
  'Fale com a gente', 'Quem somos', 'Seu e-mail', 'Enviar agora', 'Bem-vindo de volta', 'Abrir no Figma',
  'Mockup do cliente', 'Briefing da marca', 'Design de embalagem', 'Social media', 'Fora da estante',
  'Assine o Club', 'Entrar no Club', 'Comece por aqui', 'Baixar o kit', 'Aula em breve', 'Ver todos',
  'Branding completo', 'Landing page nova', 'Feedback do cliente', 'Deadline amanhã',
];
/* Ambíguo: palavra única, nome próprio, número. Tem que ser null (= padrão). */
const AMBIGUO = ['OK', 'Email', 'Home', 'Login', 'Portfolio', 'Visant Labs', 'Visant Club', 'Next', '2026', 'R$ 49,90', 'Figma', 'Dashboard', 'Status', 'Design Ops'];

test('idioma: nenhum texto em pt é chamado de inglês', () => {
  const errados = PT.filter((t) => detectarIdioma(t) === 'en');
  assert.deepEqual(errados, []);
});

test('idioma: ambíguo fica com o idioma padrão (null)', () => {
  assert.deepEqual(AMBIGUO.filter((t) => detectarIdioma(t) !== null), []);
});

test('idioma: acerta o inglês curto de interface acima do piso', () => {
  const perdidos = EN.filter((t) => detectarIdioma(t) !== 'en');
  const taxa = (EN.length - perdidos.length) / EN.length;
  console.log(`  idioma: en ${EN.length - perdidos.length}/${EN.length} (${(taxa * 100).toFixed(0)}%), pt→en 0/${PT.length}, ambíguo→null ${AMBIGUO.length}/${AMBIGUO.length}${perdidos.length ? `; perdidos: ${perdidos.join(' | ')}` : ''}`);
  assert.ok(taxa >= 0.9, `acerto ${taxa}`);
});
