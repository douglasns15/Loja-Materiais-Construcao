'use client';

import { useCallback, useEffect, useId, useRef } from 'react';

/**
 * Comportamentos GLOBAIS de teclado do NexoLoja (ADR-032, adendo 2026-10-15) — complementam o motor de
 * atalhos (`lib/shortcuts.tsx`) com três convenções que valem em TODAS as telas:
 *
 *  1. **Esc fecha o pop-up de cima.** Cada janela (modal) se registra numa PILHA de camadas
 *     (`useModalLayer`); o Esc fecha só a do topo — com duas janelas empilhadas, fecha a de cima e a de
 *     baixo continua aberta. O painel flutuante (ADR-031) entra como janela NÃO modal: fecha com Esc
 *     quando é nele que o usuário está. Um componente interno que trate o Esc antes (ex.: a lista de um seletor de
 *     produto) chama `preventDefault()` e a janela não fecha.
 *  2. **F8 = Confirmar (botão principal).** O botão principal de cada tela/janela é marcado com
 *     `data-confirm`; o F8 (comando `confirm` do motor, rebindável) CLICA nele — na janela do topo, se
 *     houver uma aberta; senão, na tela. Clicar (em vez de chamar a função direto) respeita o botão
 *     desabilitado e a validação do formulário: o F8 nunca faz o que o mouse não poderia fazer.
 *  3. **Setas nos resultados de busca.** Campo de busca e lista de resultados são ligados por
 *     `useSearchNav()`: ↓ no campo desce para o 1º resultado, ↑/↓ andam entre eles, Enter escolhe, ↑ no
 *     1º (ou Esc) volta ao campo e digitar uma letra volta a escrever na busca.
 *
 * Tudo é só `apps/web` (sem dependência, sem banco). O listener é ÚNICO e instalado no layout raiz
 * (`<KeyboardBehaviors />`), na fase de bolha da `window` — handlers dos próprios componentes rodam
 * antes e podem cancelar com `preventDefault()`.
 */

// ---------------------------------------------------------------------------------------------------
// 1) Pilha de camadas (janelas/pop-ups)
// ---------------------------------------------------------------------------------------------------

type Layer = {
  close: () => void;
  el: () => HTMLElement | null;
  /** Janela NÃO modal (painel flutuante, ADR-031): a tela atrás continua usável. */
  modeless: boolean;
  openedAt: number;
};

/** Janelas abertas, da mais antiga (fundo) para a mais recente (topo). */
const layers: Layer[] = [];

/**
 * Último clique/foco do usuário (fase de captura). Um painel flutuante só "é o de cima" para o Esc/F8
 * se a pessoa está nele — clicou/focou dentro dele ou acabou de abri-lo; quem voltou a mexer na tela de
 * trás (ex.: na busca do PDV) não fecha o painel sem querer.
 */
let lastInteraction: { target: EventTarget | null; at: number } = { target: null, at: 0 };
function trackInteraction(e: Event) {
  lastInteraction = { target: e.target, at: performance.now() };
}

/**
 * Janela em vigor para o teclado: a mais recente MODAL; um painel não modal só conta enquanto é onde o
 * usuário está (ver `lastInteraction`). Sem nenhuma ⇒ `null` (vale a tela).
 */
function topLayer(): Layer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    if (!l.modeless) return l;
    const el = l.el();
    const t = lastInteraction.target;
    if (el && ((t instanceof Node && el.contains(t)) || l.openedAt > lastInteraction.at)) return l;
  }
  return null;
}

/**
 * Registra uma janela (pop-up/modal) na pilha enquanto `enabled` — o Esc fecha a do topo e o F8 clica
 * no `[data-confirm]` dela. Retorna um `ref` para pôr no elemento RAIZ da janela (o overlay): é nele
 * que o F8 procura o botão principal. O `onClose` mais recente é usado sem re-registrar (re-registrar
 * jogaria a janela de baixo para o topo). `modeless` = painel flutuante (ver `topLayer`).
 */
export function useModalLayer(
  onClose: () => void,
  enabled = true,
  opts?: { modeless?: boolean },
): (el: HTMLElement | null) => void {
  const closeRef = useRef(onClose);
  const elRef = useRef<HTMLElement | null>(null);
  const modeless = opts?.modeless ?? false;
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!enabled) return;
    const layer: Layer = {
      close: () => closeRef.current(),
      el: () => elRef.current,
      modeless,
      openedAt: performance.now(),
    };
    layers.push(layer);
    return () => {
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [enabled, modeless]);
  return useCallback((el: HTMLElement | null) => {
    elRef.current = el;
  }, []);
}

/** Visível e clicável (o mesmo critério do mouse: botão desabilitado ou escondido não conta). */
function isActionable(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  return el.getClientRects().length > 0;
}

/**
 * F8 / "Confirmar": clica no botão principal (`[data-confirm]`) da janela do TOPO; sem janela aberta,
 * no da tela. Com mais de um candidato (ex.: dois formulários, tela + janela flutuante), prefere o do
 * formulário/bloco (`form` ou `[data-confirm-scope]`) onde está o foco. Retorna `false` se não havia
 * botão principal habilitado.
 */
export function runConfirm(): boolean {
  const top = topLayer();
  let scope: ParentNode = document;
  if (top) {
    const el = top.el();
    if (!el) return false; // janela sem raiz registrada: não arrisca clicar na tela de baixo
    scope = el;
  }
  const active = document.activeElement;
  const hasFocus = (c: HTMLElement) => {
    const box = c.closest('form, [data-confirm-scope]');
    return box != null && active != null && box.contains(active);
  };
  // `data-confirm="scoped"` = botão secundário (ex.: "Salvar observação"): só vale com o foco no bloco dele.
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>('[data-confirm]')).filter(
    (c) => isActionable(c) && (c.getAttribute('data-confirm') !== 'scoped' || hasFocus(c)),
  );
  if (candidates.length === 0) return false;
  const target = candidates.find(hasFocus) ?? candidates[0]!;
  target.click();
  return true;
}

// ---------------------------------------------------------------------------------------------------
// 2) Setas nos resultados de busca
// ---------------------------------------------------------------------------------------------------

/**
 * Liga um campo de busca à sua lista de resultados para navegar por setas. Espalhe `input` no campo,
 * `results` no contêiner da lista e — só quando a linha não for um botão/link (ex.: `<tr onClick>`) —
 * `item` em cada linha clicável; numa linha com vários botões, `primary` no principal. A chave é única por instância (`useId`), então a mesma tela aberta
 * duas vezes (janela flutuante) não se confunde.
 */
export function useSearchNav() {
  const id = useId();
  return {
    input: { 'data-nav-search': id } as const,
    results: { 'data-nav-results': id } as const,
    item: { 'data-nav-item': '', tabIndex: -1 } as const,
    /** Linha com vários botões: marca o PRINCIPAL (ex.: o nome) para as setas pararem só nele. */
    primary: { 'data-nav-item': '' } as const,
    /** Par campo↔lista derivado, para um seletor desenhado mais de uma vez na mesma tela. */
    scoped: (sub: string) => ({
      input: { 'data-nav-search': `${id}-${sub}` } as const,
      results: { 'data-nav-results': `${id}-${sub}` } as const,
    }),
  };
}

function byAttr(attr: string, value: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${attr}="${CSS.escape(value)}"]`);
}

/** Itens navegáveis da lista: as linhas `[data-nav-item]`, se houver; senão botões/links habilitados. */
function navItems(key: string): HTMLElement[] {
  const list = byAttr('data-nav-results', key);
  if (!list) return [];
  const marked = Array.from(list.querySelectorAll<HTMLElement>('[data-nav-item]'));
  const pool = marked.length
    ? marked
    : Array.from(list.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
  return pool.filter((el) => el.getClientRects().length > 0 && !el.closest('[data-nav-skip]'));
}

function focusItem(el: HTMLElement) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
}

/**
 * O foco ficou ATRÁS da janela aberta (ex.: no "Ver / editar" da lista que abriu o pop-up)? Então as
 * setas/Esc não são da busca — o Esc deve fechar a janela. Lista portada no body (seletor dentro da
 * janela) conta como dentro quando o campo dela está na janela.
 */
function isBehindTopLayer(t: HTMLElement, input: HTMLElement | null): boolean {
  const el = topLayer()?.el();
  if (!el) return false;
  return !el.contains(t) && !(input && el.contains(input));
}

function onSearchNavKey(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;

  // No CAMPO: ↓ desce para o 1º resultado.
  const searchKey = t.getAttribute('data-nav-search');
  if (searchKey != null) {
    if (e.key !== 'ArrowDown' || isBehindTopLayer(t, t)) return false;
    const first = navItems(searchKey)[0];
    if (!first) return false;
    e.preventDefault();
    focusItem(first);
    return true;
  }

  // Na LISTA: ↑/↓ andam, Home/End vão às pontas, Enter escolhe, Esc/letra voltam ao campo.
  const list = t.closest<HTMLElement>('[data-nav-results]');
  if (!list) return false;
  const key = list.getAttribute('data-nav-results')!;
  const items = navItems(key);
  const idx = items.indexOf(t);
  if (idx < 0) return false;
  const input = byAttr('data-nav-search', key);
  if (isBehindTopLayer(t, input)) return false;

  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault();
      const next = items[idx + 1];
      if (next) focusItem(next);
      return true;
    }
    case 'ArrowUp': {
      e.preventDefault();
      const prev = items[idx - 1];
      if (prev) focusItem(prev);
      else input?.focus();
      return true;
    }
    case 'Home':
    case 'End': {
      e.preventDefault();
      const edge = e.key === 'Home' ? items[0] : items[items.length - 1];
      if (edge) focusItem(edge);
      return true;
    }
    case 'Enter': {
      // Escolher costuma fechar/limpar a lista (ex.: PDV adiciona e limpa a busca) — o item some e o
      // foco cairia no nada. Nesse caso devolve o foco ao campo, pronto para o próximo item/leitura.
      setTimeout(() => {
        if (input?.isConnected && (!t.isConnected || document.activeElement === document.body)) input.focus();
      }, 0);
      // Botões/links já respondem ao Enter nativamente; linha marcada (`<tr>`/`<li>`) clica aqui.
      if (t.matches('button, a[href]')) return false;
      e.preventDefault();
      t.click();
      return true;
    }
    case 'Escape': {
      if (!input) return false;
      e.preventDefault(); // volta ao campo em vez de fechar a janela
      input.focus();
      return true;
    }
    default: {
      // Uma letra/número (ou apagar) volta a escrever na busca — o caractere cai no campo.
      if (input && (e.key === 'Backspace' || (e.key.length === 1 && e.key !== ' '))) input.focus();
      return false;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Listener único (layout raiz)
// ---------------------------------------------------------------------------------------------------

function onGlobalKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
  if (onSearchNavKey(e)) return;
  if (e.key === 'Escape') {
    const top = topLayer();
    if (!top || e.repeat) return; // segurar o Esc não fecha uma janela atrás da outra
    e.preventDefault();
    top.close();
  }
}

/** Instala os comportamentos globais de teclado (Esc das janelas + setas das buscas). Uma vez, no layout raiz. */
export function KeyboardBehaviors() {
  useEffect(() => {
    window.addEventListener('keydown', onGlobalKeyDown);
    window.addEventListener('pointerdown', trackInteraction, true);
    window.addEventListener('focusin', trackInteraction, true);
    return () => {
      window.removeEventListener('keydown', onGlobalKeyDown);
      window.removeEventListener('pointerdown', trackInteraction, true);
      window.removeEventListener('focusin', trackInteraction, true);
    };
  }, []);
  return null;
}
