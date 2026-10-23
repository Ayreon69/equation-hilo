// Règles illustrées + bac à sable pour s'entraîner à construire des équations.
import { Lightbulb, RefreshCw, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { NumberCard, Op, createDeck, shuffle } from '../../../shared/cards';
import { defaultArrangement, formatEquation, formatNumber, isRounded, solveHand } from '../../../shared/equation';
import { useStore } from '../store';
import { CardBack, DeclBadge, EqText, NumCard, OpTile, SymbolCard } from './Cards';
import { BuilderHand, BuilderValue, EquationBuilder, builderFrom } from './EquationBuilder';
import { Sheet } from './Ui';

const SECTIONS = [
  ['bref', 'En bref'],
  ['cartes', 'Les cartes'],
  ['manche', 'Une manche'],
  ['calcul', 'Calculer'],
  ['gagner', 'Gagner'],
  ['miser', 'Miser'],
  ['astuces', 'Astuces'],
  ['sandbox', 'S’entraîner'],
] as const;

const card = (value: number, suit: NumberCard['suit']): NumberCard => ({ id: `ex-${suit}-${value}`, kind: 'num', value, suit });

function randomHand(): BuilderHand {
  const deck = shuffle(createDeck()).filter((c): c is NumberCard => c.kind === 'num');
  const nums = deck.slice(0, 4);
  const ops: Op[] = ['+', '-', '/'];
  if (Math.random() < 0.35) ops[Math.random() < 0.5 ? 0 : 1] = '*';
  const roots = Math.random() < 0.3 ? 1 : 0;
  return { nums, ops, roots };
}

function Sandbox() {
  const [hand, setHand] = useState<BuilderHand>(() => randomHand());
  const [value, setValue] = useState<BuilderValue>(() => {
    const d = defaultArrangement(hand);
    return builderFrom({ high: d, low: d });
  });
  const [showSolution, setShowSolution] = useState(false);
  const solution = useMemo(() => solveHand(hand, 1), [hand]);

  const fresh = () => {
    const h = randomHand();
    const d = defaultArrangement(h);
    setHand(h);
    setValue(builderFrom({ high: d, low: d }));
    setShowSolution(false);
  };

  return (
    <div className="sandbox">
      <EquationBuilder hand={hand} value={value} onChange={setValue} size="md" />
      <div className="sandbox-actions">
        <button type="button" className="btn btn-ghost" onClick={fresh}>
          <RefreshCw size={16} /> Nouvelle main
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setShowSolution((s) => !s)}>
          <Lightbulb size={16} /> {showSolution ? 'Masquer' : 'Voir'} la meilleure solution
        </button>
      </div>
      {showSolution && (
        <div className="sandbox-solution">
          {solution.high[0] && (
            <p>
              <span className="tag-high">High</span> <EqText text={formatEquation(solution.high[0].arr, hand.nums)} />{' '}
              {isRounded(solution.high[0].value) ? '≈' : '='} <b>{formatNumber(solution.high[0].value)}</b>
            </p>
          )}
          {solution.low[0] && (
            <p>
              <span className="tag-low">Low</span> <EqText text={formatEquation(solution.low[0].arr, hand.nums)} />{' '}
              {isRounded(solution.low[0].value) ? '≈' : '='} <b>{formatNumber(solution.low[0].value)}</b>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function RulesSheet() {
  const open = useStore((s) => s.rulesOpen);
  const setOpen = useStore((s) => s.setRulesOpen);
  const markSeen = useStore((s) => s.markTutorialSeen);
  const bodyRef = useRef<HTMLDivElement>(null);

  const goto = (id: string) => {
    const el = bodyRef.current?.querySelector(`#rule-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const close = () => {
    markSeen();
    setOpen(false);
  };

  return (
    <Sheet open={open} onClose={close} className="rules-sheet" label="Règles du jeu">
      <header className="rules-head">
        <p className="eyebrow">Règles du jeu</p>
        <h2>
          Vise <span className="t-high">20</span> ou <span className="t-low">1</span>. Mise. Bluffe.
        </h2>
        <nav className="rules-nav" aria-label="Sections des règles">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" className="chip-link" onClick={() => goto(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="rules-body" ref={bodyRef}>
        <section id="rule-bref">
          <h3>En bref</h3>
          <ol className="rule-steps">
            <li>
              <b>Tu reçois 4 chiffres</b> (dont 1 caché que toi seul vois) et 3 opérateurs : <b>+ − ÷</b>.
            </li>
            <li>
              <b>Tu ranges tout en une équation</b> pour approcher <span className="t-high">20</span> (High) ou{' '}
              <span className="t-low">1</span> (Low).
            </li>
            <li>
              <b>Tu mises</b> comme au poker, puis tu déclares <b>en secret</b> ton camp.
            </li>
            <li>
              <b>Le plus proche de 20</b> et <b>le plus proche de 1</b> se partagent le pot. Sans jetons, tu es éliminé.
            </li>
          </ol>
        </section>

        <section id="rule-cartes">
          <h3>Les cartes</h3>
          <p>Chiffres de 0 à 10 en quatre couleurs. La couleur ne sert qu’à départager les égalités :</p>
          <div className="rule-cards">
            <NumCard card={card(7, 'gold')} size="md" />
            <span className="gt">&gt;</span>
            <NumCard card={card(7, 'silver')} size="md" />
            <span className="gt">&gt;</span>
            <NumCard card={card(7, 'bronze')} size="md" />
            <span className="gt">&gt;</span>
            <NumCard card={card(7, 'black')} size="md" />
          </div>
          <p className="rule-caption">Or &gt; Argent &gt; Bronze &gt; Noir</p>
          <div className="rule-specials">
            <div>
              <div className="rule-cards">
                <OpTile op="+" />
                <OpTile op="-" />
                <OpTile op="/" />
              </div>
              <p>Tout le monde a ces trois opérateurs à chaque manche.</p>
            </div>
            <div>
              <div className="rule-cards">
                <SymbolCard kind="mul" size="md" />
              </div>
              <p>
                <b>×</b> : tu le gardes, mais tu défausses le <b>+</b> ou le <b>−</b> (jamais le ÷). Tu pioches un chiffre en plus.
              </p>
            </div>
            <div>
              <div className="rule-cards">
                <SymbolCard kind="root" size="md" />
              </div>
              <p>
                <b>√</b> : bonus ! Tu le poses sur un de tes chiffres, et tu pioches un chiffre en plus.
              </p>
            </div>
            <div>
              <div className="rule-cards">
                <CardBack size="md" />
              </div>
              <p>Ta carte cachée : les autres ne la découvrent qu’à la révélation.</p>
            </div>
          </div>
        </section>

        <section id="rule-manche">
          <h3>Une manche</h3>
          <ol className="timeline">
            <li>
              <b>Mise de départ</b> : 1 jeton chacun dans le pot.
            </li>
            <li>
              <b>Distribution</b> : 1 carte cachée + 2 cartes visibles.
            </li>
            <li>
              <b>Enchères n°1</b> : ta main n’est pas complète, estime ton potentiel.
            </li>
            <li>
              <b>4ᵉ carte</b> visible pour chacun.
            </li>
            <li>
              <b>Équations</b> : 90 secondes pour préparer ta meilleure équation « 20 » et ta meilleure « 1 ».
            </li>
            <li>
              <b>Enchères n°2</b> : dernière occasion de miser (ou de bluffer).
            </li>
            <li>
              <b>Déclaration secrète</b> : <DeclBadge decl="high" /> <DeclBadge decl="low" /> ou <DeclBadge decl="swing" />
            </li>
            <li>
              <b>Révélation</b> : on compare, le pot est partagé.
            </li>
          </ol>
        </section>

        <section id="rule-calcul">
          <h3>Calculer</h3>
          <ul className="rule-list">
            <li>
              Tu dois utiliser <b>toutes</b> tes cartes, chacune une seule fois.
            </li>
            <li>
              <b>× et ÷ passent avant + et −</b>, comme en maths. Pas de parenthèses.
            </li>
            <li>
              Un <b>√</b> s’applique à un seul chiffre. Diviser par 0 est interdit.
            </li>
            <li>Les résultats à virgule ou négatifs sont permis : c’est l’écart à la cible qui compte.</li>
          </ul>
          <div className="examples">
            <p>
              <span className="tag-low">Low</span> 8 ÷ 4 − 1 + 0 = <b>1</b> <em>parfait !</em>
            </p>
            <p>
              <span className="tag-high">High</span> 10 × 2 − 8 ÷ 10 = <b>19,2</b> <em>écart 0,8</em>
            </p>
            <p>
              <span className="tag-high">High</span> 10 + √5 × 8 ÷ 2 ≈ <b>18,94</b> <em>écart 1,06</em>
            </p>
          </div>
        </section>

        <section id="rule-gagner">
          <h3>Gagner</h3>
          <ul className="rule-list">
            <li>
              <DeclBadge decl="high" /> : le plus proche de 20 parmi les High gagne <b>la moitié du pot</b>.
            </li>
            <li>
              <DeclBadge decl="low" /> : le plus proche de 1 parmi les Low gagne <b>l’autre moitié</b>.
            </li>
            <li>Si tout le monde joue le même côté, le gagnant rafle tout. Un pot impair : le jeton restant est brûlé.</li>
            <li>
              <DeclBadge decl="swing" /> : tu présentes tes deux équations et dois gagner <b>des deux côtés</b> pour tout rafler. Si tu
              perds d’un seul côté, tu ne touches rien et celui qui t’a battu rafle tout le pot !
            </li>
            <li>
              Égalité : en High, la plus grosse carte gagne ; en Low, la plus petite. Même chiffre ? La couleur départage (en Low, la
              plus faible gagne).
            </li>
          </ul>
        </section>

        <section id="rule-miser">
          <h3>Miser</h3>
          <dl className="glossary">
            <dt>Parole</dt>
            <dd>Tu passes sans miser (possible tant que personne n’a misé).</dd>
            <dt>Miser / Relancer</dt>
            <dd>Tu mets des jetons ; les autres doivent suivre ou se coucher.</dd>
            <dt>Suivre</dt>
            <dd>Tu égalises la mise en cours.</dd>
            <dt>Se coucher</dt>
            <dd>Tu abandonnes la manche et les jetons déjà misés.</dd>
            <dt>Plafond</dt>
            <dd>Personne ne peut engager plus que le plus petit tapis encore en jeu : tout le monde peut toujours suivre.</dd>
          </dl>
        </section>

        <section id="rule-astuces">
          <h3>Astuces</h3>
          <ul className="rule-list">
            <li>Avec − et ÷, viser 1 est facile : le Low est souvent très disputé. Un High solide peut rapporter gros.</li>
            <li>Un 0 est précieux en Low (0 × n ou 0 ÷ n effacent un terme), un × est l’arme du High.</li>
            <li>Regarde les cartes visibles des autres : qui peut viser quoi ? Ta carte cachée est ton arme de bluff.</li>
            <li>Après la manche, le jeu te montre la meilleure équation que tu pouvais faire : idéal pour progresser.</li>
          </ul>
        </section>

        <section id="rule-sandbox">
          <h3>
            <Sparkles size={18} /> S’entraîner
          </h3>
          <p>Une main au hasard : essaie d’approcher 20 et 1, puis compare avec la meilleure solution.</p>
          <Sandbox />
        </section>
      </div>
      <footer className="rules-foot">
        <button type="button" className="btn btn-primary" onClick={close}>
          C’est compris, on joue !
        </button>
      </footer>
    </Sheet>
  );
}
