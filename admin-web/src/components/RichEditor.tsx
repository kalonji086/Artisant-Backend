import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  initialHtml: string;
  onChange: (html: string) => void;
  hideVariables?: boolean;
}

const FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Courier New'];
const SIZES: { label: string; value: string }[] = [
  { label: '10', value: '1' },
  { label: '13', value: '2' },
  { label: '16', value: '3' },
  { label: '18', value: '4' },
  { label: '24', value: '5' },
  { label: '32', value: '6' },
  { label: '48', value: '7' },
];
const BLOCKS = [
  { label: 'Paragraphe', value: 'P' },
  { label: 'Titre 1', value: 'H1' },
  { label: 'Titre 2', value: 'H2' },
  { label: 'Titre 3', value: 'H3' },
  { label: 'Citation', value: 'BLOCKQUOTE' },
];
export const VARIABLES = [
  { label: 'Nom', value: '{{nom}}' },
  { label: 'Métier', value: '{{metier}}' },
  { label: 'Ville', value: '{{ville}}' },
  { label: 'Email', value: '{{email}}' },
];

const TABLE_HTML =
  '<table style="border-collapse:collapse;width:100%;margin:12px 0;"><tbody>' +
  [0, 1, 2]
    .map(
      () =>
        '<tr>' +
        [0, 1, 2].map(() => '<td style="border:1px solid #cbd5e1;padding:8px;">&nbsp;</td>').join('') +
        '</tr>'
    )
    .join('') +
  '</tbody></table><p></p>';

function ToolButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Garde la sélection du texte dans l'éditeur quand on clique sur la barre d'outils.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={[
        'flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-sm text-gray-700 transition hover:bg-gray-200',
        active ? 'bg-gray-200' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-1 h-6 w-px bg-gray-300" aria-hidden="true" />;

const selectClass = 'h-8 rounded border border-gray-300 bg-white px-1.5 text-sm text-gray-700 focus:outline-none';

export default function RichEditor({ initialHtml, onChange, hideVariables }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml;
    // L'éditeur est non contrôlé : le contenu initial n'est posé qu'une fois (remonter avec `key` pour le remplacer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => onChange(ref.current?.innerHTML ?? '');

  const run = (command: string, value?: string) => {
    ref.current?.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
    emit();
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    ref.current?.focus();
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const addLink = () => {
    saveSelection();
    const url = window.prompt('Adresse du lien (https://…)');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) {
      window.alert('Le lien doit commencer par https://, http://, mailto: ou tel:');
      return;
    }
    restoreSelection();
    run('createLink', url);
  };

  const addImage = () => {
    saveSelection();
    const url = window.prompt('Adresse de l\'image (https://…)');
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      window.alert('L\'image doit être une adresse https:// ou http://');
      return;
    }
    restoreSelection();
    const safe = url.replace(/"/g, '%22');
    run('insertHTML', `<img src="${safe}" alt="" style="max-width:100%;height:auto;">`);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="sticky top-16 z-10 flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-2">
        <ToolButton label="Annuler" onClick={() => run('undo')}>↶</ToolButton>
        <ToolButton label="Rétablir" onClick={() => run('redo')}>↷</ToolButton>
        <Divider />
        <select aria-label="Style" className={selectClass} defaultValue="P" onChange={(e) => run('formatBlock', e.target.value)}>
          {BLOCKS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>
        <select aria-label="Police" className={selectClass} defaultValue="Arial" onChange={(e) => run('fontName', e.target.value)}>
          {FONTS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select aria-label="Taille" className={selectClass} defaultValue="3" onChange={(e) => run('fontSize', e.target.value)}>
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <Divider />
        <ToolButton label="Gras" onClick={() => run('bold')}><b>G</b></ToolButton>
        <ToolButton label="Italique" onClick={() => run('italic')}><i>I</i></ToolButton>
        <ToolButton label="Souligné" onClick={() => run('underline')}><u>S</u></ToolButton>
        <ToolButton label="Barré" onClick={() => run('strikeThrough')}><s>B</s></ToolButton>
        <label className="flex h-8 cursor-pointer items-center gap-1 rounded px-1.5 text-sm text-gray-700 hover:bg-gray-200" title="Couleur du texte">
          <span className="font-bold underline decoration-2">A</span>
          <input type="color" defaultValue="#101828" className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" onChange={(e) => run('foreColor', e.target.value)} />
        </label>
        <label className="flex h-8 cursor-pointer items-center gap-1 rounded px-1.5 text-sm text-gray-700 hover:bg-gray-200" title="Surlignage">
          <span className="rounded bg-yellow-200 px-1 font-bold">ab</span>
          <input type="color" defaultValue="#fff59d" className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" onChange={(e) => run('hiliteColor', e.target.value)} />
        </label>
        <Divider />
        <ToolButton label="Aligner à gauche" onClick={() => run('justifyLeft')}>⬅</ToolButton>
        <ToolButton label="Centrer" onClick={() => run('justifyCenter')}>↔</ToolButton>
        <ToolButton label="Aligner à droite" onClick={() => run('justifyRight')}>➡</ToolButton>
        <ToolButton label="Justifier" onClick={() => run('justifyFull')}>☰</ToolButton>
        <Divider />
        <ToolButton label="Liste à puces" onClick={() => run('insertUnorderedList')}>•≡</ToolButton>
        <ToolButton label="Liste numérotée" onClick={() => run('insertOrderedList')}>1.</ToolButton>
        <ToolButton label="Diminuer le retrait" onClick={() => run('outdent')}>⇤</ToolButton>
        <ToolButton label="Augmenter le retrait" onClick={() => run('indent')}>⇥</ToolButton>
        <Divider />
        <ToolButton label="Insérer un lien" onClick={addLink}>🔗</ToolButton>
        <ToolButton label="Retirer le lien" onClick={() => run('unlink')}>⛓</ToolButton>
        <ToolButton label="Insérer une image" onClick={addImage}>🖼</ToolButton>
        <ToolButton label="Insérer un tableau" onClick={() => run('insertHTML', TABLE_HTML)}>▦</ToolButton>
        <ToolButton label="Ligne de séparation" onClick={() => run('insertHorizontalRule')}>―</ToolButton>
        <ToolButton label="Effacer la mise en forme" onClick={() => run('removeFormat')}>Tx</ToolButton>
        <Divider />
        {hideVariables ? null : (
        <select
          aria-label="Insérer une variable"
          className={selectClass}
          value=""
          onChange={(e) => {
            if (e.target.value) run('insertText', e.target.value);
          }}
        >
          <option value="">Variable…</option>
          {VARIABLES.map((v) => (
            <option key={v.value} value={v.value}>{v.label}  {v.value}</option>
          ))}
        </select>
        )}
      </div>

      <div className="bg-slate-200/70 p-3 sm:p-6">
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Contenu du message"
          onInput={emit}
          onBlur={emit}
          className="doc-editor mx-auto min-h-[520px] max-w-[794px] bg-white px-6 py-8 shadow-lg ring-1 ring-black/5 focus:outline-none sm:px-14 sm:py-12"
        />
      </div>
    </div>
  );
}
